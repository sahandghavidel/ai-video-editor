#!/usr/bin/env python3
"""
Resemble Enhance Audio Processing Script
Uses Resemble Enhance for AI-powered audio denoising and enhancement
Automatically detects available Python versions with resemble-enhance installed
"""

import sys
import os
import subprocess
import tempfile
import json
from pathlib import Path

def find_python_with_resemble():
    """Find a Python interpreter that has resemble-enhance installed"""
    # List of Python executables to try
    python_candidates = [
        'python3.11',
        'python3.10',
        'python3.9',
        'python3.8',
        'python3',
        'python',
    ]
    
    for python_cmd in python_candidates:
        try:
            # Check if this Python has resemble-enhance
            result = subprocess.run(
                [python_cmd, '-c', 'import resemble_enhance; print("OK")'],
                capture_output=True,
                timeout=5
            )
            if result.returncode == 0 and b'OK' in result.stdout:
                print(f"Found resemble_enhance in {python_cmd}", file=sys.stderr)
                return python_cmd
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            continue
    
    return None

def download_video(url: str, output_path: str) -> bool:
    """Download video from URL using curl"""
    try:
        print(f"Downloading video from: {url}", file=sys.stderr)
        subprocess.run(
            ['curl', '-L', '-o', output_path, url],
            check=True,
            capture_output=True
        )
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error downloading video: {e}", file=sys.stderr)
        return False

