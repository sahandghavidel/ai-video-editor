# Isolated Persian Chatterbox

FA presets can select `chatterbox-persian` (Chatterbox Persian — Isolated Local).
Other language presets cannot select it. The existing `/api/generate-tts` and
`/Users/sahand/chatterbox-tts-server` environment remain unchanged.

The separate installation is `/Users/sahand/chatterbox-persian-tts`, with its own
`.venv`, cache and downloaded Persian checkpoint. Start it explicitly with:

```sh
/Users/sahand/chatterbox-persian-tts/start.sh
```

It binds to `127.0.0.1:9547`. No new credentials or Baserow fields are needed.
The application route `/api/generate-tts-persian` calls this service and uploads
PCM16 WAV to the existing MinIO bucket. Dubbing uses the same raw/fitted scene
fields, duration fitting and skip-existing behavior. FA preflight verifies the
service before pipeline mutations. It does not automatically start/restart any
existing TTS process.

The initial integration uses the checkpoint's built-in speaker. The FA preset's
old OmniVoice reference filename and Gemini settings are retained for rollback;
this provider does not interpret them as Chatterbox voice IDs. The standalone
service supports a local `reference_audio` path for independent cloning tests.

Switch FA back to Gemini or OmniVoice to restore its prior routing. No changes
to English/global Chatterbox are required. The checkpoint is CC-BY-NC-4.0;
commercial use requires appropriate permission from the model owner.

Validation: Persian model generated WAV on MPS; application route returned 200
and uploaded audio to MinIO. No full Baserow video batch was run.

## Persian preset controls
FA presets persist a separate `persian` settings object: optional absolute local
voice-reference path, seed (42), exaggeration (0.5), CFG weight (0.5), temperature
(0.8), repetition penalty (2), top-p (1), min-p (0.05), and audio decoder steps (10).
The dubbing route passes these to the isolated service. Empty reference restores
the built-in narrator; a recording conditions the voice without training.
Steps control S3 audio decoding, not OmniVoice iteration count. No original
Chatterbox dependencies or other language providers are changed.

Persian presets now reuse Audio Filename and the shared OmniVoice reference
resolver (OMNIVOICE_REFERENCE_AUDIO_DIR, then omnivoice-local/references).
Device (auto/mps/cpu), Num Step, and Speed use the existing preset fields and
layout. Speed uses FFmpeg atempo. Reference Text remains saved but is disabled
for Persian because this model conditions on audio only. DType displays fixed
float32; lower precisions are not yet validated. Advanced Persian sampling
controls remain separate. Changing device reloads only the isolated model.

Memory update: the isolated service copies original engine.py memory-policy
functions and mps_optimizer.py into its own directory. Uses original 200-char
sentence chunking and pressure thresholds, cleanup around chunks, and OOM retry.
Runtime torch/torchaudio 2.8.0 and transformers 4.57.0 match original; Chatterbox
0.1.7 stays for Persian checkpoint compatibility. These are explicit overrides
of upstream package pins, pending user generation tests. Analyzer CPU copies
select the used head first; no original server files or environments modified.

On-demand startup: the application checks Persian service health before FA
dubbing or direct Persian TTS generation. If stopped, it starts start.sh as a
detached process and waits up to 30 seconds before continuing the same request.
Concurrent requests share startup. No macOS login agent is required.
Logs: /Users/sahand/chatterbox-persian-tts/service-memory.log.

Full startup audit: original generate-tts route starts a detached server on demand
and shuts down after 15 idle minutes. Persian follows that lifecycle through
persianTtsRuntime, with concurrent-generation protection and a Persian-only PID.
Original API sentence chunking (chunk_size=50, split threshold=75 chars) is copied
verbatim from original utils.py into original_chunking.py, ahead of engine policy.
The Persian loader still loads on first speech request; original loads in background.
No login service is installed; stopping the service triggers startup on next use.
