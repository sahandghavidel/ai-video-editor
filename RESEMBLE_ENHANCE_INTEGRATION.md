# Resemble Enhance Integration

This project now includes **Resemble Enhance**, an AI-powered audio enhancement tool that performs denoising and audio quality improvement as an alternative to the traditional FFmpeg normalization.

## Quick Setup

```bash
# 1. Install Python 3.11 (required - resemble-enhance not compatible with Python 3.12+)
brew install python@3.11

# 2. Install git-lfs (required for downloading model files)
brew install git-lfs
git lfs install

# 3. Install resemble-enhance globally
python3.11 -m pip install resemble-enhance --upgrade --break-system-packages

# 4. Download model files
cd /opt/homebrew/lib/python3.11/site-packages/resemble_enhance/model_repo && git lfs pull

# 5. Verify installation
resemble-enhance --help

# 6. That's it! The application will now use resemble-enhance when you select AI enhancement modes
```

## What is Resemble Enhance?

Resemble Enhance is an AI-powered tool that improves speech quality through:

- **Denoiser**: Separates speech from noisy audio
- **Enhancer**: Boosts perceptual audio quality, restores distortions, and extends audio bandwidth
- **High Quality**: Trained on 44.1kHz speech data for superior results

## Installation

### Important: Python Version Compatibility

⚠️ **Resemble Enhance requires Python 3.8 to 3.11** (NOT compatible with Python 3.12+)

If your system has Python 3.14 or higher, you'll need to install a compatible Python version:

#### Option 1: Use pyenv to install Python 3.11

```bash
# Install pyenv (if not already installed)
brew install pyenv

# Install Python 3.11
pyenv install 3.11.9

# Set Python 3.11 as global or local
pyenv global 3.11.9
# OR for this project only:
# pyenv local 3.11.9
```

#### Option 2: Install Python 3.11 via Homebrew

```bash
brew install python@3.11
```

### 1. Install Resemble Enhance

Once you have a compatible Python version:

```bash
# Using Python 3.11
python3.11 -m pip install resemble-enhance --upgrade --break-system-packages
```

Or if Python 3.11 is your default python3:

```bash
pip3 install resemble-enhance --upgrade --break-system-packages
```

Or for the latest pre-release version:

```bash
python3.11 -m pip install resemble-enhance --upgrade --pre --break-system-packages
```

### 2. Verify Installation

```bash
resemble-enhance --help
```

Or if using a specific Python version:

```bash
python3.11 -m resemble_enhance --help
```

## Usage in the Application

### Audio Enhancement Modes

The application now supports three audio processing modes (configurable in Global Settings):

1. **Normalize** (FFmpeg)

   - Traditional EBU R128 standard normalization
   - Uses FFmpeg's loudnorm filter
   - Fast and reliable for basic loudness normalization

2. **AI Enhance** (Resemble Enhance)

   - Full AI-powered enhancement
   - Performs both denoising AND enhancement
   - Best for improving overall speech quality
   - Removes background noise, restores audio quality, extends bandwidth

3. **AI Denoise** (Resemble Enhance - Denoise Only)
   - AI-powered denoising without full enhancement
   - Faster than full enhancement
   - Good for removing background noise while keeping original audio characteristics

### How to Use

1. **Open Global Settings** in the application
2. **Locate "Audio Enhancement Mode"** section
3. **Select your preferred mode**:
   - Click "Normalize" for traditional FFmpeg normalization
   - Click "AI Enhance" for full Resemble Enhance processing
   - Click "AI Denoise" for denoise-only processing
4. **The setting is saved automatically** and will be used for all normalize operations

### When Audio Processing Occurs

Audio enhancement is applied during the "Normalize Audio" step in the pipeline:

- When clicking "Normalize" button on individual videos
- When running the full auto-generation pipeline
- The selected mode (Normalize/AI Enhance/AI Denoise) determines which processing method is used

## Technical Details

### Python Script: `resemble-enhance-audio.py`

Located in the project root, this script handles:

1. Downloading video from URL
2. Extracting audio (converts to 44.1kHz mono WAV)
3. Running Resemble Enhance
4. Merging enhanced audio back with video
5. Outputting result to MinIO storage

### API Endpoint: `/api/enhance-audio`

- **Method**: POST
- **Parameters**:
  - `sceneId`: Video ID
  - `videoUrl`: Source video URL
  - `denoiseOnly`: Boolean (true for denoise-only mode)
