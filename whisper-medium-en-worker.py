#!/usr/bin/env python3
"""Persistent Whisper medium.en worker.

Loads model once and serves multiple scene transcription jobs over stdin/stdout JSONL.
Each input line must be JSON with fields:
  - id: unique job id
  - media_url: URL to media file
  - scene_id: optional scene id for diagnostics

Outputs one JSON line per job:
  - {"id": ..., "ok": true, "result": {...}}
  - {"id": ..., "ok": false, "error": "..."}
"""

from __future__ import annotations

import json
import logging
import os
import ssl
import subprocess
import sys
import tempfile
import warnings
from pathlib import Path
from typing import Any

import requests


# Keep stdout clean for JSONL responses.
logging.getLogger("whisper").setLevel(logging.ERROR)
logging.getLogger().setLevel(logging.ERROR)
warnings.filterwarnings("ignore")
ssl._create_default_https_context = ssl._create_unverified_context


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(message: str) -> None:
    sys.stderr.write(f"[whisper-medium-en-worker] {message}\n")
    sys.stderr.flush()


def download_and_convert_media(url: str) -> str:
    """Download media and convert it to 16kHz mono WAV for Whisper."""
    with tempfile.NamedTemporaryFile(suffix=".input", delete=False) as temp_input:
        temp_input_path = temp_input.name
        try:
            response = requests.get(url, verify=False, timeout=300)
            response.raise_for_status()
            temp_input.write(response.content)
        except Exception as exc:  # pylint: disable=broad-except
            try:
                os.unlink(temp_input_path)
            except OSError:
                pass
            raise RuntimeError(f"Failed to download media: {exc}") from exc

    wav_path = f"{temp_input_path}.wav"
    cmd = [
        "ffmpeg",
        "-i",
        temp_input_path,
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-y",
        wav_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)

    try:
        os.unlink(temp_input_path)
    except OSError:
        pass

    if result.returncode != 0:
        try:
            os.unlink(wav_path)
        except OSError:
            pass
        raise RuntimeError(f"FFmpeg failed: {result.stderr}")

    return wav_path


def transcribe_with_model(model: Any, audio_path: str) -> dict[str, Any]:
    """Transcribe audio using a preloaded Whisper medium.en model."""
    result = model.transcribe(
        audio_path,
        language="en",
        task="transcribe",
        verbose=False,
        word_timestamps=True,
    )

    transcription = result["text"].strip()
    segments: list[dict[str, Any]] = []
    word_timestamps: list[dict[str, Any]] = []

    for segment in result["segments"]:
        segment_words: list[dict[str, Any]] = []

        if "words" in segment:
            for word_info in segment["words"]:
                word_data = {
                    "word": word_info["word"].strip(),
                    "start": round(word_info["start"], 2),
                    "end": round(word_info["end"], 2),
                }
                word_timestamps.append(word_data)
                segment_words.append(word_data)

        segments.append(
            {
                "start": round(segment["start"], 2),
                "end": round(segment["end"], 2),
                "text": segment["text"].strip(),
                "words": segment_words,
            }
        )

    audio_duration = None
    try:
        import torchaudio

        waveform, sample_rate = torchaudio.load(audio_path)
        audio_duration = round(waveform.shape[1] / sample_rate, 2)
    except Exception:  # pylint: disable=broad-except
        if segments:
            audio_duration = segments[-1]["end"]

    if not word_timestamps and not segments and audio_duration:
        segments.append(
            {
                "start": 0.0,
                "end": audio_duration,
                "text": transcription,
                "words": [],
            }
        )

    return {
        "response": {
            "text": transcription,
            "segments": segments,
            "duration": audio_duration,
        }
    }


def main() -> int:
    try:
        import whisper

        log("loading medium.en model...")
        model = whisper.load_model("medium.en")
        log("model loaded")
        emit({"ready": True, "model": "medium.en"})
    except Exception as exc:  # pylint: disable=broad-except
        emit({"ready": False, "error": f"Worker init failed: {exc}"})
        return 1

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        job_id = ""
        media_url = ""
        scene_id = ""
        wav_path: str | None = None

        try:
            payload = json.loads(line)
            job_id = str(payload.get("id", "")).strip()
            media_url = str(payload.get("media_url", "")).strip()
            scene_id = str(payload.get("scene_id", "")).strip()

            if not job_id:
                raise ValueError("Missing job id")
            if not media_url:
                raise ValueError("Missing media_url")

            log(f"job={job_id} scene={scene_id or 'unknown'} downloading media")
            wav_path = download_and_convert_media(media_url)

            log(f"job={job_id} scene={scene_id or 'unknown'} transcribing")
            result = transcribe_with_model(model, wav_path)

            emit({"id": job_id, "ok": True, "result": result})
            log(f"job={job_id} scene={scene_id or 'unknown'} done")
        except Exception as exc:  # pylint: disable=broad-except
            emit(
                {
                    "id": job_id,
                    "ok": False,
                    "error": f"Whisper medium.en transcription failed: {exc}",
                }
            )
            if job_id:
                log(f"job={job_id} failed: {exc}")
            else:
                log(f"failed to handle malformed request: {exc}")
        finally:
            if wav_path:
                try:
                    Path(wav_path).unlink(missing_ok=True)
                except OSError:
                    pass

    log("stdin closed, shutting down worker")
    return 0


if __name__ == "__main__":
    sys.exit(main())
