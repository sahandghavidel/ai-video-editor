#!/usr/bin/env python3
"""Local OmniVoice inference runner (Apple Silicon friendly).

This script is intended to be called by the Next.js API route
`/api/generate-tts-omnivoice`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


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

    if requested == "auto":
        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda:0"
        return "cpu"

    if requested == "mps" and not torch.backends.mps.is_available():
        return "cpu"

    if requested == "cuda" and not torch.cuda.is_available():
        return "cpu"

    return requested


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run OmniVoice inference")
    parser.add_argument("--text", required=True, help="Text to synthesize")
    parser.add_argument("--output", required=True, help="Output WAV path")
    parser.add_argument(
        "--reference-audio",
        required=True,
        help="Reference audio path for voice cloning",
    )
    parser.add_argument(
        "--reference-text",
        default="",
        help="Optional transcript for the reference audio (ref_text)",
    )
    parser.add_argument(
        "--model-id", default="k2-fsa/OmniVoice", help="HF model id"
    )
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
    parser.add_argument(
        "--num-step", type=int, default=32, help="OmniVoice decoding steps"
    )
    parser.add_argument(
        "--speed", type=float, default=1.0, help="Speech speed factor"
    )
    return parser.parse_args()


def main() -> int:
    try:
        args = parse_args()

        # Helpful defaults for Apple Silicon fallback behavior.
        os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

        output_path = Path(args.output).expanduser().resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)

        reference_audio = Path(args.reference_audio).expanduser().resolve()
        if not reference_audio.exists():
            raise FileNotFoundError(
                f"Reference audio does not exist: {reference_audio}"
            )

        import torch
        import torchaudio
        from omnivoice import OmniVoice

        device_map = _normalize_device_map(args.device_map)
        dtype = _normalize_dtype(args.dtype)

        model = OmniVoice.from_pretrained(
            args.model_id,
            device_map=device_map,
            dtype=dtype,
        )

        generate_kwargs = {
            "text": args.text,
            "ref_audio": str(reference_audio),
            "num_step": max(8, min(64, int(args.num_step))),
            "speed": max(0.5, min(2.0, float(args.speed))),
        }

        if args.reference_text and args.reference_text.strip():
            generate_kwargs["ref_text"] = args.reference_text.strip()

        audio = model.generate(**generate_kwargs)

        if not audio or len(audio) == 0:
            raise RuntimeError("OmniVoice returned empty audio output")

        sample_rate = 24000
        torchaudio.save(str(output_path), audio[0].detach().cpu(), sample_rate)

        print(
            json.dumps(
                {
                    "ok": True,
                    "output_path": str(output_path),
                    "sample_rate": sample_rate,
                    "device_map": device_map,
                    "dtype": args.dtype,
                }
            )
        )
        return 0
    except Exception as exc:  # pylint: disable=broad-except
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
