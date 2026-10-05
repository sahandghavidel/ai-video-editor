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
Provider failures stop Gemini scene batches, with the failed scene reported;
no fallback to another provider occurs. HTTP 429 rejections are retried
inside the Gemini provider (at most twice, using the same text and voice).
Network failures, timeouts, completed generations with invalid audio, and
upload/save failures are not automatically regenerated. Re-running
skips scenes successfully saved earlier. This avoids unbounded billable retries,
but a generation that succeeded before a failed upload/save can still be billed
again on an explicit retry.

Gemini generation is queued within this server process: only one Google
request runs at a time, with at least 10 seconds between request starts (at
most 6 requests/minute). Generation time counts toward those 10 seconds: a
4-second generation leaves a 6-second wait before the next request; a
12-second generation needs no extra wait. Every HTTP 429 pauses the shared
queue for 60 seconds before retrying the same scene. If the first retry
also returns 429, wait another 60 seconds and retry once more. After three
unsuccessful attempts, generation stops and reports Google's original error.
Repeated 429s do not prove that a daily quota was reached; the error details
identify the exhausted quota. Quotas are project-wide: other
applications/processes (including AI Studio) share them. The
observed Tier 1 quota in October 2026 was 10 requests/minute, 10,000 input
tokens/minute, and 100 requests/day. Pacing does not reserve quota or lift the
daily limit or guarantee avoiding token limits for large inputs; an unresolved
quota failure stops the job so it can be resumed later. Queue state is shared
across development reloads, but resets when the server process restarts.

References: [Google TTS guide](https://ai.google.dev/gemini-api/docs/speech-generation)
and [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).