def extract_audio(video_path: str, audio_path: str) -> bool:
    """Extract audio from video using ffmpeg"""
    try:
        print(f"Extracting audio from video...", file=sys.stderr)
        subprocess.run([
            'ffmpeg', '-y',
            '-i', video_path,
            '-vn',  # No video
            '-acodec', 'pcm_s16le',  # PCM 16-bit for better quality
            '-ar', '44100',  # 44.1kHz sample rate (required by Resemble Enhance)
            '-ac', '1',  # Mono (Resemble Enhance works best with mono)
            audio_path
        ], check=True, capture_output=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error extracting audio: {e.stderr.decode()}", file=sys.stderr)
        return False

def enhance_audio_with_cli(
    input_audio: str, 
    output_audio: str, 
    denoise_only: bool = False,
    solver: str = 'midpoint',
    nfe: int = 64,
    tau: float = 0.5,
    lambd: float = 1.0
) -> bool:
    """Enhance audio using Resemble Enhance CLI"""
    try:
        print(f"Enhancing audio with CLI (denoise_only={denoise_only}, solver={solver}, nfe={nfe}, tau={tau}, lambd={lambd})...", file=sys.stderr)
        
        # Create temporary directories for input and output
        temp_in_dir = tempfile.mkdtemp(prefix='resemble_in_')
        temp_out_dir = tempfile.mkdtemp(prefix='resemble_out_')
        
        try:
            # Copy input file to temp directory with a simple name
            temp_input = os.path.join(temp_in_dir, 'audio.wav')
            subprocess.run(['cp', input_audio, temp_input], check=True)
            
            # Build command
            cmd = ['resemble-enhance', temp_in_dir, temp_out_dir]
            if denoise_only:
                cmd.append('--denoise_only')
            
            # Use CPU device to avoid CUDA errors on Mac
            cmd.extend(['--device', 'cpu'])
            
            # Add advanced parameters
            cmd.extend(['--solver', solver])
            cmd.extend(['--nfe', str(nfe)])
            cmd.extend(['--tau', str(tau)])
            cmd.extend(['--lambd', str(lambd)])
            
            # Run resemble-enhance
            # Note: Higher NFE values (128) can take 15-20 minutes on CPU
            print(f"Running resemble-enhance (this may take several minutes with NFE={nfe})...", file=sys.stderr)
            result = subprocess.run(cmd, check=True, capture_output=True, timeout=1800)
            print(f"Resemble-enhance output: {result.stdout.decode()}", file=sys.stderr)
            
            # Copy enhanced audio from output directory
            enhanced_file = os.path.join(temp_out_dir, 'audio.wav')
            if os.path.exists(enhanced_file):
                subprocess.run(['cp', enhanced_file, output_audio], check=True)
                return True
            else:
                print(f"Enhanced audio file not found at: {enhanced_file}", file=sys.stderr)
                # List files in output directory for debugging
                try:
                    files = os.listdir(temp_out_dir)
                    print(f"Files in output directory: {files}", file=sys.stderr)
                except:
                    pass
                return False
        finally:
            # Cleanup temp directories
            try:
                subprocess.run(['rm', '-rf', temp_in_dir, temp_out_dir], check=False)
            except:
                pass
            
    except subprocess.TimeoutExpired:
        print(f"Timeout: Audio enhancement took too long", file=sys.stderr)
        return False
    except subprocess.CalledProcessError as e:
        print(f"Error enhancing audio: {e}", file=sys.stderr)
        if e.stderr:
            print(f"stderr: {e.stderr.decode()}", file=sys.stderr)
        if e.stdout:
            print(f"stdout: {e.stdout.decode()}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"Unexpected error in enhance_audio_with_cli: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return False

def merge_audio_video(video_path: str, audio_path: str, output_path: str) -> bool:
    """Merge enhanced audio back with video and normalize loudness"""
    try:
        print(f"Merging enhanced audio with video and normalizing loudness...", file=sys.stderr)
        
        # Apply loudnorm filter (EBU R128) while merging
        # This matches what Hugging Face demo does
        subprocess.run([
            'ffmpeg', '-y',
            '-i', video_path,
            '-i', audio_path,
            '-c:v', 'copy',  # Copy video stream
            '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',  # Normalize audio to EBU R128 standard
            '-c:a', 'aac',   # Encode audio as AAC
            '-b:a', '192k',  # Audio bitrate
            '-map', '0:v:0', # Map video from first input
            '-map', '1:a:0', # Map audio from second input
            '-shortest',     # Match shortest stream duration
            output_path
        ], check=True, capture_output=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error merging audio and video: {e.stderr.decode()}", file=sys.stderr)
        return False

def main():
    if len(sys.argv) < 3:
        print(json.dumps({
            'success': False,
            'error': 'Usage: python resemble-enhance-audio.py <video_url> <output_path> [--denoise-only] [--solver SOLVER] [--nfe NFE] [--tau TAU] [--lambd LAMBD]'
        }))
        sys.exit(1)
    
    video_url = sys.argv[1]
    output_path = sys.argv[2]
    
    # Parse optional arguments
    denoise_only = '--denoise-only' in sys.argv
    
    # Parse advanced settings with defaults
    solver = 'midpoint'
    nfe = 64
    tau = 0.5
    lambd = 1.0
    
    try:
        if '--solver' in sys.argv:
            idx = sys.argv.index('--solver')
            if idx + 1 < len(sys.argv):
                solver = sys.argv[idx + 1]
        
        if '--nfe' in sys.argv:
            idx = sys.argv.index('--nfe')
            if idx + 1 < len(sys.argv):
                nfe = int(sys.argv[idx + 1])
        
        if '--tau' in sys.argv:
            idx = sys.argv.index('--tau')
            if idx + 1 < len(sys.argv):
                tau = float(sys.argv[idx + 1])
        
        if '--lambd' in sys.argv:
            idx = sys.argv.index('--lambd')
            if idx + 1 < len(sys.argv):
                lambd = float(sys.argv[idx + 1])
    except (ValueError, IndexError) as e:
        print(f"Warning: Failed to parse advanced settings: {e}", file=sys.stderr)
    
    # Check if resemble-enhance is available
    python_with_resemble = find_python_with_resemble()
    if not python_with_resemble:
        # Try to find resemble-enhance CLI
        try:
            subprocess.run(['which', 'resemble-enhance'], check=True, capture_output=True)
            print("Found resemble-enhance CLI", file=sys.stderr)
        except subprocess.CalledProcessError:
            print(json.dumps({
                'success': False,
                'error': 'resemble-enhance not found. Please install it with: pip install resemble-enhance --upgrade\n' +
                         'Note: Requires Python 3.8-3.11 (not compatible with Python 3.12+)'
            }))
            sys.exit(1)
    
    # Create temporary files
    temp_dir = tempfile.mkdtemp(prefix='resemble_enhance_')
    
    try:
        # Paths for intermediate files
        input_video = os.path.join(temp_dir, 'input_video.mp4')
        extracted_audio = os.path.join(temp_dir, 'extracted_audio.wav')
        enhanced_audio = os.path.join(temp_dir, 'enhanced_audio.wav')
        
        # Step 1: Download video
        if not download_video(video_url, input_video):
            raise Exception("Failed to download video")
        
        # Step 2: Extract audio from video
        if not extract_audio(input_video, extracted_audio):
            raise Exception("Failed to extract audio")
        
        # Step 3: Enhance audio with Resemble Enhance
        if not enhance_audio_with_cli(extracted_audio, enhanced_audio, denoise_only, solver, nfe, tau, lambd):
            raise Exception("Failed to enhance audio")
        
        # Step 4: Merge enhanced audio back with video
        if not merge_audio_video(input_video, enhanced_audio, output_path):
            raise Exception("Failed to merge audio and video")
        
        # Success
        print(json.dumps({
            'success': True,
            'output_path': output_path,
            'denoise_only': denoise_only
        }))
        
    except Exception as e:
        print(json.dumps({
            'success': False,
            'error': str(e)
        }))
        sys.exit(1)
    
    finally:
        # Cleanup temporary directory
        try:
            subprocess.run(['rm', '-rf', temp_dir], check=False)
        except:
            pass

if __name__ == '__main__':
    main()
