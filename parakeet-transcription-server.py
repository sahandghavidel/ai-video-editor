#!/usr/bin/env python3
"""
Parakeet Transcription Server
A FastAPI server that provides transcription services using NVIDIA's Parakeet TDT model.
This replaces the NCA toolkit dependency with a local, high-performance ASR solution.
"""

import os
import json
import tempfile
import urllib.request
from typing import List, Dict, Any, Optional
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import torch
import torchaudio
import nemo.collections.asr as nemo_asr

# Initialize FastAPI app
app = FastAPI(
    title="Parakeet Transcription Server",
    description="High-performance speech recognition using NVIDIA Parakeet TDT 0.6B v3",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model instance
parakeet_model = None

class TranscriptionRequest(BaseModel):
    media_url: str
    include_text: bool = True
    include_srt: bool = False
    include_segments: bool = True
    word_timestamps: bool = True
    response_type: str = "direct"
    language: str = "en"

class WordTimestamp(BaseModel):
    word: str
    start: float
    end: float

class TranscriptionSegment(BaseModel):
    start: float
    end: float
    text: str
    words: List[WordTimestamp]

class TranscriptionResponse(BaseModel):
    text: str
    segments: List[TranscriptionSegment]

class APIResponse(BaseModel):
    response: TranscriptionResponse

def load_parakeet_model():
    """Load the Parakeet TDT 0.6B v3 model"""
    global parakeet_model
    
    try:
        print("Loading Parakeet TDT 0.6B v3 model...")
        # Use the correct model class for Parakeet TDT
        parakeet_model = nemo_asr.models.EncDecRNNTBPEModel.from_pretrained(
            model_name="nvidia/parakeet-tdt-0.6b-v3"
        )
        print("Parakeet model loaded successfully!")
        return True
    except Exception as e:
        print(f"Error loading Parakeet model: {e}")
        return False

def download_audio_file(url: str, temp_dir: str) -> str:
    """Download audio file from URL to temporary directory"""
    try:
        # Create a temporary file
        temp_file = os.path.join(temp_dir, "audio_input")
        
        # Download the file with SSL context disabled for testing
        import ssl
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        
        urllib.request.urlretrieve(url, temp_file)
        
        return temp_file
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to download audio file: {str(e)}"
        )

def convert_to_wav(input_path: str, output_path: str) -> str:
    """Convert audio/video file to WAV format using FFmpeg (more robust than torchaudio)"""
    try:
        import subprocess
        
        # Use FFmpeg to extract audio and convert to 16kHz mono WAV
        cmd = [
            'ffmpeg', '-i', input_path,
            '-vn',  # No video
            '-acodec', 'pcm_s16le',  # 16-bit PCM
            '-ar', '16000',  # 16kHz sample rate
            '-ac', '1',  # Mono
            '-y',  # Overwrite output file
            output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            raise Exception(f"FFmpeg failed: {result.stderr}")
        
        return output_path
    except FileNotFoundError:
        # Fallback to torchaudio if FFmpeg is not available
        try:
            # Load audio file
            waveform, sample_rate = torchaudio.load(input_path)
            
            # Convert to 16kHz mono if needed (Parakeet expects 16kHz)
            if sample_rate != 16000:
                resampler = torchaudio.transforms.Resample(sample_rate, 16000)
                waveform = resampler(waveform)
            
            # Convert to mono if stereo
            if waveform.shape[0] > 1:
                waveform = torch.mean(waveform, dim=0, keepdim=True)
            
            # Save as WAV
            torchaudio.save(output_path, waveform, 16000)
            
            return output_path
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to convert audio file: {str(e)}"
            )
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to convert audio file: {str(e)}"
        )

