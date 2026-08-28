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
