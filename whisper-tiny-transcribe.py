#!/usr/bin/env python3
"""
Whisper Tiny transcription script that can be called from Node.js
Takes a media URL as argument and returns JSON transcription
Uses the tiny Whisper model for faster, lighter transcription
"""

import sys
import json
import tempfile
import urllib.request
import subprocess
import os
from pathlib import Path

# Suppress Whisper logging to prevent JSON parsing issues
import logging
logging.getLogger('whisper').setLevel(logging.ERROR)
logging.getLogger().setLevel(logging.ERROR)

# Redirect logs to stderr
import warnings
warnings.filterwarnings("ignore")

def download_and_convert_media(url: str) -> str:
    """Download media and convert to WAV format"""
    with tempfile.NamedTemporaryFile(suffix='.input', delete=False) as temp_input:
        # Download the file
        urllib.request.urlretrieve(url, temp_input.name)

        # Convert to WAV using FFmpeg
        wav_path = temp_input.name + '.wav'
        cmd = [
            'ffmpeg', '-i', temp_input.name,
            '-vn',  # No video
            '-acodec', 'pcm_s16le',  # 16-bit PCM
            '-ar', '16000',  # 16kHz sample rate (Whisper expects this)
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

def transcribe_with_whisper_tiny(audio_path: str) -> dict:
    """Transcribe audio using Whisper tiny model"""

    # Redirect stdout to stderr temporarily to avoid logs in JSON output
    original_stdout = sys.stdout
    sys.stdout = sys.stderr

    try:
        import whisper
        import torch

        # Load the tiny model (much smaller and faster than base/large)
        model = whisper.load_model("tiny")

        # Transcribe with word-level timestamps
        result = model.transcribe(
            audio_path,
            language=None,  # Auto-detect language
            task="transcribe",
            verbose=False,
            word_timestamps=True
        )

        # Restore stdout
        sys.stdout = original_stdout

        # Extract transcription data
        transcription = result["text"].strip()

        # Process segments and words
        segments = []
        word_timestamps = []

        for segment in result["segments"]:
            segment_words = []

            # Extract word-level timestamps if available
            if "words" in segment:
                for word_info in segment["words"]:
                    word_data = {
                        "word": word_info["word"].strip(),
                        "start": round(word_info["start"], 2),
                        "end": round(word_info["end"], 2)
                    }
                    word_timestamps.append(word_data)
                    segment_words.append(word_data)

            # Create segment
            segments.append({
                "start": round(segment["start"], 2),
                "end": round(segment["end"], 2),
                "text": segment["text"].strip(),
                "words": segment_words
            })

        # If no word timestamps, create fallback segments
        if not word_timestamps and segments:
            # Get audio duration for fallback
            import torchaudio
            try:
                waveform, sample_rate = torchaudio.load(audio_path)
                audio_duration = waveform.shape[1] / sample_rate

                # Create a single segment with the full transcription
                if not segments:
                    segments.append({
                        "start": 0.0,
                        "end": round(audio_duration, 2),
                        "text": transcription,
                        "words": []
                    })
            except:
                # Fallback if torchaudio fails
                pass

        # Create response in NCA toolkit compatible format
        response = {
            "response": {
                "text": transcription,
                "segments": segments
            }
        }

        return response

    except Exception as e:
        # Restore stdout in case of error
        sys.stdout = original_stdout
        raise e

def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: python whisper-tiny-transcribe.py <media_url>"}))
        sys.exit(1)

    media_url = sys.argv[1]

    try:
        # Download and convert media
        audio_path = download_and_convert_media(media_url)

        # Transcribe with Whisper tiny
        result = transcribe_with_whisper_tiny(audio_path)

        # Clean up
        os.unlink(audio_path)

        # Output JSON result
        print(json.dumps(result))

    except Exception as e:
        error_response = {
            "error": f"Whisper tiny transcription failed: {str(e)}"
        }
        print(json.dumps(error_response))
        sys.exit(1)

if __name__ == "__main__":
    main()