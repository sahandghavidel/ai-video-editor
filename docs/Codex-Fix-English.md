# Codex Fix English pipeline step

An opt-in pipeline option immediately after **Fix Language All** and before **Improve**. It defaults to off, persists in settings/templates, and can run independently of Fix Language All. Existing provider selection and language-fix behavior are unchanged.

The browser submits only `{ "videoId": 1628 }` to `POST /api/codex-fix-english`. The server launches a detached local Node worker and returns HTTP 202 with a job ID. The worker invokes `codex exec` with the installed `fix-video-english` skill path and video ID. Codex discovers and edits the complete ordered scene set through direct Baserow REST access. No scene array or narration is passed in the task prompt. Codex does read narration from Baserow to perform the review.

## Requirements

- Run the application locally via `localhost` or `127.0.0.1`; these process-launching endpoints reject cross-origin browser requests and non-local hostnames.
- Codex CLI installed and signed in with **ChatGPT** (`codex login`). The worker checks sign-in before launching a task, strips API-key overrides and selects the OpenAI provider. Normal account usage limits apply. No separate model API key is needed for this step.
- The existing Baserow configuration in `.env.local` and the installed skill. The worker uses dotenv and supports both database-token and JWT authentication, with one JWT refresh on HTTP 401.
- The CLI uses a workspace-write sandbox with network access enabled for Baserow. It runs non-interactively with approvals disabled. Skill instructions limit it to Sentence edits; this is an agent instruction boundary, not a Baserow field-level permission boundary. The independent verifier blocks continuation if another writable field changed, but cannot prevent or undo an agent mistake.

Optional server environment variables:

| Variable | Default |
|---|---|
| `CODEX_EXECUTABLE` | Search PATH, then known macOS app-bundled CLI locations |
| `CODEX_FIX_ENGLISH_SKILL_PATH` | `~/.codex/skills/fix-video-english/SKILL.md` |
| `CODEX_FIX_ENGLISH_TIMEOUT_MS` | 2700000 (45 minutes), bounded to 1 second–2 hours |

The Codex model follows the user's Codex configuration; this step does not use the application's online/local model selector.

## Completion and data scope

The skill must update only changed `field_6890` (Sentence) values. It must not use the existing local scene PATCH route, which invalidates TTS. It must preserve confirmation fields, audio, translations, media, membership and fractional ordering, and recheck originals before saving. The worker reads a verification baseline in memory, then independently re-fetches schema/rows after Codex exits. The report must match the video, reviewed-scene count, exact changed row set and SHA-256 hashes of saved sentences. Other writable fields must remain equal. A legitimate no-change review succeeds. Empty scene sets, partial results, conflicts and missing verification fail.

`GET /api/codex-fix-english/jobs/{jobId}` returns only status and summary. The browser awaits verified completion for every target video before moving to Improve or the next enabled step. A 202, process exit code zero, or natural-language success message alone cannot release the pipeline. Advisory wording issues appear in the summary; unresolved save/review failures must be reported as a failed or needs-attention result and stop continuation.

Video selection follows the frozen Processing/Pending pipeline target and the existing Fix Language All rule for skipping videos without an uploaded URL. All scenes in each selected video are reviewed, including scenes already marked fixed. This step does not write the legacy fixed-sentence confirmation field.

**Improve runs afterward if enabled and can rewrite the protected text. Disable Improve in a configuration where the Codex result should go directly into TTS.** Existing audio is retained by this step; later TTS behavior remains unchanged.

## Jobs, cancellation and recovery

Job summaries and fingerprint reports live in ignored `.cache/codex-fix-english/`; source narration snapshots remain in worker memory. Raw Codex events and tool output are consumed without being forwarded to the UI or written to application logs. Codex is invoked with `--ephemeral`.

A short disk coordination guard serializes lock creation/release across server and worker processes. An abandoned `.guard` directory is not automatically stolen: after confirming no job/worker is running, remove that video’s empty `.guard` directory under `.cache/codex-fix-english/` if an initialization crash left it behind.

A video lock prevents overlapping Codex jobs for the same video, including across Next hot reloads. Repeated submissions reconnect to an active job. A failed, cancelled or interrupted job remains locked until reviewed and acknowledged in the status panel. Acknowledgment permits a new run; it does not revert earlier writes. A failed run is never automatically retried. The worker also honors a cancellation marker and terminates the Codex process group. A dead worker is marked interrupted, not silently restarted. If its recorded Codex child is still alive, acknowledgment cannot release the lock yet.

Use **Cancel Codex job** in the pipeline configuration status panel to request cancellation. For terminal failures, review the video, then use **I reviewed the result — allow a new run**. The panel reconnects to the most recently started job using localStorage. A temporary loss of status keeps the pipeline pending; repeated failures stop the browser pipeline with an explicit warning that the background job may remain active.

The detached job can survive a browser refresh or Next reload. The complete pipeline remains browser-driven; refreshing the page does not automatically resume its remaining steps. Avoid concurrent manual narration edits while this step runs. Pre-save comparisons are not a transactional Baserow compare-and-swap; the independent verifier detects conflicts but does not roll back edits.

## Offline validation and manual test

Run `node --test scripts/checks/codex-fix-english.cjs`. Fixtures use a temporary fake CLI and local HTTP server; they never call real Codex, production Baserow, TTS or providers.

For a manual video test, set the target status to include only the intended video, enable **Codex Fix English**, disable other steps you do not want to run, then run the pipeline. To check automatic continuation later, enable the desired successor. A success summary shows reviewed/changed scene counts and Saved and verified. Do not select an entire status group unless you intend to process all eligible videos in that group.