def create_word_timestamps(transcription: str, audio_duration: float) -> List[WordTimestamp]:
    """
    Create word timestamps from transcription text.
    Note: Parakeet TDT doesn't provide word-level timestamps by default,
    so we'll create estimated timestamps based on word positions.
    """
    words = transcription.strip().split()
    if not words:
        return []
    
    # Estimate timing based on average speaking rate (150 words per minute)
    words_per_second = 2.5
    word_duration = 1.0 / words_per_second
    
    word_timestamps = []
    current_time = 0.0
    
    for word in words:
        # Clean word of punctuation for timestamp
        clean_word = word.strip('.,!?;:"()[]{}')
        if clean_word:
            # Adjust duration based on word length
            estimated_duration = max(0.2, len(clean_word) * 0.1)
            estimated_duration = min(estimated_duration, word_duration * 2)
            
            word_timestamps.append(WordTimestamp(
                word=clean_word,
                start=round(current_time, 2),
                end=round(current_time + estimated_duration, 2)
            ))
            
            current_time += estimated_duration + 0.1  # Small pause between words
    
    # Adjust last word end time to not exceed audio duration
    if word_timestamps and word_timestamps[-1].end > audio_duration:
        word_timestamps[-1].end = round(audio_duration, 2)
    
    return word_timestamps

def transcribe_audio(audio_path: str) -> Dict[str, Any]:
    """Transcribe audio using Parakeet model"""
    global parakeet_model
    
    if parakeet_model is None:
        raise HTTPException(
            status_code=500,
            detail="Parakeet model not loaded"
        )
    
    try:
        # Get transcription from Parakeet
        transcription = parakeet_model.transcribe([audio_path])[0]
        
        # Get audio duration for timestamp estimation
        waveform, sample_rate = torchaudio.load(audio_path)
        audio_duration = waveform.shape[1] / sample_rate
        
        # Create word timestamps
        word_timestamps = create_word_timestamps(transcription, audio_duration)
        
        # Create segment (Parakeet TDT returns full transcription as one segment)
        segment = TranscriptionSegment(
            start=0.0,
            end=round(audio_duration, 2),
            text=transcription,
            words=word_timestamps
        )
        
        return {
            "text": transcription,
            "segments": [segment]
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Transcription failed: {str(e)}"
        )

@app.on_event("startup")
async def startup_event():
    """Load the Parakeet model on startup"""
    success = load_parakeet_model()
    if not success:
        print("Warning: Failed to load Parakeet model on startup")

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "message": "Parakeet Transcription Server",
        "model_loaded": parakeet_model is not None,
        "version": "1.0.0"
    }

@app.post("/v1/media/transcribe")
async def transcribe_media(request: TranscriptionRequest):
    """Transcribe audio/video media from URL"""
    
    if parakeet_model is None:
        raise HTTPException(
            status_code=503,
            detail="Parakeet model not available. Please wait for model loading to complete."
        )
    
    # Create temporary directory for processing
    with tempfile.TemporaryDirectory() as temp_dir:
        try:
            # Download the media file
            input_file = download_audio_file(request.media_url, temp_dir)
            
            # Convert to WAV format
            wav_file = os.path.join(temp_dir, "audio.wav")
            convert_to_wav(input_file, wav_file)
            
            # Transcribe the audio
            transcription_result = transcribe_audio(wav_file)
            
            # Create response in NCA toolkit compatible format
            response = APIResponse(
                response=TranscriptionResponse(
                    text=transcription_result["text"],
                    segments=transcription_result["segments"]
                )
            )
            
            return response
            
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Transcription failed: {str(e)}"
            )

@app.get("/health")
async def health_check():
    """Detailed health check"""
    return {
        "status": "healthy",
        "model_loaded": parakeet_model is not None,
        "torch_version": torch.__version__,
        "cuda_available": torch.cuda.is_available(),
        "device_count": torch.cuda.device_count() if torch.cuda.is_available() else 0
    }

if __name__ == "__main__":
    # Run the server
    uvicorn.run(
        "parakeet-transcription-server:app",
        host="0.0.0.0",
        port=8080,
        reload=False,
        log_level="info"
    )