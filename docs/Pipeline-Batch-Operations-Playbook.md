# Pipeline + Batch Operations Playbook

This document explains how the current **Full Pipeline** works in this repository and how to add a new batch operation correctly (button-only or pipeline-integrated) so future changes remain safe and predictable.

Checked against current implementation in:

- `src/components/OriginalVideosList.tsx`
- `src/components/PipelineConfig.tsx`
- `src/store/useAppStore.ts`
- `src/app/api/fix-language-scenes/route.ts`

---

## 1) Source of truth (where to read first)

1. **Pipeline orchestrator + batch handlers**
   - `src/components/OriginalVideosList.tsx`
   - Main orchestrator: `handleRunFullPipeline`

2. **Pipeline UI toggles**
   - `src/components/PipelineConfig.tsx`
   - Defines which steps are visible/toggleable in the UI

3. **Pipeline config schema + defaults + persistence**
   - `src/store/useAppStore.ts`
   - `PipelineConfig` interface
   - `defaultPipelineConfig`
   - `updatePipelineConfig`, `togglePipelineStep`, `resetPipelineConfig`

---

## 2) How Full Pipeline works today

## 2.1 Entry point and lifecycle

- Triggered by **Full Pipeline** button in `OriginalVideosList.tsx`
- Guard: requires `sceneHandlers` to exist
- Runtime state:
  - `runningFullPipeline` (locks many conflicting buttons)
  - `pipelineStep` (human-readable progress text)
- Behavior:
  - Runs steps sequentially
  - Each step is gated by `pipelineConfig.<stepKey>`
  - Most step blocks use `try/catch` and throw on failure to stop the pipeline
  - Final success sends Telegram summary + success sound
  - Failure sends error sound + sets `error`

---

## 2.2 Real step order used by `handleRunFullPipeline`

The order below is the actual execution order in code.

### Core flow (mostly enabled by default)

1. `ttsScript` → `handleGenerateTtsFromScripts(false, false)`
2. `ttsVideo` → `handleGenerateVideoFromTtsAudioAll(false, false)`
3. `normalizeAudio` → `handleNormalizeAudioAll(false)`
4. `convertToCFR` → `handleConvertToCFRAll(false)`
5. `optimizeSilence` → `handleOptimizeSilenceAll(false)`
6. `transcribe` → `handleTranscribeAll(false, 'whisperx')`
7. `generateScenes` → `handleGenerateScenesAll(false)`
8. `combinePairsEnabledA/B/C/D` (four optional passes) → `handleCombineLongTextPairsForProcessingVideos(skip, false)`
9. `deleteEmpty` → `handleDeleteEmptyScenesAllVideos(false)`
10. `generateClips` → `handleGenerateClipsAll(false)`
11. `speedUp` → `handleSpeedUpAllVideos(false)`
12. `fixLanguageAll` → `handleFixLanguageProcessingScenesAllVideos(false)`
13. `improve` → `handleImproveAllVideosScenes(false)`
14. `generateTTS` → `handleGenerateAllTTSForAllVideos(false)`
15. `sync` → `handleGenerateAllVideosForAllScenes(false)`
16. `transcribeScenesAfterSync` (Fix TTS) → `handleTranscribeProcessingScenesAllVideos(false)`
17. `promptScenesAfterTranscribe` → `handlePromptProcessingScenesAllVideos(false)`

### Scene post-processing block (opt-in by default)

18. `generateSubtitles` → `handleGenerateSubtitlesForProcessingVideos()`
19. `generateSceneImages` → `handleGenerateSceneImagesForProcessingVideos()`
20. `upscaleSceneImages` → `handleUpscaleSceneImagesForProcessingVideos()`
21. `generateSceneVideos` → `handleGenerateSceneVideosForProcessingVideos()`
22. `enhanceSceneVideos` → `handleEnhanceSceneVideosForProcessingVideos()`
23. `applyEnhancedVideos` → `handleApplyEnhancedVideosForProcessingVideos()`
24. `applyUpscaledImages` → `handleApplyUpscaledImagesForProcessingVideos()`

### Final tail block (opt-in by default)

25. `mergeScenes` → `handleMergeScenesForProcessingVideos(false)`
26. `transcribeFinalAll` → `handleTranscribeAllFinalVideos(false)`
27. `generateYouTubeDescriptions` → `handleGenerateYouTubeDescriptionsAll(false)`
28. `generateYouTubeKeywords` → `handleGenerateYouTubeKeywordsAll(false)`
29. `generateYouTubeTitles` → `handleGenerateYouTubeTitlesAll(false)`
30. `generateYouTubeTimestamps` → `handleGenerateYouTubeTimestampsAll(false)`
31. `generateThumbnails` → `handleGenerateThumbnailsAll(false)`

