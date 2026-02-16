# Video Enhancer API Documentation

## Overview

The Video Enhancer API provides video enhancement capabilities including upscaling and frame interpolation using the REAL-Video-Enhancer backend. This API can be integrated into external applications to enhance video quality programmatically.

## Endpoint

```
POST /api/video-enhancer
```

**Base URL**: `http://localhost:8765` (default, configurable in deployment)

**Full Endpoint**: `http://localhost:8765/api/video-enhancer`

---

## Request Format

### HTTP Method
`POST`

### Content-Type
`multipart/form-data`

### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `video` | File | **Yes** | The video file to enhance. Supports common video formats (mp4, avi, mkv, mov, etc.) |
| `interpolateFactor` | String | No | Frame interpolation multiplier. Values > 1 enable interpolation (e.g., "2" doubles the frame rate, "2.5" increases by 2.5x). Default: no interpolation |
| `upscaleModel` | String | No | The upscaling model to use. Options: `2x-AnimeJaNai_V2_Sharp`, `2x-AnimeJaNai_V3_Sharp`, `2x-OpenProteus`, `4x-SPANkendata`, `AnimeSR`, or `none`. Default: `none` |
| `backend` | String | No | Processing backend. Options: `ncnn`, `onnx`, `pytorch`. Default depends on system configuration |

### Available Upscale Models

The following models are available (located in `REAL-Video-Enhancer/models/`):
- `2x-AnimeJaNai_V2_Sharp` - 2x upscaling optimized for anime content
- `2x-AnimeJaNai_V3_Sharp` - 2x upscaling, improved version for anime
- `2x-OpenProteus` - 2x general purpose upscaling
- `4x-SPANkendata` - 4x upscaling for high-resolution output
- `AnimeSR` - Specialized anime super-resolution
- `none` - Skip upscaling (only interpolation if specified)

---

## Response Format

### Success Response (200 OK)

**Content-Type**: `video/mp4` (or original video format)

**Headers**:
```
Content-Type: video/mp4
Content-Disposition: attachment; filename="enhanced_[original_filename]"
```

**Body**: Binary video file data (the enhanced video)

### Error Responses

#### 400 Bad Request
```json
{
  "error": "Video file is required"
}
```
Or:
```json
{
  "error": "REAL-Video-Enhancer backend not found. Expected: /path/to/rve-backend.py ..."
}
```

#### 500 Internal Server Error
```json
{
  "error": "Failed to enhance video"
}
```
Or:
```json
{
  "error": "Enhancement failed: output file not found"
}
```

---

## Prerequisites

### Server Requirements

1. **REAL-Video-Enhancer Installation**
   - The REAL-Video-Enhancer project must be installed
   - Default location: `./REAL-Video-Enhancer`
   - Backend script must exist at: `./REAL-Video-Enhancer/backend/rve-backend.py`

2. **Python Environment**
   - Python 3.x with required dependencies
   - Preferably use the venv at `REAL-Video-Enhancer/venv/bin/python`
   - Or system Python 3

3. **FFmpeg**
   - Bundled at `REAL-Video-Enhancer/bin/ffmpeg` (preferred)
   - Or system FFmpeg installation

4. **Model Files**
   - Upscale models must be present in `REAL-Video-Enhancer/models/`
   - Models must be valid `.pth` files (> 1KB in size)

### Environment Variables (Optional)

Configure these in `.env` file if using non-default paths:

```bash
# Root directory of REAL-Video-Enhancer
REAL_VIDEO_ENHANCER_ROOT="./REAL-Video-Enhancer"

# Backend script path (optional override)
REAL_VIDEO_ENHANCER_BACKEND="/custom/path/to/rve-backend.py"

# Python executable (optional override)
REAL_VIDEO_ENHANCER_PYTHON="/path/to/python3"

# FFmpeg executable (optional override)
REAL_VIDEO_ENHANCER_FFMPEG="/path/to/ffmpeg"
```

---

## Usage Examples

### cURL

```bash
curl -X POST http://localhost:8765/api/video-enhancer \
  -F "video=@/path/to/input-video.mp4" \
  -F "interpolateFactor=2" \
  -F "upscaleModel=2x-AnimeJaNai_V3_Sharp" \
  -F "backend=pytorch" \
  --output enhanced-video.mp4
```

**Simple upscale only (no interpolation):**
```bash
curl -X POST http://localhost:8765/api/video-enhancer \
  -F "video=@/path/to/input-video.mp4" \
  -F "upscaleModel=4x-SPANkendata" \
  -F "backend=ncnn" \
  --output enhanced-video.mp4
```

### Python

