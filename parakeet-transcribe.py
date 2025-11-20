#!/usr/bin/env python3
"""
Simple Parakeet transcription script that can be called from Node.js
Takes a media URL as argument and returns JSON transcription
"""

import os
# Set environment variables to optimize memory usage
os.environ['CUDA_VISIBLE_DEVICES'] = ''  # Disable CUDA
os.environ['PYTORCH_CUDA_ALLOC_CONF'] = ''  # Disable CUDA memory allocator
os.environ['PYTORCH_MPS_HIGH_WATERMARK_RATIO'] = '0.0'  # Disable MPS
os.environ['OMP_NUM_THREADS'] = '2'  # Limit OpenMP threads
os.environ['MKL_NUM_THREADS'] = '2'  # Limit MKL threads

import torch
torch.set_num_threads(2)  # Limit CPU threads to reduce memory usage
torch.set_default_dtype(torch.float32)  # Use float32 instead of float64

import gc
import psutil
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

def transcribe_in_chunks(model, audio_path: str, duration: float):
    """Transcribe long audio files in chunks to reduce memory usage"""
    import torchaudio
    
    chunk_duration = 300  # 5 minutes per chunk
    overlap = 5  # 5 seconds overlap between chunks
    
    all_segments = []
    all_words = []
    current_time = 0.0
    
    print(f"Processing {duration:.2f}s audio in {chunk_duration}s chunks", file=sys.stderr)
    
    while current_time < duration:
        end_time = min(current_time + chunk_duration, duration)
        
        # Load audio chunk
        start_frame = int(current_time * 16000)  # 16kHz sample rate
        num_frames = int((end_time - current_time + overlap) * 16000)
        
        waveform, sample_rate = torchaudio.load(audio_path, frame_offset=start_frame, num_frames=num_frames)
        
        # Save chunk to temporary file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as chunk_file:
            chunk_path = chunk_file.name
            torchaudio.save(chunk_path, waveform, sample_rate)
        
        try:
            # Transcribe chunk
            output = model.transcribe([chunk_path], timestamps=True)
            chunk_result = output[0]
            
            # Adjust timestamps to global time
            if hasattr(chunk_result, 'timestamp') and 'word' in chunk_result.timestamp:
                for word_info in chunk_result.timestamp['word']:
                    adjusted_word = {
                        "word": word_info['word'],
                        "start": round(word_info['start'] + current_time, 2),
                        "end": round(word_info['end'] + current_time, 2)
                    }
                    all_words.append(adjusted_word)
            
            # Adjust segment timestamps
            if hasattr(chunk_result, 'timestamp') and 'segment' in chunk_result.timestamp:
                for segment_info in chunk_result.timestamp['segment']:
                    # Handle different possible structures
                    segment_text = segment_info.get('segment', segment_info.get('text', ''))
                    adjusted_segment = {
                        "start": round(segment_info['start'] + current_time, 2),
                        "end": round(segment_info['end'] + current_time, 2),
                        "text": segment_text,  # Use 'text' for final output format
                        "words": []  # Will be populated later
                    }
                    all_segments.append(adjusted_segment)
            
            print(f"Processed chunk {current_time:.0f}s - {end_time:.0f}s", file=sys.stderr)
            
        finally:
            # Clean up chunk file
            os.unlink(chunk_path)
            gc.collect()
        
        # Move to next chunk with overlap
        current_time = end_time - overlap
        
        # Prevent infinite loop
        if end_time >= duration:
            break
    
    # Combine all text
    full_text = " ".join([seg['text'] for seg in all_segments])
    
    # Populate words for each segment
    for segment in all_segments:
        segment['words'] = [
            word for word in all_words 
            if word['start'] >= segment['start'] and word['end'] <= segment['end']
        ]
    
    # Create a mock result object that matches NeMo's structure
    class MockResult:
        def __init__(self, text, words, segments):
            self.text = text
            self.timestamp = {
                'word': words,
                'segment': segments
            }
    
    return MockResult(full_text, all_words, all_segments)

def transcribe_with_parakeet(audio_path: str) -> dict:
    """Transcribe audio using Parakeet model with proper timestamps"""
    
    # Redirect stdout to stderr temporarily to avoid NeMo logs in JSON output
    original_stdout = sys.stdout
    sys.stdout = sys.stderr
    
    try:
        import nemo.collections.asr as nemo_asr
        import torchaudio
        
        # Get audio duration to determine processing strategy
        waveform, sample_rate = torchaudio.load(audio_path, num_frames=1)  # Load just first frame
        audio_info = torchaudio.info(audio_path)
        duration = audio_info.num_frames / audio_info.sample_rate
        
        print(f"Audio duration: {duration:.2f} seconds", file=sys.stderr)
        
        # Load the model using the correct class
        model = nemo_asr.models.ASRModel.from_pretrained(
            model_name="nvidia/parakeet-tdt-0.6b-v3"
        )
        
        # Force model to use CPU and optimize memory
        model = model.to('cpu')
        model.eval()  # Set to evaluation mode
        
        # Clear any cached memory
        if hasattr(torch, 'cuda'):
            torch.cuda.empty_cache()
        gc.collect()
        
        print(f"Memory before transcription: {psutil.virtual_memory().percent}%", file=sys.stderr)
        
        # For very long videos (>20 minutes), use chunked processing
        if duration > 1200:  # 20 minutes
            print("Using chunked processing for long video", file=sys.stderr)
            result = transcribe_in_chunks(model, audio_path, duration)
        else:
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
                # Handle both NeMo format ('segment' key) and our chunked format ('text' key)
                segment_text = segment_info.get('segment', segment_info.get('text', ''))
                segments.append({
                    "start": round(segment_info['start'], 2),
                    "end": round(segment_info['end'], 2),
                    "text": segment_text,
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
        
        # Get audio duration
        import torchaudio
        waveform, sample_rate = torchaudio.load(audio_path)
        audio_duration = round(waveform.shape[1] / sample_rate, 2)
        
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
        
        # Explicitly exit with success code
        sys.exit(0)
        
    except Exception as e:
        error_response = {
            "error": f"Transcription failed: {str(e)}"
        }
        print(json.dumps(error_response))
        sys.exit(1)

if __name__ == "__main__":
    main()