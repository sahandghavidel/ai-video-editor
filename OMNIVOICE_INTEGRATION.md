# OmniVoice TTS Integration (Apple Silicon)

This project now includes OmniVoice as a new TTS provider option.

## Added provider

- Provider key: `omnivoice`
- Frontend option: **OmniVoice (Apple Silicon)** in `TTS Settings`
- API route: `/api/generate-tts-omnivoice`
- Local runner: `omnivoice-local/run_omnivoice_tts.py`

## Voice-cloning mode

This integration is configured for **voice cloning**.

Required inputs:

- `text`
- `referenceAudioFilename` (or `ttsSettings.reference_audio_filename`)

The reference audio path is resolved by:

1. Absolute path (if provided), or
2. `ttsSettings.omniVoice.referenceAudioDir`, or
3. `OMNIVOICE_REFERENCE_AUDIO_DIR`, or
4. `omnivoice-local/references/`

## Apple Silicon defaults

- `deviceMap = mps`
- `dtype = float16`
- `PYTORCH_ENABLE_MPS_FALLBACK = 1`

## New environment knobs

Template values are in root `.env`:

- `OMNIVOICE_PYTHON`
- `OMNIVOICE_REFERENCE_AUDIO_DIR`
- `HF_HOME`

Model access uses existing `HF_TOKEN`.

## Install dependencies (in your chosen Python env)

Install from:

- `omnivoice-local/requirements.txt`

## Notes

- Existing providers (`chatterbox`, `fish-s2-pro`) are unchanged.
- OmniVoice outputs WAV and uploads it to MinIO in the same pattern as existing TTS flows.
