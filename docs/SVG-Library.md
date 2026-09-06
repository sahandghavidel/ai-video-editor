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
assets for review. This page does not change HyperFrames prompts or generation.
Future prompt integration should load approved assets and include their markup
and metadata; it is intentionally separate from library management.
