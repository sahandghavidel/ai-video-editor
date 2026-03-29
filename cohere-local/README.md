# Cohere Local Transcription (Isolated Module)

This folder is a **standalone** local transcription path for:

- `CohereLabs/cohere-transcribe-03-2026`
- No changes to your existing Parakeet/Whisper scripts

## Why isolated

You requested a safe setup that does not affect your current transcription flow.
Everything here is separate and only used by dedicated endpoints under:

- `/api/cohere-local/transcribe-video`
- `/api/cohere-local/transcribe-scene`

## Requirements

1. You must accept model access terms on Hugging Face for:
   - `CohereLabs/cohere-transcribe-03-2026`
2. Provide a Hugging Face token with read access (`HF_TOKEN` or `HUGGINGFACE_HUB_TOKEN`).
3. Install Python deps in your chosen environment:
   - See `requirements.txt` in this folder.
4. `ffmpeg` must be available in PATH.

## Recommended env vars (`.env.local`)

- `COHERE_TRANSCRIBE_PYTHON=/absolute/path/to/python`
- `HF_TOKEN=hf_xxx`
- `COHERE_TRANSCRIBE_MODEL=CohereLabs/cohere-transcribe-03-2026`
- `COHERE_TRANSCRIBE_LANGUAGE=en`
- `COHERE_TRANSCRIBE_PUNCTUATION=1`
- `COHERE_TRANSCRIBE_MAX_NEW_TOKENS=512`
- `COHERE_TRANSCRIBE_DEVICE=auto` (`auto|cpu|cuda|mps`)

## Output format

The script returns JSON compatible with your existing UI expectation:

- `response.text`
- `response.segments[].words[]`
- `response.duration`

> Note: word timestamps are currently generated as evenly distributed placeholders.
> If you want true token-level timestamps, we can add a second pass alignment step.