- **Returns**: Enhanced video URL

### Processing Pipeline

```
Input Video URL
    ↓
Download Video (curl)
    ↓
Extract Audio (ffmpeg → 44.1kHz mono WAV)
    ↓
Enhance Audio (resemble-enhance)
    ↓
Merge Audio + Video (ffmpeg)
    ↓
Upload to MinIO
    ↓
Return Enhanced Video URL
```

## Performance Considerations

- **AI Enhancement is slower** than traditional normalization (but produces better results)
- **Denoise-only mode** is faster than full enhancement
- **Processing runs on CPU** by default (Mac doesn't support CUDA)
- **Processing time** depends on:
  - Video length
  - Audio complexity
  - Available CPU cores
- **Typical processing time**: 2-5x the duration of the audio file on CPU

## Requirements

- **Python 3.8 to 3.11** (NOT compatible with Python 3.12+)
- **Git LFS** for downloading model files
- **FFmpeg** installed and accessible in PATH
- **curl** for downloading videos
- Sufficient disk space in `/tmp` for temporary files
- Processing runs on **CPU** (CUDA/GPU not available on Mac)
- `resemble-enhance` must be installed globally (accessible to system python3)

## Troubleshooting

### "No such file or directory: 'resemble-enhance'"

This means resemble-enhance is not installed or not accessible. Common causes:

1. **Python version incompatibility**: Resemble Enhance requires Python 3.8-3.11

   ```bash
   # Check your Python version
   python3 --version

   # If it's 3.12+, install Python 3.11 using pyenv or Homebrew
   brew install python@3.11
   python3.11 -m pip install resemble-enhance --upgrade --break-system-packages
   ```

2. **Package not installed globally**:

   ```bash
   # Install globally with --break-system-packages flag
   python3.11 -m pip install resemble-enhance --upgrade --break-system-packages
   ```

3. **Command not in PATH**:
   ```bash
   # Verify installation
   which resemble-enhance
   # OR
   python3.11 -m resemble_enhance --help
   ```

### "resemble-enhance command not found"

Ensure the package is installed:

```bash
python3.11 -m pip install resemble-enhance --upgrade --break-system-packages
```

And verify it's in your PATH:

```bash
which resemble-enhance
# OR try running directly
python3.11 -m resemble_enhance --help
```

### "AssertionError: Torch not compiled with CUDA enabled"

This error occurs when resemble-enhance tries to use CUDA (NVIDIA GPU) on a Mac. This is now fixed in the script by using `--device cpu` flag. If you still see this error:

```bash
# Verify you have the latest version of the script
git pull

# Or manually update the Python script to include:
# cmd.extend(['--device', 'cpu'])
```

The script automatically uses CPU processing on Mac, which is compatible with the M-series chips.

### "git: 'lfs' is not a git command" Error

This error means Git LFS is not installed. Install it:

```bash
# Install git-lfs
brew install git-lfs

# Initialize git-lfs
git lfs install

# Download the model files
cd /opt/homebrew/lib/python3.11/site-packages/resemble_enhance/model_repo
git lfs pull
```

### "Failed to enhance audio"

Check the server logs for detailed error messages. Common issues:

- Git LFS not installed (see above)
- FFmpeg not installed or not in PATH
- Insufficient disk space
- Audio format issues (the script converts to WAV automatically)
- Network issues downloading the source video

### Processing is very slow

- Use "AI Denoise" mode instead of "AI Enhance" for faster processing
- Consider using GPU acceleration if available
- Fall back to "Normalize" mode for faster processing

## Comparison: Normalize vs AI Enhance

| Feature             | Normalize (FFmpeg) | AI Enhance   | AI Denoise    |
| ------------------- | ------------------ | ------------ | ------------- |
| Speed               | ⚡ Fast            | 🐌 Slower    | 🚶 Moderate   |
| Noise Removal       | ❌ No              | ✅ Yes       | ✅ Yes        |
| Quality Enhancement | ⚠️ Basic           | ✅ Advanced  | ❌ No         |
| Bandwidth Extension | ❌ No              | ✅ Yes       | ❌ No         |
| Best For            | Quick loudness fix | Best quality | Noise removal |

## References

- [Resemble Enhance GitHub](https://github.com/resemble-ai/resemble-enhance)
- [Resemble AI Website](https://www.resemble.ai/)
