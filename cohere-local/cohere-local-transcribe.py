#!/usr/bin/env python3
"""
Isolated local transcription runner for Cohere Transcribe.

This script is intentionally separate from existing Parakeet/Whisper scripts.
It downloads media from URL, converts to 16k mono WAV, runs local inference with
CohereLabs/cohere-transcribe-03-2026, and prints JSON to stdout.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
from typing import Any, Dict, List

# Keep logs quieter so stdout remains clean JSON.
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")

MODEL_ID = os.getenv("COHERE_TRANSCRIBE_MODEL", "CohereLabs/cohere-transcribe-03-2026")
DEFAULT_LANGUAGE = os.getenv("COHERE_TRANSCRIBE_LANGUAGE", "en")
DEFAULT_MAX_NEW_TOKENS = int(os.getenv("COHERE_TRANSCRIBE_MAX_NEW_TOKENS", "512"))
DEFAULT_PUNCTUATION = os.getenv("COHERE_TRANSCRIBE_PUNCTUATION", "1") not in ("0", "false", "False")


def _load_env_local_if_present() -> None:
    """Best-effort load of .env.local values into process env.

    This keeps the runner isolated and makes token updates effective without
    requiring a full Next.js restart.
    """
    env_path = Path.cwd() / ".env.local"
    if not env_path.exists() or not env_path.is_file():
        return

    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue

            if line.startswith("export "):
                line = line[len("export ") :].strip()

            if "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if not key:
                continue

            if (
                len(value) >= 2
                and ((value[0] == '"' and value[-1] == '"') or (value[0] == "'" and value[-1] == "'"))
            ):
                value = value[1:-1]

            current = os.getenv(key)
            if current is None or not str(current).strip():
                os.environ[key] = value
    except Exception:
        # Silent best-effort load only.
        return


def _get_hf_token() -> str:
    # 1) Direct env vars (preferred)
    token = (os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_HUB_TOKEN") or "").strip()
    if token:
        return token

    # 2) huggingface_hub cached login token (if user ran `huggingface-cli login`)
    try:
        from huggingface_hub import HfFolder

        cached = (HfFolder.get_token() or "").strip()
        if cached:
            return cached
    except Exception:
        pass

    # 3) Common token file locations
    common_paths = [
        Path.home() / ".cache" / "huggingface" / "token",
        Path.home() / ".huggingface" / "token",
    ]

    for token_path in common_paths:
        try:
            if token_path.exists() and token_path.is_file():
                cached = token_path.read_text(encoding="utf-8").strip()
                if cached:
                    return cached
        except Exception:
            continue

    raise RuntimeError(
        "Missing Hugging Face token. Set HF_TOKEN (or HUGGINGFACE_HUB_TOKEN) in .env.local, "
        "or run `huggingface-cli login`, then retry."
    )


def _download_to_temp(url: str) -> Path:
    with tempfile.NamedTemporaryFile(suffix=".input", delete=False) as temp_input:
        urllib.request.urlretrieve(url, temp_input.name)
        return Path(temp_input.name)


def _convert_to_wav_16k_mono(input_path: Path) -> Path:
    output_path = input_path.with_suffix(input_path.suffix + ".wav")
    cmd = [
        "ffmpeg",
        "-i",
        str(input_path),
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-y",
        str(output_path),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg conversion failed: {result.stderr.strip()}")
    return output_path


def _choose_device() -> str:
    import torch

    requested = os.getenv("COHERE_TRANSCRIBE_DEVICE", "auto").lower().strip()
    if requested in {"cpu", "cuda", "mps"}:
        return requested

    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _choose_dtype(device: str) -> Any:
    import torch

    if device in {"cuda", "mps"}:
        return torch.float16
    return torch.float32


def _run_transcription(
    wav_path: Path,
    language: str,
    punctuation: bool,
    max_new_tokens: int,
) -> Dict[str, Any]:
    import numpy as np
    import soundfile as sf
    import torch
    from huggingface_hub import hf_hub_download
    from transformers import AutoProcessor, CohereAsrForConditionalGeneration

    audio, sr = sf.read(str(wav_path), dtype="float32", always_2d=False)

    # Handle stereo just in case
    if isinstance(audio, np.ndarray) and audio.ndim > 1:
        audio = audio.mean(axis=1)

    duration = round(float(len(audio) / max(sr, 1)), 2)

    device = _choose_device()
    dtype = _choose_dtype(device)
    hf_token = _get_hf_token()

    # Preflight gated access check to produce clearer diagnostics than the
    # generic "couldn't connect" message that can appear when HEAD fails.
    try:
        hf_hub_download(repo_id=MODEL_ID, filename="config.json", token=hf_token)
    except Exception as e:
        msg = str(e)
        if "403" in msg and "public gated repositories" in msg:
            raise RuntimeError(
                "Hugging Face token lacks permission for public gated repositories. "
                "In token settings, enable access to public gated repositories, then retry."
            )
        raise

    # NOTE: gated repo requires accepted conditions and valid HF token.
    processor = AutoProcessor.from_pretrained(MODEL_ID, token=hf_token)
    model = CohereAsrForConditionalGeneration.from_pretrained(
        MODEL_ID,
        torch_dtype=dtype,
        token=hf_token,
    )
    model = model.to(device)
    model.eval()

    inputs = processor(
        audio=audio,
        sampling_rate=16000,
        return_tensors="pt",
        language=language,
        punctuation=punctuation,
    )

    audio_chunk_index = inputs.get("audio_chunk_index")
    inputs = inputs.to(model.device, dtype=model.dtype)

    with torch.no_grad():
        outputs = model.generate(**inputs, max_new_tokens=max_new_tokens)

    # For long-form the decode may use audio_chunk_index+language.
    text = processor.decode(
        outputs,
        skip_special_tokens=True,
        audio_chunk_index=audio_chunk_index,
        language=language,
    )

    if isinstance(text, list):
        text = " ".join(str(x) for x in text)

    text = str(text).strip()
    # Keep a single payload item with the full transcript spanning the clip.
    # This avoids fabricated per-word timing while preserving start/end fields.
    words: List[Dict[str, Any]] = (
        [
            {
                "word": text,
                "start": 0.0,
                "end": duration,
            }
        ]
        if text
        else []
    )

    return {
        "response": {
            "text": text,
            "segments": [
                {
                    "start": 0.0,
                    "end": duration,
                    "text": text,
                    "words": words,
                }
            ],
            "duration": duration,
        }
    }


def _cleanup(paths: List[Path]) -> None:
    for p in paths:
        try:
            if p.exists():
                p.unlink()
        except Exception:
            pass


def main() -> int:
    _load_env_local_if_present()

    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python cohere-local-transcribe.py <media_url> [language] [punctuation] [max_new_tokens]"}))
        return 1

    media_url = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_LANGUAGE
    punctuation = (
        sys.argv[3].lower() not in {"0", "false", "no"}
        if len(sys.argv) > 3
        else DEFAULT_PUNCTUATION
    )
    max_new_tokens = int(sys.argv[4]) if len(sys.argv) > 4 else DEFAULT_MAX_NEW_TOKENS

    temp_input: Path | None = None
    temp_wav: Path | None = None
    try:
        temp_input = _download_to_temp(media_url)
        temp_wav = _convert_to_wav_16k_mono(temp_input)

        result = _run_transcription(
            wav_path=temp_wav,
            language=language,
            punctuation=punctuation,
            max_new_tokens=max_new_tokens,
        )
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as e:
        message = str(e)
        if (
            "gated repo" in message.lower()
            or "cannot access gated repo" in message.lower()
            or "401" in message
        ):
            message = (
                f"{message}\n\n"
                "Fix: 1) Accept model access at https://huggingface.co/CohereLabs/cohere-transcribe-03-2026 "
                "2) Set HF_TOKEN in .env.local 3) Restart the app."
            )
        print(json.dumps({"error": f"Cohere local transcription failed: {message}"}))
        return 1
    finally:
        _cleanup([p for p in [temp_input, temp_wav] if p is not None])


if __name__ == "__main__":
    raise SystemExit(main())
