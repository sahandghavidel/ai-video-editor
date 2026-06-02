# Pipeline + Batch Operations Playbook

This document explains how the current **Full Pipeline** works in this repository and how to add a new batch operation correctly (button-only or pipeline-integrated) so future changes remain safe and predictable.

Checked against current implementation in:

- `src/components/OriginalVideosList.tsx`
- `src/components/PipelineConfig.tsx`
- `src/store/useAppStore.ts`
- `src/app/api/create-dubbed-fa/route.ts`
- `src/app/api/tts-audio-references/route.ts`
- `src/app/api/fix-language-scenes/route.ts`
- `src/app/api/improve-sentence/route.ts`

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

1. `scriptFromTitle` → `handleGenerateScriptsFromTitlesAll(false)`
2. `ttsScript` → `handleGenerateTtsFromScripts(false, false)`
3. `ttsVideo` → `handleGenerateVideoFromTtsAudioAll(false, false)`
4. `normalizeAudio` → `handleNormalizeAudioAll(false)`
5. `convertToCFR` → `handleConvertToCFRAll(false)`
6. `optimizeSilence` → `handleOptimizeSilenceAll(false)`
7. `transcribe` → `handleTranscribeAll(false, 'whisperx')`
8. `generateScenes` → `handleGenerateScenesAll(false)`
9. `combinePairsEnabledA/B/C/D` (four optional passes) → `handleCombineLongTextPairsForProcessingVideos(skip, false)`
10. `deleteEmpty` → `handleDeleteEmptyScenesAllVideos(false)`
11. `generateClips` → `handleGenerateClipsAll(false)`
12. `transcribeApplyGenClips` passes A/B/C/D (optional) → `handleTranscribeApplyGenClipsForProcessingVideos(false, minChars)`
13. `speedUp` → `handleSpeedUpAllVideos(false)`
14. `fixLanguageAll` → `handleFixLanguageProcessingScenesAllVideos(false)`
15. `improve` → `handleImproveAllVideosScenes(false)`
16. `generateTTS` → `handleGenerateAllTTSForAllVideos(false)`
17. `sync` → `handleGenerateAllVideosForAllScenes(false)`
18. `transcribeScenesAfterSync` (Fix TTS) → `handleTranscribeProcessingScenesAllVideos(false)`
19. `fixFlaggedAfterFixTTS` (Fix Flagged) → `handleTranscribeFlaggedProcessingScenesAllVideos(false)`
20. `fixIntroQaAfterFixFlagged` (Fix Intro QA) → `handleFixIntroQaProcessingScenesAllVideos(false)`
21. `promptScenesAfterTranscribe` → `handlePromptProcessingScenesAllVideos(false)`

### Scene post-processing block (opt-in by default)

22. `generateSubtitles` → `handleGenerateSubtitlesForProcessingVideos()`
23. `generateSceneImages` → `handleGenerateSceneImagesForProcessingVideos()`
24. `upscaleSceneImages` → `handleUpscaleSceneImagesForProcessingVideos()`
25. `generateSceneVideos` → `handleGenerateSceneVideosForProcessingVideos()`
26. `enhanceSceneVideos` → `handleEnhanceSceneVideosForProcessingVideos()`
27. `applyEnhancedVideos` → `handleApplyEnhancedVideosForProcessingVideos()`
28. `applyUpscaledImages` → `handleApplyUpscaledImagesForProcessingVideos()`

### Final tail block (opt-in by default)

29. `mergeScenes` → `handleMergeScenesForProcessingVideos(false)`
30. `convertFinalToCFR` → `handleConvertFinalToCFRAll(false)`
31. `transcribeFinalAll` → `handleTranscribeAllFinalVideos(false)`
32. `createEnSrt` → `handleCreateEnSrtAll(false)`
33. `createDubbedLanguage` → `handleCreateDubbedLanguageForProcessingVideos(false, { languages, ... })`
34. `generateYouTubeDescriptions` → `handleGenerateYouTubeDescriptionsAll(false)`
35. `generateYouTubeKeywords` → `handleGenerateYouTubeKeywordsAll(false)`
36. `generateYouTubeTitles` → `handleGenerateYouTubeTitlesAll(false)`
37. `generateYouTubeTimestamps` → `handleGenerateYouTubeTimestampsAll(false)`
38. `generateThumbnails` → `handleGenerateThumbnailsAll(false)`

`createDubbedLanguage` now uses **ordered multi-language execution**:

- Pipeline override languages come from `pipelineConfig.selectedDubbedLanguagesForPipeline`
- If pipeline override is empty, it falls back to the batch-panel selected language list
- Languages are executed sequentially, and each language iterates Processing videos sequentially
- For each language, videos are skipped when that language’s mapped final dubbed-audio destination field already contains a value
- Language presets and per-language destination field mappings are loaded from `/api/tts-audio-references`

---

## 2.3 Timing and refresh behavior

- Pipeline settle delay has been reduced to **3 seconds** between most heavy steps.
- Most steps do `await handleRefresh()` and often `refreshScenesData?.()` after completion.
- Some "isolated" scene-heavy steps intentionally skip immediate scene refresh to keep UI stable while batches run.
- Pipeline-level finalization:
  - Telegram: `🎉 Full Pipeline Complete! ...`
  - success sound (`playSuccessSound()`)
  - `pipelineStep` is cleared shortly after success

---

## 2.5 Scene data loading strategy (current)

- Preferred approach is **scoped scene loading per video**:
  - `getBaserowDataForOriginalVideo(videoId)`
  - shared helper `fetchProcessingScenes()`
- Fallback strategy avoids full-table reads where possible:
  - targeted scene-id recovery via `video.field_6866` + `getSceneById(sceneId)`
- `Create En Srt` now uses the same targeted fallback pattern.
- `improve-sentence` API route now scopes context fetch by current scene’s linked video and only uses full-table read as a last-resort fallback.

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
   - Fetch fresh data (`getOriginalVideosData`) and prefer scoped scene loading (`fetchProcessingScenes`, `getBaserowDataForOriginalVideo`)
   - Use targeted scene-id fallback (`getSceneById`) instead of full-table scene reads when scoped fetch returns empty
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
