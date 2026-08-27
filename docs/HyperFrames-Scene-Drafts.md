# HyperFrames Scene Drafts

The Scenes for Edit table stores the staged HyperFrames workflow for each
scene:

| Field | Baserow key | Purpose |
| --- | --- | --- |
| Captions URL for Scene | `field_6910` | Internal source used to load word timings. |
| HyperFrames Prompt | `field_7365` | Generated prompt containing the scene sentence, exact caption timings, and word image assets. |
| HyperFrames Word Assets | `field_7366` | JSON array of `{ "word", "imageUrl" }` entries. |
| HyperFrames HTML | `field_7367` | Plain long-text field for editable HyperFrames HTML returned by an LLM. |

The prompt-generation step only creates and saves the editable prompt. It does
not call an LLM or render a video. The HTML draft is kept in its own field so
the prompt can be refined without overwriting the code.
