#!/usr/bin/env python3
"""
WhisperX transcription script that can be called from Node.js
Takes a media URL as argument and returns JSON transcription
Uses WhisperX for batched inference, wav2vec2 alignment, and accurate word timestamps
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
logging.getLogger('faster_whisper').setLevel(logging.ERROR)
logging.getLogger().setLevel(logging.ERROR)

# Redirect logs to stderr
import warnings
warnings.filterwarnings("ignore")

# Bypass SSL verification for model downloads
import ssl
ssl._create_default_https_context = ssl._create_unverified_context

def download_and_convert_media(url: str) -> str:
    """Download media and convert to WAV format"""
    with tempfile.NamedTemporaryFile(suffix='.input', delete=False) as temp_input:
        try:
            # Download the file using requests (handles SSL issues better)
            response = requests.get(url, verify=False, timeout=300)  # 5 minute timeout
            response.raise_for_status()
            temp_input.write(response.content)

        except Exception as e:
            raise Exception(f"Failed to download media: {str(e)}")

        # Convert to WAV using FFmpeg
        wav_path = temp_input.name + '.wav'
        cmd = [
            'ffmpeg', '-i', temp_input.name,
            '-vn',  # No video
            '-acodec', 'pcm_s16le',  # 16-bit PCM
            '-ar', '16000',  # 16kHz sample rate
            '-ac', '1',  # Mono
            '-y',  # Overwrite output file
            wav_path
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            raise Exception(f"FFmpeg failed: {result.stderr}")

        # Clean up input file
        os.unlink(temp_input.name)

        return wav_path

def transcribe_with_whisperx(audio_path: str) -> dict:
    """Transcribe audio using WhisperX with wav2vec2 alignment"""

    # Redirect stdout to stderr temporarily to avoid logs in JSON output
    original_stdout = sys.stdout
    sys.stdout = sys.stderr

    try:
        import whisperx
        import torch

        # Determine device and compute type for macOS/CPU
        device = "cpu"
        compute_type = "int8"

        # Check for CUDA
        if torch.cuda.is_available():
            device = "cuda"
            compute_type = "float16"
        # Check for MPS (Apple Silicon) — WhisperX uses faster-whisper/ctranslate2
        # which does not support MPS, so we stay on CPU

        batch_size = 16 if device == "cuda" else 4

        # Step 1: Transcribe with batched whisper (using faster-whisper backend)
        model = whisperx.load_model(
            "large-v2",
            device,
            compute_type=compute_type,
            language="en",
        )

        audio = whisperx.load_audio(audio_path)
        result = model.transcribe(audio, batch_size=batch_size, language="en")

        # Step 2: Align whisper output for accurate word timestamps
        model_a, metadata = whisperx.load_align_model(
            language_code="en",
            device=device,
        )
        result = whisperx.align(
            result["segments"],
            model_a,
            metadata,
            audio,
            device,
            return_char_alignments=False,
        )

        # Restore stdout
        sys.stdout = original_stdout

        # Extract transcription data
        full_text_parts = []
        segments = []
        word_timestamps = []

        for segment in result["segments"]:
            full_text_parts.append(segment["text"].strip())
            segment_words = []

            # Extract word-level timestamps
            if "words" in segment:
                for word_info in segment["words"]:
                    if "start" in word_info and "end" in word_info:
                        word_data = {
                            "word": word_info["word"].strip(),
                            "start": round(word_info["start"], 2),
                            "end": round(word_info["end"], 2)
                        }
                        word_timestamps.append(word_data)
                        segment_words.append(word_data)

            segments.append({
                "start": round(segment.get("start", 0), 2),
                "end": round(segment.get("end", 0), 2),
                "text": segment["text"].strip(),
                "words": segment_words
            })

        transcription = " ".join(full_text_parts)

        # Get audio duration
        import torchaudio
        audio_duration = None
        try:
            waveform, sample_rate = torchaudio.load(audio_path)
            audio_duration = round(waveform.shape[1] / sample_rate, 2)
        except:
            if segments:
                audio_duration = segments[-1]["end"]

        # Create response in NCA toolkit compatible format
        response = {
            "response": {
                "text": transcription,
                "segments": segments,
                "duration": audio_duration
            }
        }

        return response

    except Exception as e:
        # Restore stdout in case of error
        sys.stdout = original_stdout
        raise e

def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: python whisperx-transcribe.py <media_url>"}))
        sys.exit(1)

    media_url = sys.argv[1]

    try:
        # Download and convert media
        audio_path = download_and_convert_media(media_url)

        # Transcribe with WhisperX
        result = transcribe_with_whisperx(audio_path)

        # Clean up
        os.unlink(audio_path)

        # Output JSON result
        print(json.dumps(result))

    except Exception as e:
        error_response = {
            "error": f"WhisperX transcription failed: {str(e)}"
        }
        print(json.dumps(error_response))
        sys.exit(1)

if __name__ == "__main__":
    main()
