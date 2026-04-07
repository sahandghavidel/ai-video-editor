# OmniVoice Local Integration (Apple Silicon)

This folder contains the isolated OmniVoice runner used by `src/app/api/generate-tts-omnivoice/route.ts`.

## What it does

- Runs OmniVoice voice-cloning inference locally via Python
- Targets Apple Silicon by default (`device_map=mps`)
- Saves WAV output to a temporary file for upload by the API route

## Setup (Apple Silicon)

1. Create/use a Python environment (your project `.venv` is recommended).
2. Install dependencies from this folder's `requirements.txt`.
3. Ensure your HF token is available as `HF_TOKEN`.

## Reference audio files

Voice cloning requires a reference audio file.

By default, relative reference filenames are resolved from:

- `OMNIVOICE_REFERENCE_AUDIO_DIR` (if set), else
- `omnivoice-local/references/`

You can also pass an absolute path as `referenceAudioFilename`.

## Key env vars

- `OMNIVOICE_PYTHON` (optional): explicit Python path
- `OMNIVOICE_REFERENCE_AUDIO_DIR` (optional): default folder for reference audio
- `HF_TOKEN` (recommended): Hugging Face token for model download/access
