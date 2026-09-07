# SVG Library

Open `/svg-library` using the SVG Library link on the editor home page.

The page supports search, status filtering, paste/upload, isolated image previews,
editing, duplication, approval, and confirmed deletion. New assets start as Draft;
changing SVG markup returns them to Draft. Select Approved and save after review.
Unsaved editor changes are guarded when changing assets or leaving the page.

Storage uses the existing Baserow authentication configuration and **only table 737**
in database 195. No MinIO storage or additional credentials are needed.
The `/api/svg-library` endpoint uses Baserow user field names:

| Field | Type | Purpose |
| --- | --- | --- |
| Name | Single line text | Asset name |
| Description | Long text | Appearance and intended use |
| SVG Code | Long text, plain | Complete SVG markup |
| Status | Single select | Draft / Approved |
| ViewBox | Single line text | SVG coordinate system |
| Width / Height | Number, six decimals | ViewBox dimensions, or numeric SVG dimensions |
| Tags | Single line text | Comma-separated search keywords |
| Usage Rules | Long text | Reuse constraints |

Dimensions are derived on every save, never trusted from client metadata.
SVGs are limited to 500 KB and parsed with @xmldom/xmldom. A static element and
attribute allowlist rejects scripts, event handlers, styles, foreign objects,
external references, DTDs, and unsupported XML. Use presentation attributes rather
than style blocks or inline style attributes. Internal #id references are allowed.
Previews use SVG image context, not inline HTML. Validation errors preserve editor
contents so the user can correct them. Deletes use Baserow's normal row deletion.

Two original examples, Browser Window and Code Editor Window, are stored as Draft
assets for review. The library manager edits assets; prompt integration is described below.

## HyperFrames prompt integration

Individual Image Overlay prompts and shared/batch prompt creation automatically
append all Approved assets through `/api/svg-library/prompt`. The marked section
includes asset IDs, names, descriptions, exact SVG markup in JSON, derived
ViewBox/dimensions, tags, and usage rules. JSON escaping must be decoded when
embedding markup. Drafts are excluded. An empty approved library explicitly
allows newly authored scene artwork.

HTML generation refreshes and replaces the marked library section immediately
before the model request, including older saved prompts. The same prompt is used
for repair attempts. Refreshing the model prompt does not rewrite the saved scene
prompt; regenerate that prompt when an updated copy is needed outside the app.
Existing skip-existing behavior in batch prompt creation is preserved.

Reuse rules preserve asset appearance and use outer wrappers for animation.
Asset colors override general palette rules for that asset only. Existing timing,
caption, seek-safety, and strict validation rules are unchanged. Newly generated
SVGs are not automatically added to the library.

Library load errors, invalid Approved SVGs, and prompts exceeding the conservative
200,000 UTF-8-byte application limit stop the operation with an error. Nothing is
silently truncated or omitted. This byte limit is not a provider-specific token
budget; models with smaller context windows may still reject a request.
