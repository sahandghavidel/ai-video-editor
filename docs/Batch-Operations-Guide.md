# Batch Operations Guide

This guide documents how batch operations work in this project, with a focus on the **Original Videos** panel and the "Batch Operations For all Videos with Processing Scenes" section.

Use this as the source of truth whenever adding a new batch action.

---

## 1) Source of truth files

- `src/components/OriginalVideosList.tsx`
  - Primary batch handlers and UI buttons
  - Pipeline orchestration (`handleRunFullPipeline`)
  - Completion notification helpers:
    - `notifyBatchOperationCompleted(operationName)`
    - `playSuccessAndNotifyBatchCompletion(operationName)`
- `src/utils/batchOperations.ts`
  - Shared batch utilities used by some handlers
  - Important: several utility flows already call `playSuccessSound()` internally
- `src/utils/notifications/telegram.ts`
  - Client helper used by UI code to send Telegram notifications via API
- `src/app/api/notifications/telegram/route.ts`
- `src/server/notifications/telegram.ts`

---

## 2) Mental model of batch actions

There are three common batch-action patterns in this codebase:

1. **Component-owned batch handler**
   - Entire flow lives in `OriginalVideosList.tsx`
   - Handler is responsible for success sound + Telegram completion

2. **Utility-driven batch handler**
   - `OriginalVideosList.tsx` calls a helper from `src/utils/batchOperations.ts`
   - Utility may already play success sound
   - Component should send Telegram completion after utility returns

3. **Inline scene-level button wrapper**
   - Button runs an inline async wrapper in JSX
   - Wrapper toggles loading state, calls handler, refreshes data, sends completion notification

All three patterns are valid in the current implementation.

---

## 3) Standard execution flow (expected shape)

Most batch handlers follow this lifecycle:

1. Guard against duplicate runs (`if (isRunning) return`)
2. Set loading state and clear previous error
3. Fetch fresh video/scene data
4. Filter to eligible items (usually `status === 'Processing'`)
5. Process sequentially (with small delays where needed)
6. Refresh view state (`handleRefresh()` and/or `refreshScenesData()`)
7. On success:
   - play success sound
   - send Telegram completion message with operation name
8. On failure:
   - play error sound
   - set error text (or intentionally keep silent for some flows)
9. Always reset loading state in `finally`

---

## 4) Completion and Telegram notification rules

### Rule A — If this handler owns success sound

Use:

- `await playSuccessAndNotifyBatchCompletion('<Operation Name>')`

This ensures both success audio and Telegram message happen together.

### Rule B — If utility already plays success sound

Use:

- `await notifyBatchOperationCompleted('<Operation Name>')`

Do **not** duplicate success audio in component code when the utility already handles it.

### Rule C — Notify at operation completion, not per item

Send one completion message only after the whole batch operation succeeds (or gracefully completes).

### Rule D — Keep message names stable

Telegram message format is:

- `✅ Batch operation completed: <Operation Name>`

Use concise names that match button intent (examples: `TTS All`, `Sync All`, `Merge Scenes`).

---

## 5) Current operation-name conventions

Existing completion names include:

- `TTS Script`
- `TTS Video`
- `Transcribe All`
- `Transcribe Final All`
- `Desc All`
- `Keywords All`
- `Titles All`
- `Timestamps All`
- `Thumbs All`
- `Script From Title`
- `Improve All`
- `TTS All`
- `Sync All`
- `Speed Up All`
- `Delete Empty`
- `Fix TTS`
- `Prompt Scenes`
- `Combine Pairs`
- `Silence Opt All`
- `Normalize All`
- `CFR All`
- `CFR Final All`
- `Merge Scenes`
- `Merge Final`
- `Timestamps`
- `Gen Clips All`
- Scene-level buttons:
  - `Subtitles`
  - `Images`
  - `Upscale`
  - `Scene Videos`
  - `Enhance Videos`
  - `Apply Video`
  - `Apply Image`

When adding a new operation, pick a name consistent with this style.

---

## 6) How to add a new batch operation (checklist)

### Step 1: Decide operation type

- Video-level, scene-level, or pipeline-only step?
- Component-owned or utility-driven?

### Step 2: Add state

- Add loading state in `OriginalVideosList.tsx` near related states
- Follow existing naming style:
  - boolean: `isSomethingAll` / `somethingAll`
  - item id: `current...Id`

### Step 3: Implement handler

- Add a `handle...` function in `OriginalVideosList.tsx`
- Use `try/catch/finally`
- Filter by processing status when applicable
- Keep loops resilient (log and continue per-item when possible)

### Step 4: Wire completion notification correctly

- If handler plays success sound itself:
  - call `await playSuccessAndNotifyBatchCompletion('<Name>')`
- If utility already plays success sound:
  - call `await notifyBatchOperationCompleted('<Name>')`

### Step 5: Add button in Batch Operations panel

- Add new button inside batch grid in `OriginalVideosList.tsx`
- Hook `onClick` to handler
- Add robust `disabled` conditions to avoid collisions with conflicting long-running operations
- Keep label concise and consistent with completion name

### Step 6: (Optional) Add to full pipeline

- If operation should run in `handleRunFullPipeline`:
  - add gated step with `pipelineConfig` flag
  - update pipeline step text
  - refresh data after completion
  - maintain strict sequence dependencies

### Step 7: Validate

- Run lint on touched files
- If possible, run build or a targeted smoke test
- Manually verify:
  - button loading/disabled behavior
  - refresh behavior
  - success sound behavior
  - Telegram completion message

---

## 7) Pipeline integration order notes

When integrating with full pipeline, maintain dependency-sensitive order.

Important ordering already enforced:

- Scene post-processing block:
  - `Subtitles -> Images -> Upscale -> Scene Videos -> Enhance Videos -> Apply Video -> Apply Image`
- Final tail block:
  - `Merge Scenes -> Transcribe Final All -> Description -> Keywords -> Titles -> Timestamps -> Thumbnails`

Only insert new steps where their input requirements are guaranteed.

---

## 8) Common pitfalls

- Sending Telegram per scene instead of per batch
- Double-playing success sound (component + utility)
- Forgetting to clear loading states in `finally`
- Missing `refreshScenesData()` for scene-driven actions
- Adding a button without collision-safe `disabled` guards
- Adding pipeline step without proper ordering or waits

---

## 9) Quick implementation template (process, not copy-paste)

1. Add state flags
2. Create `handleMyNewBatchOperation(playSound = true)`
3. Fetch fresh data and compute eligible items
4. Process sequentially with error isolation
5. Refresh UI data
6. On success call appropriate completion helper
7. On failure play error + set error text
8. Add button + disabled conditions
9. Add optional pipeline step if needed
10. Lint + verify Telegram completion message

---

## 10) Ownership note

This guide is intentionally practical and tightly coupled to current implementation in `OriginalVideosList.tsx`. If batch architecture changes (for example moving to dedicated hooks/services), update this file first.
