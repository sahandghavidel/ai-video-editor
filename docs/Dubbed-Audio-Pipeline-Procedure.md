# Dubbed Audio Pipeline Procedure (LLM Handoff + Porting Guide)

This document describes the exact behavior of:

- `POST /api/create-dubbed-en`
- Implemented in: `src/app/api/create-dubbed-en/route.ts`

Use this guide when you want to reproduce the same workflow for another language.

---

## 1) Objective

Given a `videoId`, produce a final dubbed audio file by:

1. Loading all scenes linked to that video
2. Generating one scene audio output per scene
   - If scene has TTS audio: fit to scene duration rules
   - If scene is empty: create silence clip for scene duration
3. Merging scene outputs in chronological order
4. Optionally speed-adjusting merged output to match full video duration
5. Saving scene-level dubbed URLs and final dubbed URL to Baserow

---

## 2) API Contract

### Endpoint

- `POST /api/create-dubbed-en`

### Request

- JSON body: `{ "videoId": <positive integer> }`

### Response (important fields)

- `ok`
- `videoId`
- `processedSceneCount`
- `silenceSceneCount`
- `ttsSceneCount`
- `videoTargetDurationSec`
- `mergedDurationBeforeFitSec`
- `mergedDurationAfterFitSec`
- `finalMergedSpeedMatchApplied`
- `sceneDurationFitApplied`
- `finalDubbedAudioUrl`
- `scenes[]` (per-scene metrics)

---

## 3) Baserow Tables and Fields

### Tables

- Videos table: `713`
- Scenes table: `714`

### Scene fields

- Linked video: `field_6889`
- EN TTS source audio: `field_6891`
- Scene duration target (seconds): `field_6884`
- Sentence text (used to detect empty scene): `field_6890`
- Scene output dubbed URL: `field_7108`

### Video fields

- Uploaded video duration target (seconds): `field_6909`
- Final dubbed audio URL: `field_7109`

---

## 4) Current Runtime Switches (as implemented)

- `ENABLE_SCENE_DURATION_FIT = true`
- `ENABLE_FINAL_MERGED_SPEED_MATCH = true`

Interpretation:

- Scene fitting is ON
- Final merged speed match is ON

---

## 5) End-to-End Flow

1. Validate request body (`videoId` must be positive integer)
2. Authenticate to Baserow using JWT (`BASEROW_API_URL`, `BASEROW_EMAIL`, `BASEROW_PASSWORD`)
3. Load target video row from table `713`
4. Read video duration target from `field_6909`
5. Fetch all scenes linked via `field_6889 == videoId`
6. Sort scenes by:
   1. `field_6896` (if numeric)
   2. `order` (fallback)
   3. `id` (fallback)
7. Validate each scene and create jobs:
   - Missing/invalid scene duration (`field_6884`) => validation error
   - Missing TTS (`field_6891`):
     - if sentence is empty (`field_6890` blank) => create silence job
     - else => validation error
8. Stop with 400 if validation errors exist
9. Process jobs one-by-one:
   - Create fitted local clip (WAV intermediate)
   - Encode to M4A for upload
   - Upload scene file and patch scene `field_7108`
10. Merge all fitted local scene clips (WAV intermediate)
11. Probe merged duration (`mergedDurationBeforeFitSec`)
12. If final speed-match is enabled, fit merged track to `field_6909` via tempo-only passes
13. Ensure final upload format is M4A
14. Upload final dubbed file and patch video `field_7109`
15. Return diagnostics and clean up all temp files

---

## 6) Scene Rules

### Empty scene detection

- Empty scene is determined only by:
  - `String(field_6890).trim() === ''`

### Non-empty scene requirements

- If scene is non-empty (`field_6890` has text), `field_6891` must contain a valid audio URL

### Fit behavior

- Shorter/equal input vs scene target:
  - Pad with silence (`apad`), then trim to exact scene target (`atrim=0:target`)
- Longer input vs scene target:
  - Tempo-only iterative speed-up (no hard trim in this branch)
  - Up to `SCENE_MAX_TEMPO_PASSES` passes
  - Stop if within `SCENE_DURATION_TOLERANCE_SEC`

