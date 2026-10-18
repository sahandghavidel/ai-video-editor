# Removed TTS providers

On 2026-10-18 the user requested removal of both ordinary Chatterbox and Fish Audio, after the earlier isolated Persian Chatterbox removal. These providers are no longer offered or routed by the application. Their dedicated generation routes, auto-start/timeout code, UI controls and settings types were removed.

Global TTS now supports OmniVoice and the versioned OmniVoice fine-tuned-model route. Existing OmniVoice/LoRA choices are preserved. Persisted selections of retired providers migrate to ordinary OmniVoice; seed, reference filename and OmniVoice options remain. Obsolete Fish credentials/settings and Chatterbox sampling fields are stripped during both localStorage load paths, updates and saves. Defaults and reset use OmniVoice. The selected-provider API rejects unsupported provider IDs. Scene/video generation uses the remaining OmniVoice route; Gemini language presets and recovery behavior remain separate and unchanged.

The known ordinary server installation `~/chatterbox-tts-server`, its ResembleAI Hugging Face model cache and retired Fish s2-pro cache entry were removed. Fish Audio's expected local `fish-speech-s2-pro` installation was absent. Retired Fish environment variables were removed from `.env.local` without copying or exposing their values. No remote Fish account, subscription or API key was revoked by this change.

Existing English/Persian models, language presets, original audio collections, generated media and MinIO/Baserow records were preserved. Standalone source projects elsewhere on disk were not deleted; user-authored server source/workflows were retained outside the application. Local removal evidence and file manifests are in `~/Documents/Legacy-TTS-Removal/`.

Validation covers saved-settings migration through actual load/update/save/reset code, supported/retired provider dispatch, Gemini and OmniVoice routing regression checks, scoped lint, browser inspection and retired-route HTTP responses. No paid generation, full video generation, production build or full dev-service restart was performed. Pre-existing lint warnings in SceneCard and OriginalVideosList are unrelated to these routing edits.
