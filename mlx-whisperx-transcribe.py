#!/usr/bin/env python3
"""
MLX Whisper + WhisperX alignment transcription script.
Uses WhisperX VAD to isolate speech before Metal-accelerated MLX Whisper ASR,
then WhisperX's wav2vec2 alignment for accurate word-level timestamps.
"""

import sys
import json
import tempfile
import subprocess
import os
from pathlib import Path
import requests

# Suppress logging to prevent JSON parsing issues
import logging
logging.getLogger('whisperx').setLevel(logging.ERROR)
logging.getLogger('mlx_whisper').setLevel(logging.ERROR)
logging.getLogger().setLevel(logging.ERROR)

import warnings
warnings.filterwarnings("ignore")

SAMPLE_RATE = 16000
MAX_VAD_CHUNK_SECONDS = 28.0
CHUNK_PADDING_SECONDS = 0.15

# Bypass SSL verification for model downloads
import ssl
ssl._create_default_https_context = ssl._create_unverified_context

def download_and_convert_media(url: str) -> str:
    """Download media and convert to WAV format"""
    with tempfile.NamedTemporaryFile(suffix='.input', delete=False) as temp_input:
        try:
            response = requests.get(url, verify=False, timeout=300)
            response.raise_for_status()
            temp_input.write(response.content)
        except Exception as e:
            raise Exception(f"Failed to download media: {str(e)}")

        wav_path = temp_input.name + '.wav'
        cmd = [
            'ffmpeg', '-i', temp_input.name,
            '-vn', '-acodec', 'pcm_s16le',
            '-ar', '16000', '-ac', '1',
            '-y', wav_path
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise Exception(f"FFmpeg failed: {result.stderr}")

        os.unlink(temp_input.name)
        return wav_path

def build_vad_chunks(speech_timestamps: list[dict], audio_duration: float) -> list[dict]:
    """Merge nearby VAD regions without crossing meaningful silence gaps."""
    merged = []

    for timestamp in speech_timestamps:
        start = max(0.0, float(timestamp["start"]))
        end = min(audio_duration, float(timestamp["end"]))
        if end <= start:
            continue

        if not merged:
            merged.append({"start": start, "end": end})
            continue

        previous = merged[-1]
        merged_duration = end - previous["start"]
        # Match WhisperX's VAD batching: retain context and short internal
        # pauses while keeping every ASR window below Whisper's 30s limit.
        if merged_duration <= MAX_VAD_CHUNK_SECONDS:
            previous["end"] = max(previous["end"], end)
        else:
            merged.append({"start": start, "end": end})

    padded = []
    for index, chunk in enumerate(merged):
        start = max(0.0, chunk["start"] - CHUNK_PADDING_SECONDS)
        end = min(audio_duration, chunk["end"] + CHUNK_PADDING_SECONDS)

        if padded and start < padded[-1]["end"]:
            midpoint = (chunk["start"] + merged[index - 1]["end"]) / 2
            padded[-1]["end"] = midpoint
            start = midpoint

        padded.append({"start": start, "end": end})

    return padded

def transcribe_with_mlx_whisperx(audio_path: str) -> dict:
    """Transcribe using MLX Whisper (Metal GPU) + WhisperX alignment (wav2vec2)"""

    original_stdout = sys.stdout
    sys.stdout = sys.stderr

    try:
        import mlx_whisper
        import whisperx
        import torch

        device = "cpu"
        if torch.cuda.is_available():
            device = "cuda"

        audio = whisperx.load_audio(audio_path)

        # Step 1: Run Pyannote VAD to detect speech regions (prevents hallucination)
        from whisperx.vads.pyannote import load_vad_model, Binarize
        vad_pipeline = load_vad_model(device, vad_onset=0.5, vad_offset=0.363)
        vad_result = vad_pipeline({"waveform": torch.from_numpy(audio).unsqueeze(0), "sample_rate": 16000})
        binarize = Binarize(onset=0.5, offset=0.363)
        speech_regions = binarize(vad_result)
        speech_timestamps = [{"start": seg.start, "end": seg.end} for seg in speech_regions.get_timeline()]

        # Step 2: Build speech-only chunks before ASR. This preserves meaningful
        # silence gaps and avoids asking Whisper to decode non-speech audio.
        audio_duration = len(audio) / SAMPLE_RATE
        vad_chunks = build_vad_chunks(speech_timestamps, audio_duration)
        print(
            f"MLX WhisperX VAD: {len(speech_timestamps)} regions -> "
            f"{len(vad_chunks)} speech chunks",
            file=sys.stderr,
        )

        # Step 3: Transcribe each speech chunk with MLX Whisper on Metal and
        # lift its local segment timestamps back onto the full audio timeline.
        mlx_segments = []
        for chunk in vad_chunks:
            start_sample = max(0, int(chunk["start"] * SAMPLE_RATE))
            end_sample = min(len(audio), int(chunk["end"] * SAMPLE_RATE))
            if end_sample <= start_sample:
                continue

            mlx_result = mlx_whisper.transcribe(
                audio[start_sample:end_sample],
                path_or_hf_repo="mlx-community/whisper-large-v3-mlx",
                language="en",
                word_timestamps=False,
                condition_on_previous_text=False,
                no_speech_threshold=0.6,
            )

            text = str(mlx_result.get("text", "")).strip()
            if text:
                # WhisperX aligns one transcript per VAD window. Giving the
                # aligner the full window avoids constraining words with
                # Whisper's less precise internal segment timestamps.
                mlx_segments.append({
                    "start": chunk["start"],
                    "end": chunk["end"],
                    "text": text,
                })

        mlx_segments.sort(key=lambda segment: (segment["start"], segment["end"]))

        # Step 4: Keep WhisperX's wav2vec2 forced alignment unchanged for
        # accurate word boundaries. Empty audio returns a valid empty result.
        if mlx_segments:
            model_a, metadata = whisperx.load_align_model(
                language_code="en",
                device=device,
            )
            aligned = whisperx.align(
                mlx_segments,
                model_a,
                metadata,
                audio,
                device,
                return_char_alignments=False,
            )
        else:
            aligned = {"segments": []}

        # Restore stdout
        sys.stdout = original_stdout

        # Extract transcription data
        full_text_parts = []
        segments = []

        for segment in aligned["segments"]:
            full_text_parts.append(segment["text"].strip())
            segment_words = []

            if "words" in segment:
                for word_info in segment["words"]:
                    if "start" in word_info and "end" in word_info:
                        segment_words.append({
                            "word": word_info["word"].strip(),
                            "start": float(word_info["start"]),
                            "end": float(word_info["end"]),
                        })

            segments.append({
                "start": float(segment.get("start", 0)),
                "end": float(segment.get("end", 0)),
                "text": segment["text"].strip(),
                "words": segment_words,
            })

        transcription = " ".join(full_text_parts)

        response = {
            "response": {
                "text": transcription,
                "segments": segments,
                "duration": audio_duration,
            }
        }

        return response

    except Exception as e:
        sys.stdout = original_stdout
        raise e

def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: python mlx-whisperx-transcribe.py <media_url>"}))
        sys.exit(1)

    media_url = sys.argv[1]

    try:
        audio_path = download_and_convert_media(media_url)
        result = transcribe_with_mlx_whisperx(audio_path)
        os.unlink(audio_path)
        print(json.dumps(result))

    except Exception as e:
        error_response = {
            "error": f"MLX WhisperX transcription failed: {str(e)}"
        }
        print(json.dumps(error_response))
        sys.exit(1)

if __name__ == "__main__":
    main()