---

## 7) Merge Strategy (High Precision)

The merge path is intentionally high precision:

1. Scene outputs are kept as **WAV/PCM** intermediate files
2. Merge uses FFmpeg `concat` **filter** over audio streams
3. Merged output remains WAV/PCM intermediate
4. Encoding to AAC/M4A happens only when uploading scene/final assets

Why this is done:

- Minimizes cumulative AAC boundary/timestamp artifacts
- Reduces end-of-track clipping risk
- Keeps storage compatibility (`audio/mp4` uploads)

---

## 8) Final Merged Speed Adjustment

When `ENABLE_FINAL_MERGED_SPEED_MATCH = true`:

- Merged audio is fitted to uploaded video duration (`field_6909`) using tempo-only passes
- Per pass speed factor = `currentDuration / targetDuration`
- Tempo chain is built with legal FFmpeg `atempo` ranges
- No explicit `apad`/`atrim` in final merged fit branch
- Max passes: `FINAL_MERGED_MAX_TEMPO_PASSES`
- Tolerance: `FINAL_MERGED_DURATION_TOLERANCE_SEC`

---

## 9) Audio Technical Constants

- Sample rate: `48000`
- Channels: `2` (stereo)
- Intermediate codec: `pcm_s16le` (WAV)
- Upload codec: `AAC` in `m4a` container (`audio/mp4`)

---

## 10) Failure Conditions

Request fails with 400 when:

- `videoId` invalid
- Video duration target (`field_6909`) missing/invalid
- Any non-empty scene missing TTS URL
- Any scene missing valid duration target (`field_6884`)

Request fails with 404 when:

- No scenes are linked to this video

Request fails with 500 for:

- Auth failures
- FFmpeg/ffprobe errors
- Upload or Baserow patch errors

---

## 11) Porting to Another Language

To create `create-dubbed-<lang>` with identical behavior:

1. Copy the same pipeline structure
2. Replace only language-specific field constants:
   - TTS input field
   - Scene dubbed output field
   - Video final dubbed output field (if separate per language)
3. Keep all ordering, validation, and fit/merge rules unchanged
4. Keep empty-scene logic tied to the chosen sentence field
5. Keep high-precision merge path (WAV intermediates + concat filter)
6. Keep response diagnostics fields for easier QA

Recommended: use a different API route and different destination fields per language to avoid overwriting EN outputs.

---

## 12) Invariants (Do Not Change Unless Required)

- Scene order must be deterministic (`field_6896` -> `order` -> `id`)
- Empty/non-empty logic must be explicit and language-consistent
- Validation must fail fast before processing when inputs are incomplete
- Temp files must always be cleaned up in `finally`
- Duration probes must use ffprobe and not client-estimated metadata

---

## 13) LLM Handoff Prompt Template

Use the following when asking another LLM to implement a new language variant:

"""
Implement a new API route based on `src/app/api/create-dubbed-en/route.ts` with the exact same algorithm and processing order.

Requirements:

1. Keep scene fit logic exactly the same.
2. Keep high-precision merge strategy: WAV PCM intermediates + concat filter merge.
3. Keep optional final merged speed-match behavior identical.
4. Only change field mappings for the target language:
   - TTS input field: <REPLACE>
   - Scene dubbed output field: <REPLACE>
   - Final dubbed output field: <REPLACE>
5. Preserve validation, response diagnostics, and temp-file cleanup behavior.
6. Keep Baserow auth and row patch semantics unchanged.

Do not simplify or redesign the pipeline.
"""

---

## 14) Quick QA Checklist

- Non-empty scene with valid TTS produces scene dubbed URL
- Empty scene produces silence output URL
- Scene-level dubbed URLs are patched to scene table output field
- Final merged URL is patched to video output field
- `mergedDurationBeforeFitSec` is returned
- `mergedDurationAfterFitSec` reflects final fit mode
- No temp files leaked in `/tmp` after request completes

---

## 15) Current Source of Truth

If this guide and code ever diverge, update this guide immediately after code changes.

Primary source file:

- `src/app/api/create-dubbed-en/route.ts`