```python
import requests

url = "http://localhost:8765/api/video-enhancer"

# Open video file
with open("input-video.mp4", "rb") as video_file:
    files = {
        "video": ("input-video.mp4", video_file, "video/mp4")
    }
    
    data = {
        "interpolateFactor": "2",
        "upscaleModel": "2x-AnimeJaNai_V3_Sharp",
        "backend": "pytorch"
    }
    
    # Send request
    response = requests.post(url, files=files, data=data)
    
    # Check response
    if response.status_code == 200:
        # Save enhanced video
        with open("enhanced-video.mp4", "wb") as output_file:
            output_file.write(response.content)
        print("Video enhanced successfully!")
    else:
        print(f"Error: {response.json()}")
```

**Error handling example:**
```python
import requests
import sys

def enhance_video(input_path, output_path, upscale_model="2x-OpenProteus", interpolate=None, backend="pytorch"):
    """
    Enhance a video using the Video Enhancer API.
    
    Args:
        input_path: Path to input video file
        output_path: Path where enhanced video will be saved
        upscale_model: Upscaling model name (default: "2x-OpenProteus")
        interpolate: Frame interpolation factor or None (default: None)
        backend: Processing backend - "ncnn", "onnx", or "pytorch" (default: "pytorch")
    
    Returns:
        bool: True if successful, False otherwise
    """
    url = "http://localhost:8765/api/video-enhancer"
    
    try:
        with open(input_path, "rb") as video_file:
            files = {"video": (input_path.split("/")[-1], video_file, "video/mp4")}
            
            data = {
                "upscaleModel": upscale_model,
                "backend": backend
            }
            
            if interpolate and float(interpolate) > 1:
                data["interpolateFactor"] = str(interpolate)
            
            print(f"Enhancing video: {input_path}")
            print(f"Settings: upscale={upscale_model}, interpolate={interpolate}, backend={backend}")
            
            response = requests.post(url, files=files, data=data, timeout=3600)
            
            if response.status_code == 200:
                with open(output_path, "wb") as output_file:
                    output_file.write(response.content)
                print(f"✓ Video enhanced successfully: {output_path}")
                return True
            else:
                error_data = response.json()
                print(f"✗ Enhancement failed: {error_data.get('error', 'Unknown error')}", file=sys.stderr)
                return False
                
    except FileNotFoundError:
        print(f"✗ Input file not found: {input_path}", file=sys.stderr)
        return False
    except requests.exceptions.Timeout:
        print("✗ Request timed out (video processing takes time)", file=sys.stderr)
        return False
    except Exception as e:
        print(f"✗ Error: {str(e)}", file=sys.stderr)
        return False

# Usage
if __name__ == "__main__":
    success = enhance_video(
        input_path="input.mp4",
        output_path="output.mp4",
        upscale_model="2x-AnimeJaNai_V3_Sharp",
        interpolate="2",
        backend="pytorch"
    )
    sys.exit(0 if success else 1)
```

### JavaScript/Node.js

```javascript
const FormData = require('form-data');
const fs = require('fs');
const axios = require('axios');

async function enhanceVideo(inputPath, outputPath, options = {}) {
  const form = new FormData();
  
  // Add video file
  form.append('video', fs.createReadStream(inputPath));
  
  // Add optional parameters
  if (options.interpolateFactor) {
    form.append('interpolateFactor', options.interpolateFactor.toString());
  }
  if (options.upscaleModel) {
    form.append('upscaleModel', options.upscaleModel);
  }
  if (options.backend) {
    form.append('backend', options.backend);
  }
  
  try {
    const response = await axios.post(
      'http://localhost:8765/api/video-enhancer',
      form,
      {
        headers: form.getHeaders(),
        responseType: 'arraybuffer',
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 3600000 // 1 hour timeout
      }
    );
    
    // Save enhanced video
    fs.writeFileSync(outputPath, response.data);
    console.log('Video enhanced successfully!');
    return true;
    
  } catch (error) {
    if (error.response) {
      // Server responded with error
      const errorText = error.response.data.toString();
      console.error('Enhancement failed:', errorText);
    } else {
      console.error('Error:', error.message);
    }
    return false;
  }
}

// Usage
enhanceVideo('input-video.mp4', 'enhanced-video.mp4', {
  interpolateFactor: 2,
  upscaleModel: '2x-AnimeJaNai_V3_Sharp',
  backend: 'pytorch'
});
```

### TypeScript (with fetch)

```typescript
async function enhanceVideo(
  videoFile: File,
  options: {
    interpolateFactor?: number;
    upscaleModel?: string;
    backend?: 'ncnn' | 'onnx' | 'pytorch';
  } = {}
): Promise<Blob> {
  const formData = new FormData();
  formData.append('video', videoFile);
  
  if (options.interpolateFactor) {
    formData.append('interpolateFactor', options.interpolateFactor.toString());
  }
  if (options.upscaleModel) {
    formData.append('upscaleModel', options.upscaleModel);
  }
  if (options.backend) {
    formData.append('backend', options.backend);
  }
  
  const response = await fetch('http://localhost:8765/api/video-enhancer', {
    method: 'POST',
    body: formData,
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to enhance video');
  }
  
  return await response.blob();
}

// Usage in browser
const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
const file = fileInput.files?.[0];

if (file) {
  try {
    const enhancedBlob = await enhanceVideo(file, {
      interpolateFactor: 2,
      upscaleModel: '2x-OpenProteus',
      backend: 'pytorch'
    });
    
    // Create download link
    const url = URL.createObjectURL(enhancedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'enhanced-video.mp4';
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Enhancement failed:', error);
  }
}
```

