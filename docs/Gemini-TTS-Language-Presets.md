# Gemini TTS language presets

Open Global Settings → TTS → Manage Language Presets. Each enabled language preset
chooses `omnivoice` (local) or `gemini` (online). The enabled default preset for
the requested language is used, or the first enabled preset if none is marked
default. Presets without a provider continue to use OmniVoice.

The existing JSON store (`src/data/tts-audio-references.json`) now persists
`provider` and `gemini: { voice, style }`. Local reference audio, decoding steps,
device, dtype, and speed remain saved when switching providers. Gemini presets
do not need a local audio filename. Baserow mappings and enabled/default flags
remain shared. Configure `GEMINI_API_KEY` once in server-only `.env.local`; never
put a key in a preset, browser storage, or a `NEXT_PUBLIC_` variable.

`POST /api/create-dubbed-fa` remains the configured-language endpoint used by
individual-video and batch generation. It snapshots the language preset and
passes its provider/settings to `/api/generate-scene-tts-by-field`. Gemini uses
`/api/generate-tts-gemini`, which calls Google's Interactions REST API with
`gemini-3.8-flash-tts` and structured speech metadata. It uploads the returned
24 kHz mono WAV through the existing MinIO helper. The shared scene workflow
saves raw audio, fits to scene duration at 48 kHz, applies optional effects to
the fitted output, saves dubbed audio, and merges through the existing route.
No new Baserow fields are required. For FA, the existing text/raw/dubbed/final
fields are `field_7110`, `field_7117`, `field_7111`, and `field_7113`.

Featured studio voices are selectable in the editor. Charon is Google's male,
low-pitched, informative voice for technical explainers. Delivery style is sent
as metadata, separate from the spoken transcript. OmniVoice decoding-step boosts
apply only to local generation. The global English TTS selector and local
English reference-audio picker retain their separate behavior.

For a persistent designed narrator, create a voice once with Google's
[Voice design](https://ai.google.dev/gemini-api/docs/voice-design) endpoint or
AI Studio, then paste the returned `voice_…`
ID in the always-visible **Voice name or cloned voice ID** field. The dropdown
labels this option **Other voice ID — extended, cloned or designed** and accepts replicated
voice IDs as well. Use the same Google project as `GEMINI_API_KEY`. The preset stores this ID
in `gemini.voice` and reuses it for every scene; generation never designs a
new voice automatically. Define permanent accent, age and timbre in the design
prompt and keep delivery style brief. Google currently documents a one-year
TTL for saved voices. Custom IDs are syntax-checked locally; Google checks
their existence/access during generation. A fixed ID does not guarantee
identical delivery, and duration fitting can still change perceived pace.

Extended prebuilt voice IDs such as `en-us-ludo` are also accepted. Ludo is
included in the featured dropdown. Other extended IDs are syntax-checked
locally; Google validates availability during generation. Provider errors
are reported without silently selecting a different voice.

Changing a preset affects subsequent jobs; already-generated dubbed scenes are
still skipped. Explicit regeneration is required to replace existing audio.
Provider failures stop scheduling new Gemini scenes, with the failed scene reported;
already-running scenes finish and save before the batch returns. The merge waits
for all these scenes and is not started when the batch reports failure. Local
providers, including Persian Chatterbox, OmniVoice and OmniVoice LoRA, keep their
sequential scene generation/regeneration behavior.

No fallback to another provider occurs. HTTP 429 rejections are retried
inside the Gemini provider (at most twice, using the same text and voice).
Network failures, timeouts, completed generations with invalid audio, and
upload/save failures are not automatically regenerated. Re-running
skips scenes successfully saved earlier. This avoids unbounded billable retries,
but a generation that succeeded before a failed upload/save can still be billed
again on an explicit retry.

Gemini dubbing automatically uses a bounded scene pool. Each scene keeps its
own audio file, original/fitted fields, and save result. This uses ordinary
interactive API requests, not Google's asynchronous Batch API. Skipped scenes
(existing audio, missing text/duration, or scene filters) retain their existing
behavior. The scene pool drains before returning, so fitting/saves finish before
the caller can proceed to merging.

Gemini permits are shared across jobs and provider-route instances in the same
server process. The default is **10 concurrent Gemini generations**, with at
least **1 second between Google request starts** (at most 60 starts/minute).
These server-only environment settings in `.env.local` can change the pacing:

```dotenv
GEMINI_TTS_MAX_CONCURRENT=10
GEMINI_TTS_MIN_INTERVAL_MS=1000
```

Concurrency accepts positive safe integers; it has no fixed ceiling of five.
The interval accepts integer milliseconds of at least 1000. Invalid/omitted
values use the defaults above. Restart the Next.js server after changing these
settings. Local providers do not read them. The settings are not stored in
language presets or browser localStorage.

Every HTTP 429 pauses all new Google request starts for 60 seconds, including
retries and other jobs. Requests already sent can complete. Later 429s extend
the cooldown, and waiting requests recheck it before starting. The affected
scene retries at most twice, retaining its text, voice and delivery settings.
After three unsuccessful attempts, it reports Google's original error and its
batch stops scheduling new scenes. Other in-flight scenes are allowed to save.
Permits are released on success or failure; a queued scene does not block all
other scenes for its entire generation duration.
Repeated 429s do not prove that a daily quota was reached; the error details
identify the exhausted quota. Quotas are project-wide: other
applications/processes (including AI Studio) share them. The
verified project quota on October 16, 2026 was Tier 2: 1,000 requests/minute,
100,000 input tokens/minute, and 10,000 requests/day for Gemini 3.8 Flash TTS.
Google applies the project's tier automatically; no API tier parameter or key
replacement is needed. These are rate/token/day quotas, not a published limit
on simultaneous requests. Pacing does not reserve quota or lift the
daily limit or guarantee avoiding token limits for large inputs; an unresolved
quota failure stops the job so it can be resumed later. Queue state is shared
across development reloads, but resets when the server process restarts. Separate
server processes do not share these in-memory permits; their combined traffic
and AI Studio still consume the same project quotas.

Offline concurrency/retry/local-isolation checks (no external calls):

```bash
node --test scripts/checks/gemini-tts-concurrency.cjs
```

References: [Google TTS guide](https://ai.google.dev/gemini-api/docs/speech-generation)
and [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

### Gemini scene recovery and errors

Configured-language dubbing adds two recovery rounds for Gemini only. After the
scene batch drains all in-flight saves, it waits 60 seconds, then submits only
failed and unattempted scene IDs with `skipIfDestinationExists: true`. Each round
refetches scene records, preserving completed dubbed scenes and their audio.
Original-only scenes are still incomplete and may require a new generation.
The second round targets only the scenes still incomplete after the first.
The existing global pacing, concurrency, and provider-level 429 cooldown remain
in effect; those 429 retries can add further waiting inside a recovery round.

If recovery is exhausted, final merging stays blocked and the multi-language
Create Dubbed batch stops before advancing to another language. Other providers
retain their existing behavior. The recovery scope and wait/retry count live in
`src/lib/geminiSceneRecovery.ts`. Requests without identifiable failed/unfinished
scene IDs are not blindly retried.

Gemini request failures log video/scene ID, model, stage, HTTP status, elapsed
time, and nested error causes. Provider keys are redacted. Scene failures and
the final merge-blocking summary are logged even when verbose fitting logs are
disabled. The response includes actual failure messages for the calling UI.

These are bounded automatic retries, not durable background jobs: stopping the
Next.js process interrupts recovery. Re-running dubbing retains saved completed
scenes through the existing skip-completed behavior.
