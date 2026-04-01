#!/usr/bin/env python3
"""
MLX Whisper + WhisperX alignment transcription script.
Uses MLX Whisper for Metal-accelerated ASR on Apple Silicon,
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

        # Step 2: Transcribe with MLX Whisper (runs on Metal GPU)
        mlx_result = mlx_whisper.transcribe(
            audio_path,
            path_or_hf_repo="mlx-community/whisper-large-v3-mlx",
            language="en",
            word_timestamps=True,
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
        )

        # Step 3: Filter segments — keep only those overlapping with VAD speech regions
        def overlaps_speech(seg_start, seg_end, speech_regions):
            for region in speech_regions:
                r_start, r_end = region["start"], region["end"]
                if seg_start < r_end and seg_end > r_start:
                    return True
            return False

        mlx_segments = []
        for seg in mlx_result.get("segments", []):
            if overlaps_speech(seg["start"], seg["end"], speech_timestamps):
                mlx_segments.append({
                    "start": seg["start"],
                    "end": seg["end"],
                    "text": seg["text"],
                })

        # Step 4: Align with WhisperX's wav2vec2 for accurate word timestamps
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
                            "start": round(word_info["start"], 2),
                            "end": round(word_info["end"], 2),
                        })

            segments.append({
                "start": round(segment.get("start", 0), 2),
                "end": round(segment.get("end", 0), 2),
                "text": segment["text"].strip(),
                "words": segment_words,
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