---

## 2.3 Timing and refresh behavior

- Many heavy steps deliberately wait **20 seconds** before the next step.
- Most steps do `await handleRefresh()` and often `refreshScenesData?.()` after completion.
- Pipeline-level finalization:
  - Telegram: `🎉 Full Pipeline Complete! ...`
  - success sound (`playSuccessSound()`)
  - `pipelineStep` is cleared shortly after success

---

## 2.4 Defaults and persistence

From `defaultPipelineConfig` in `useAppStore.ts`:

- **Enabled by default:** core flow through `promptScenesAfterTranscribe`, plus combine passes A/B/C/D
- **Disabled by default:** scene post-processing block and final tail block

Persistence:

- Pipeline config is persisted in localStorage key: `pipelineConfig`
- Managed via:
  - `updatePipelineConfig`
  - `togglePipelineStep`
  - `resetPipelineConfig`

---

## 3) How to add a new batch operation correctly

Use this checklist for a **new button operation** (all-videos or scene-level).

1. **Define scope and dependencies first**
   - Is it video-level, scene-level, or final-tail?
   - Which fields must already exist?
   - Which operations conflict and should disable this one?

2. **Add local state in `OriginalVideosList.tsx`**
   - Boolean running flag (`...AllVideos`, `...ProcessingScenesAllVideos`, etc.)
   - Optional current item ID (`...SceneId`, `...VideoId`) for progress labels

3. **Implement the handler**
   - Guard duplicate execution early
   - `setError(null)` at start when appropriate
   - Fetch fresh data (`getOriginalVideosData`, `getBaserowData`) if operation needs latest state
   - Filter strictly (usually `status === 'Processing'`)
   - Process sequentially with small delays to avoid API overload
   - Use `try/catch/finally` and always reset loading state in `finally`

4. **Use completion messaging correctly**
   - If handler owns sound: `await playSuccessAndNotifyBatchCompletion('<Name>')`
   - If utility already plays success sound: `await notifyBatchOperationCompleted('<Name>')`
   - Avoid sending one Telegram message per item

5. **Add UI button in batch grid**
   - Hook `onClick` to the handler
   - Add collision-safe `disabled` conditions
   - Add meaningful `title`
   - Show progress text (`V{id}`, `S{id}`, or `Processing...`)

6. **Update action count badge**
   - `Batch Operations For all Videos with Processing Scenes ({N} actions)`

7. **Validate**
   - lint touched file(s)
   - manually test run + cancellation/failure scenarios
   - verify Telegram completion format and timing

---

## 4) How to add the operation into Full Pipeline

If your new batch operation should be pipeline-toggleable:

1. **Add config key in store**
   - Add boolean key to `PipelineConfig` in `useAppStore.ts`
   - Set default in `defaultPipelineConfig`

2. **Expose toggle in pipeline UI**
   - Add entry to `steps` in `PipelineConfig.tsx`
   - If order relative to combine passes matters, update `beforeCombineKeys`

3. **Insert orchestrator block**
   - In `handleRunFullPipeline`, add:
     - `if (pipelineConfig.<newKey>) { ... } else { ... }`
     - `stepNumber++`
     - `setPipelineStep(...)`
     - call handler
     - refresh after step
     - optional wait if async backends need settling
   - Follow existing throw-on-failure pattern so pipeline halts on hard failure

4. **Place it in dependency-safe order**
   - Don’t move it before required inputs exist
   - Don’t place it after a step that invalidates its prerequisites

5. **Re-verify default behavior**
   - Existing users should not get unexpected new heavy steps unless intentionally enabled

---

## 5) Current note: `Fix Language All`

Current state:

- Exists as a batch button in the all-videos panel
- Operation name used for completion: `Fix Language All`
- It processes eligible Processing scenes in batches via `/api/fix-language-scenes`
- It **is pipeline-toggleable** via `pipelineConfig.fixLanguageAll`
- In full pipeline order, it runs **after** `speedUp` and **before** `improve`

---

## 6) Common pitfalls to avoid

- Adding button but forgetting collision-safe `disabled` rules
- Forgetting to reset loading state in `finally`
- Sending Telegram success for each scene instead of once per operation
- Double success sound (utility + component)
- Missing data refresh after updates
- Inserting pipeline step in wrong dependency order
- Forgetting to add new config key to defaults (causes undefined behavior)

---

## 7) Quick “done” checklist for future changes

- [ ] Handler added with guards + try/catch/finally
- [ ] UI button added with progress text + disable guards
- [ ] Completion message strategy correct
- [ ] Action count badge updated
- [ ] (If pipeline step) store config + PipelineConfig UI + orchestrator block added
- [ ] Lint passes for touched files
- [ ] Manual smoke test confirms operation + notification
