#!/usr/bin/env python3
"""
Simple Parakeet transcription script that can be called from Node.js
Takes a media URL as argument and returns JSON transcription
"""

import sys
import json
import tempfile
import urllib.request
import subprocess
import os
from pathlib import Path

# Suppress NeMo logging to prevent JSON parsing issues
import logging
logging.getLogger('nemo_logger').setLevel(logging.ERROR)
logging.getLogger().setLevel(logging.ERROR)

# Redirect NeMo logs to stderr
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

def transcribe_with_parakeet(audio_path: str) -> dict:
    """Transcribe audio using Parakeet model with proper timestamps"""
    
    # Redirect stdout to stderr temporarily to avoid NeMo logs in JSON output
    original_stdout = sys.stdout
    sys.stdout = sys.stderr
    
    try:
        import nemo.collections.asr as nemo_asr
        import torchaudio
        
        # Load the model using the correct class
        model = nemo_asr.models.ASRModel.from_pretrained(
            model_name="nvidia/parakeet-tdt-0.6b-v3"
        )
        
        # Get transcription with timestamps
        output = model.transcribe([audio_path], timestamps=True)
        result = output[0]
        
        # Restore stdout
        sys.stdout = original_stdout
        
        # Extract text and timestamps
        transcription = result.text
        
        # Get word timestamps (built-in from Parakeet)
        word_timestamps = []
        if hasattr(result, 'timestamp') and 'word' in result.timestamp:
            for word_info in result.timestamp['word']:
                word_timestamps.append({
                    "word": word_info['word'],
                    "start": round(word_info['start'], 2),
                    "end": round(word_info['end'], 2)
                })
        
        # Get segment timestamps
        segments = []
        if hasattr(result, 'timestamp') and 'segment' in result.timestamp:
            for segment_info in result.timestamp['segment']:
                segments.append({
                    "start": round(segment_info['start'], 2),
                    "end": round(segment_info['end'], 2),
                    "text": segment_info['segment'],
                    "words": [w for w in word_timestamps 
                             if w['start'] >= segment_info['start'] and w['end'] <= segment_info['end']]
                })
        else:
            # Fallback: create single segment with all words
            if word_timestamps:
                segments.append({
                    "start": word_timestamps[0]['start'] if word_timestamps else 0.0,
                    "end": word_timestamps[-1]['end'] if word_timestamps else 0.0,
                    "text": transcription,
                    "words": word_timestamps
                })
            else:
                # Get audio duration for fallback
                waveform, sample_rate = torchaudio.load(audio_path)
                audio_duration = waveform.shape[1] / sample_rate
                segments.append({
                    "start": 0.0,
                    "end": round(audio_duration, 2),
                    "text": transcription,
                    "words": []
                })
        
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
        print(json.dumps({"error": "Usage: python parakeet-transcribe.py <media_url>"}))
        sys.exit(1)
    
    media_url = sys.argv[1]
    
    try:
        # Download and convert media
        audio_path = download_and_convert_media(media_url)
        
        # Transcribe
        result = transcribe_with_parakeet(audio_path)
        
        # Clean up
        os.unlink(audio_path)
        
        # Output JSON result
        print(json.dumps(result))
        
    except Exception as e:
        error_response = {
            "error": f"Transcription failed: {str(e)}"
        }
        print(json.dumps(error_response))
        sys.exit(1)

if __name__ == "__main__":
    main()