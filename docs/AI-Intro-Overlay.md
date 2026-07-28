# AI Intro Overlay

The Add Image Overlay window includes an original-video picker beside the
existing upload controls. It uses the same section-selection and overlay
acceptance flow as an uploaded video, while keeping the upload-video editor
unchanged.

## Selection flow

1. Select the original-video icon beside the upload-video control.
2. The familiar **Choose Video Sections** popup opens with no sections
   selected.
3. Select, preview, trim, split, duplicate, remove, or reorder sections
   manually.
4. Optionally set the outer overlay Start and End values to a transcribed word
   range and select **AI Clip for Selected Words** inside the popup. The AI
   suggestions then populate the same section timeline and remain editable.
5. Select **Build Overlay Clip**. The popup closes and the resulting clip
   appears on the existing overlay canvas with the normal position, size,
   timing, crop, Preview, and Apply controls.

Opening the popup does not call the LLM. A current-scene transcription and an
original-video transcription are needed only when the optional AI button is
used.

The built 720p clip is used only for fast canvas and Preview playback. Final
Apply resolves the linked original video again on the server and renders the
selected source sections from that original-resolution file.

## Data sources

- Scene link to original video: `field_6889`
- Current scene video: `field_6886`, with `field_6888` as fallback
- Current scene word captions: `field_6910`
- Original uploaded video: `field_6881`
- Original-video word captions: `field_6861`
- Original scene timing used to exclude earlier source material:
  `field_6896` / `field_6897`

All source URLs are resolved server-side from Baserow. The client sends a scene
ID and timestamp ranges, not an arbitrary source-video URL.

## Isolated implementation

- `src/components/ai-intro-overlay/`
- `src/lib/ai-intro-overlay.ts`
- `/api/suggest-ai-intro-clip`
- `/api/ai-intro-source-video`
- `/api/prepare-ai-intro-overlay`

The existing `VideoEditModal`, `/api/prepare-video-overlay`, and
`/api/add-image-overlay` remain unchanged.