---

## Processing Details

### Processing Steps

1. **Upload**: Video file is uploaded via multipart form data
2. **Validation**: Server validates the video file and parameters
3. **Temporary Storage**: Video is saved to a temporary directory
4. **Enhancement**: Python backend processes the video with specified options:
   - Frame interpolation (if `interpolateFactor > 1`)
   - Upscaling (if `upscaleModel` is specified)
5. **Resolution Capping**: Output is automatically scaled down to 4K (3840×2160) if it exceeds this resolution
6. **Cleanup**: Temporary files are removed
7. **Download**: Enhanced video is returned as binary data

### Processing Time

- Processing time varies based on:
  - Input video length and resolution
  - Selected upscaling model and interpolation factor
  - Available hardware (CPU/GPU)
  - Backend choice (NCNN is typically faster on CPU)

- **Estimate**: 
  - 1-minute 1080p video with 2x interpolation + 2x upscale: 5-30 minutes
  - Longer videos or 4x upscaling can take significantly longer

### File Size Limits

- No explicit file size limit in the API
- Practical limits depend on:
  - Available disk space for temporary files
  - Server memory and processing capabilities
  - Network upload timeout settings

---

## Best Practices

1. **Timeout Configuration**: Set appropriate timeout values (30+ minutes for typical videos)

2. **Progress Monitoring**: The API doesn't provide real-time progress. Consider:
   - Polling mechanisms for status updates
   - WebSocket implementation for real-time updates (not currently available)

3. **Error Handling**: Always implement robust error handling:
   - Check for 400/500 status codes
   - Parse error messages from JSON responses
   - Implement retry logic for network failures

4. **File Management**: 
   - Validate video files before uploading
   - Clean up local temporary files after processing
   - Handle large file uploads appropriately

5. **Performance Optimization**:
   - Use `ncnn` backend for faster CPU processing
   - Use `pytorch` backend if CUDA GPU is available
   - Consider preprocessing videos to reduce resolution if needed
   - Start with no interpolation to test, then add interpolation

6. **Model Selection**:
   - Use Anime-specific models only for anime content
   - Test different models to find best quality/speed balance
   - 2x models are faster than 4x models
   - Consider using upscaling OR interpolation separately for faster processing

---

## Troubleshooting

### Common Issues

**"REAL-Video-Enhancer backend not found"**
- Ensure REAL-Video-Enhancer is cloned/installed in the correct directory
- Check `REAL_VIDEO_ENHANCER_ROOT` environment variable
- Verify `backend/rve-backend.py` exists in the enhancer directory

**"Enhancement failed: output file not found"**
- Python backend crashed during processing
- Check server logs for Python errors
- Ensure all Python dependencies are installed
- Verify model files are present and valid

**Slow processing**
- Consider using NCNN backend for better CPU performance
- Reduce interpolation factor or use upscaling only
- Use lower resolution input videos
- Ensure GPU drivers are properly configured if using PyTorch

**Connection timeout**
- Increase client timeout settings (processing can take 30+ minutes)
- Check if server is running on correct port (8765)
- Verify firewall/network settings

---

## Server Setup Guide

### Starting the Server

```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

Default port: **8765**

### Verifying Installation

Test the API with a simple curl command:

```bash
curl -X POST http://localhost:8765/api/video-enhancer \
  -F "video=@test-video.mp4" \
  -F "backend=ncnn" \
  --output test-output.mp4
```

If you receive a valid video file, the API is working correctly.

---

## API Integration Checklist

- [ ] Server is running and accessible
- [ ] REAL-Video-Enhancer is properly installed
- [ ] Required model files are present
- [ ] Python environment is configured
- [ ] FFmpeg is available
- [ ] Client has appropriate timeout settings (30+ minutes)
- [ ] Error handling is implemented
- [ ] File validation is implemented
- [ ] Large file upload handling is considered

---

## Support & Additional Information

For issues with the REAL-Video-Enhancer backend itself, refer to:
- REAL-Video-Enhancer documentation in `./REAL-Video-Enhancer/README.md`
- Backend requirements in `./REAL-Video-Enhancer/backend/requirements.txt`

For API-specific issues, check:
- Server logs (stdout/stderr)
- Environment variable configuration
- Network and firewall settings
