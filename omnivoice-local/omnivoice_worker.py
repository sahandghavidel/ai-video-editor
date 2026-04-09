#!/usr/bin/env python3
"""Persistent OmniVoice worker.

Loads OmniVoice once and serves multiple synthesis jobs over stdin/stdout JSONL.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Tuple


def _normalize_dtype(requested: str):
    import torch

    mapping = {
        "float16": torch.float16,
        "float32": torch.float32,
        "bfloat16": torch.bfloat16,
    }

    return mapping.get(requested, torch.float16)


def _normalize_device_map(requested: str) -> str:
    import torch

    requested = (requested or "mps").strip().lower()

    if requested != "mps":
        # Strict MPS mode by user request: do not allow auto/cpu/cuda selection.
        return "mps"

    if not torch.backends.mps.is_available():
        raise RuntimeError(
            "MPS device is not available. Strict MPS mode is enabled, so CPU fallback is disabled."
        )

    return "mps"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run persistent OmniVoice worker")
    parser.add_argument("--model-id", default="k2-fsa/OmniVoice", help="HF model id")
    parser.add_argument(
        "--device-map",
        default="mps",
        choices=["mps", "cpu", "auto", "cuda", "cuda:0"],
        help="Model device map",
    )
    parser.add_argument(
        "--dtype",
        default="float16",
        choices=["float16", "float32", "bfloat16"],
        help="Torch dtype",
    )
    return parser.parse_args()


def _write_response(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _log(message: str) -> None:
    sys.stderr.write(f"[omnivoice-worker] {message}\n")
    sys.stderr.flush()


def _build_prompt_cache_key(
    reference_audio: Path,
    reference_text: str,
    preprocess_prompt: bool,
) -> str:
    stat = reference_audio.stat()
    # Include resolved path + file identity + ref_text + preprocess option.
    # This invalidates cache automatically if file content changes on disk.
    return "|".join(
        [
            str(reference_audio),
            str(stat.st_size),
            str(stat.st_mtime_ns),
            reference_text,
            "1" if preprocess_prompt else "0",
        ]
    )


def _get_or_create_voice_clone_prompt(
    model: Any,
    prompt_cache: "OrderedDict[str, Any]",
    max_cache_size: int,
    reference_audio: Path,
    reference_text: str,
    preprocess_prompt: bool,
) -> Tuple[Any, bool, float]:
    key = _build_prompt_cache_key(reference_audio, reference_text, preprocess_prompt)

    cached = prompt_cache.get(key)
    if cached is not None:
        prompt_cache.move_to_end(key)
        return cached, True, 0.0

    start = time.perf_counter()
    prompt = model.create_voice_clone_prompt(
        ref_audio=str(reference_audio),
        ref_text=reference_text or None,
        preprocess_prompt=preprocess_prompt,
    )
    prompt_ms = (time.perf_counter() - start) * 1000.0
    prompt_cache[key] = prompt
    prompt_cache.move_to_end(key)

    while len(prompt_cache) > max_cache_size:
        prompt_cache.popitem(last=False)

    return prompt, False, prompt_ms


def main() -> int:
    try:
        args = parse_args()
        # Strict MPS mode: disable silent CPU fallback for unsupported MPS ops.
        os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "0"

        import torchaudio
        from omnivoice import OmniVoice

        device_map = _normalize_device_map(args.device_map)
        dtype = _normalize_dtype(args.dtype)

        model = OmniVoice.from_pretrained(
            args.model_id,
            device_map=device_map,
            dtype=dtype,
        )

        max_cache_size = max(
            1,
            int(os.environ.get("OMNIVOICE_PROMPT_CACHE_SIZE", "16")),
        )
        # User requirement: keep all automatic processing off.
        # Explicitly disable prompt preprocessing (library default is True).
        preprocess_prompt = False
        cache_log_enabled = (
            os.environ.get("OMNIVOICE_CACHE_LOG", "1").strip().lower()
            not in {"0", "false", "no", "off"}
        )
        prompt_cache: "OrderedDict[str, Any]" = OrderedDict()

        if cache_log_enabled:
            _log(
                "ready "
                f"model={args.model_id} device={device_map} dtype={args.dtype} "
                f"cache_size={max_cache_size} preprocess_prompt={preprocess_prompt}"
            )

        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            try:
                req = json.loads(line)
            except Exception as exc:  # pylint: disable=broad-except
                _write_response({"ok": False, "error": f"Invalid JSON input: {exc}"})
                continue

            job_id = str(req.get("id", ""))
            if not job_id:
                _write_response({"ok": False, "error": "Missing job id"})
                continue

            try:
                text = str(req.get("text", "")).strip()
                output_path = Path(str(req.get("output_path", "")).strip()).expanduser().resolve()
                reference_audio = Path(str(req.get("reference_audio", "")).strip()).expanduser().resolve()
                reference_text = str(req.get("reference_text", "")).strip()
                num_step = int(req.get("num_step", 32))
                speed = float(req.get("speed", 1.0))

                if not text:
                    raise ValueError("Text is required")
                if not reference_audio.exists():
                    raise FileNotFoundError(f"Reference audio does not exist: {reference_audio}")

                output_path.parent.mkdir(parents=True, exist_ok=True)

                voice_clone_prompt, cache_hit, prompt_ms = _get_or_create_voice_clone_prompt(
                    model=model,
                    prompt_cache=prompt_cache,
                    max_cache_size=max_cache_size,
                    reference_audio=reference_audio,
                    reference_text=reference_text,
                    preprocess_prompt=preprocess_prompt,
                )

                generate_kwargs = {
                    "text": text,
                    "voice_clone_prompt": voice_clone_prompt,
                    "num_step": max(8, min(64, num_step)),
                    "speed": max(0.5, min(2.0, speed)),
                    # Explicitly disable defaults from OmniVoiceGenerationConfig
                    # (denoise=True, postprocess_output=True).
                    "denoise": False,
                    "postprocess_output": False,
                }

                generate_start = time.perf_counter()
                audio = model.generate(**generate_kwargs)
                generate_ms = (time.perf_counter() - generate_start) * 1000.0
                if not audio:
                    raise RuntimeError("OmniVoice returned empty audio output")

                sample_rate = 24000
                torchaudio.save(str(output_path), audio[0].detach().cpu(), sample_rate)

                if cache_log_enabled:
                    _log(
                        f"job={job_id} cache={'HIT' if cache_hit else 'MISS'} "
                        f"cache_entries={len(prompt_cache)} "
                        f"prompt_ms={prompt_ms:.1f} gen_ms={generate_ms:.1f} "
                        f"ref={reference_audio.name}"
                    )

                _write_response(
                    {
                        "id": job_id,
                        "ok": True,
                        "sample_rate": sample_rate,
                        "output_path": str(output_path),
                        "cache_hit": cache_hit,
                        "prompt_cache_size": len(prompt_cache),
                        "prompt_ms": round(prompt_ms, 3),
                        "generate_ms": round(generate_ms, 3),
                    }
                )
            except Exception as exc:  # pylint: disable=broad-except
                _write_response({"id": job_id, "ok": False, "error": str(exc)})

        return 0
    except Exception as exc:  # pylint: disable=broad-except
        _write_response({"ok": False, "error": f"Worker init failed: {exc}"})
        return 1


if __name__ == "__main__":
    sys.exit(main())
