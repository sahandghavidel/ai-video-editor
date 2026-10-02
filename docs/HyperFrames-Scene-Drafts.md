# HyperFrames Scene Drafts

The Scenes for Edit table stores the staged HyperFrames workflow for each
scene:

| Field | Baserow key | Purpose |
| --- | --- | --- |
| Captions URL for Scene | `field_6910` | Internal source used to load word timings. |
| HyperFrames Prompt | `field_7365` | Self-contained prompt containing the scene sentence, exact caption timings, and the required duration calculated from FFprobe with the final caption timestamp as a safety floor; captions provide timing only and are not rendered as subtitles. |
| HyperFrames Word Assets | `field_7366` | JSON array of `{ "word", "imageUrl" }` entries. |
| HyperFrames HTML | `field_7367` | Plain long-text field for editable 16:9 landscape 4K HyperFrames HTML returned by an LLM. |
| HyperFrames Video | `field_7368` | MinIO URL for the rendered HyperFrames MP4. |

The `HF Prompt` button creates and saves the editable prompt. The `HF HTML`
button sends the saved prompt to the model selected in Global Settings and
saves the returned HTML in `field_7367`. It does not render a video. The HTML
draft is kept in its own field so the prompt can be refined without
overwriting the code. The `Render HF` button renders the saved HTML with the
pinned HyperFrames CLI at the matching 4K output preset (`landscape-4k`,
`portrait-4k`, or `square-4k`), uploads the MP4 to MinIO, and saves the returned
URL in `field_7368`. A failed render leaves any previously saved video URL
unchanged. Rendering uses strict HyperFrames linting, so regenerated HTML must
avoid overlapping GSAP tweens and stay within the composition file-size limit.
The HyperFrames duration is measured from the final video in `field_6886` with
FFprobe and is never taken from the original-video `Duration` field
(`field_6884`). If the final caption timestamp is later, it is used as a
safety floor. HTML generation probes the final video again, and rendering
rejects HTML that is shorter than the measured final-video duration.

The `Edit HF` button opens a large visual-editor modal inside Add Image
Overlay. The server stages the scene HTML and its referenced sound effects in
a temporary local HyperFrames project, starts HyperFrames Studio 0.8.30 in
background mode, and embeds Studio in the modal. Studio provides playback,
scrubbing, element selection, and timeline editing. `Save to Scene` converts
the staged sound paths back to application paths, validates the edited HTML,
and updates `field_7367`. Closing the modal stops that scene's preview server.

## Audio in empty-sentence DUB scenes

For an empty target sentence, configured-language dubbing preserves audio from
the current Final video (`field_6886`) when the existing speed-up filename
parser identifies it as explicitly `unmuted` and FFprobe finds an audio stream.
This applies independently of the `Add HF sound effects` checkbox. The video
already carries its selected playback speed; that multiplier is not reapplied.

The audio uses the existing HyperFrames stretching helper, then the existing
silent-base mixing, fitting, and DUB upload path: PCM signed 16-bit WAV, 48 kHz,
stereo, fitted to the scene duration (`field_7107`) with sample-based checks.
Only one overlay source is selected; otherwise the existing optional
HyperFrames effects or silence behavior applies. The temporary extracted WAV
is cleaned up and does not use the Fitted HyperFrames Audio cache (`field_7391`).
Existing DUB outputs are still skipped and need targeted regeneration to adopt
this behavior. Spoken scenes and final audio merging are unchanged.
