# Gemini TTS: Standard and Batch

In **Global Settings → TTS → Manage Language Presets**, choose Google Gemini for a language, then set **Generation mode** and save presets.

- **Standard** is the default for new and existing presets. It retains the existing Interactions API, request pacing, concurrency, 429 handling, and scene recovery. Local providers are unchanged.
- **Batch** applies to Create Dubbed (individual and multi-language/pipeline callers). Individual scene regeneration continues to use Standard. Every unfinished spoken scene has its own request and result; sentences are not combined into one recording. Silent scenes use the existing local silence/effects path.

Google's [Batch API](https://ai.google.dev/gemini-api/docs/batch-api) advertises 50% of Standard pricing with a target turnaround of 24 hours. Batch can finish much sooner, but equal/faster completion than Standard is not guaranteed. There is no automatic paid Standard fallback.

## Processing and recovery

The existing SRT preparation runs first. The application then snapshots the selected preset, scene/video identities, text, duration, ordering, video/effect inputs and destination fields into a durable job. It returns HTTP 202 with a job ID. All Create Dubbed callers poll until the final audio is merged and saved; submission is not success. Failed Batch jobs set `stopLanguageBatch` so the current pipeline does not silently advance to another language.

The page receives its saved job list directly from the server; an idle page makes no Batch status HTTP requests. Polling begins only for pending or newly submitted/retried jobs and stops when they finish or fail.

Batch progress and failures are recorded in the terminal; no floating notification is displayed. Refreshing the browser does not lose the current job. Server startup and job/status requests resume unfinished jobs. The original browser pipeline itself does not survive a page reload; the saved current video/language job does. Leave the local application server running to collect and process results. Google continues its submitted work while the app is off.

Active Google operations are checked every **10 seconds** (after the preceding check finishes), without a Baserow scene-list fetch on each poll. Results are matched using unique request keys, never output order. Unknown or duplicate keys block import. Before importing/saving and again before merging, the application checks the current preset and scene snapshot. Changed inputs block saving stale audio. Existing scene fitting, effects, original/dubbed Baserow fields, MinIO uploads, and strict merge completeness validation are reused.

After validating all result keys, each decoded WAV enters the processing queue as soon as its durable file/checkpoint is ready; later WAVs need not finish first. Fitting uses this local WAV while the original uploads to MinIO. A per-scene upload sidecar preserves the original URL across retries/crashes. Each save checks the specific scene row and numeric Videos ID (`field_6889`, returned as a numeric string by Baserow); the full scene snapshot is still validated before import/recovery and merge. Successful scenes are processed before waiting for missing-generation recovery.

`[Gemini Batch]` logs record result-download time, completion detection lag (when Google supplies endTime), WAV decode/save, original upload, fitting/dubbed upload, original/dubbed Baserow saves, and total scene processing time.

Failed generation is retried after **60 seconds**, for **two recovery rounds**, using only missing audio. Successful WAVs stay on disk. Upload/fit/scene-save failures get two retries using those WAVs; they do not request new Google audio. Merge/save gets two retries too. Explicit retry through the Batch jobs API resets the recovery budget and preserves successful scenes/audio.

Batch create is not idempotent. The display name and submission intent are saved before sending. After an uncertain network acknowledgement, the app lists Google's operations and reconciles that unique display name; it never blindly repeats the paid submission. If Google never reports it, the job stays pending with an explanatory message for investigation.

## Runtime and configuration

- The existing server-only `GEMINI_API_KEY` is used. No additional credentials or Baserow fields are needed.
- Optional `GEMINI_TTS_BATCH_PROCESSING_CONCURRENCY` controls Batch processing/upload/save workers: default **6**, bounded **1–12**. Optional `GEMINI_TTS_BATCH_FITTING_CONCURRENCY` independently caps simultaneous Batch FFmpeg fitting/effects work across jobs: default **3**, bounded **1–4**. Neither changes Standard concurrency or local TTS generation.
- Job manifests and original WAVs live under **`.cache/gemini-tts-batches/<job-id>/`** (git-ignored). Keep this folder across server restarts. It contains narration text and generated media; do not commit or share it. No provider keys are written there. Completed job records/audio are retained for recovery and investigation; archive/remove them only after verifying completion and when no job is running.
- This worker is designed for the existing persistent local Node server. It is not a serverless queue, OS service, or new local-model service.
- Inline request bodies are capped below Google's 20 MB input limit; oversized jobs fail explicitly. Large JSONL/file-based submissions are not implemented.

## Validation and user test

Offline checks (no provider/DB/storage calls):

```bash
node --test scripts/checks/gemini-tts-concurrency.cjs scripts/checks/gemini-tts-batch.cjs scripts/checks/gemini-tts-batch-polling.cjs
```

To test on real media: select one Gemini language preset, switch it to Batch, save, and run Create Dubbed on a video with unfinished scenes. Watch the terminal `[Gemini Batch]` logs, then listen to the saved final audio. Completed scenes are skipped. Switch the preset back to Standard for normal response latency. The full paid video generation is intentionally left to the user.
