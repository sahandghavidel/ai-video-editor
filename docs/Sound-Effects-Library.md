# Sound Effects Library

Baserow database 195, table 738, grid view 3191. The management page is available
at `/sound-effects`. Audio files are stored in `public/sound-effects/`, with
app-relative paths such as `/sound-effects/click.wav`. Audio is not stored as
Baserow attachments or in MinIO.

| Field | ID | Type / default |
| --- | --- | --- |
| Name | 7378 | Primary text |
| Description | 7379 | Long text |
| Status | 7380 | Single select; Draft (3133), Approved (3134); default Draft |
| File Path | 7381 | Text; app-relative path |
| Duration (seconds) | 7382 | Nonnegative number, 3 decimals; measured from file |
| Measured RMS (dBFS) | 7389 | Signed number, 2 decimals; measured from file |
| True Peak (dBFS) | 7390 | Signed number, 2 decimals; measured from file |
| Default Volume (dB) | 7383 | Signed number, 1 decimal; default -18 |
| Sync Point (seconds) | 7384 | Nonnegative number, 3 decimals; default 0 |
| Tags | 7385 | Text; comma-separated |
| Usage Rules | 7386 | Plain long text |
| Source / Credit | 7387 | Plain long text; creator, source URL, attribution |
| License | 7388 | Plain long text; usage terms |

Volume is gain relative to the stored file: 0 dB preserves its level, negative
values attenuate it. -18 dB is an initial audition value, not loudness normalization.
Sync Point identifies the main impact inside the sound: the future mixer should
place file start at visual event time minus Sync Point and handle negative starts
explicitly. Default 0 aligns file start to the event.

Uploads support WAV, MP3, M4A, AAC, FLAC, OGG, OPUS, AIFF, and AIF files up to
25 MB. FFprobe measures duration and FFmpeg measures RMS and peak levels before
the Baserow row is saved. Replacing audio
refreshes the measurement and returns the sound to Draft. Deleting an entry removes
its Baserow row and its managed local file. File Path and Duration are server-controlled.

## HyperFrames prompt and render integration

Every new HyperFrames prompt receives the metadata for all Approved sounds. The
model may select up to three relevant cues or select none. Each cue must be a
direct child `<audio>` element using the approved path, measured source duration,
default linear volume, and sync-point alignment.

HTML generation rejects unapproved paths, invalid volume, cues outside the scene,
and trims outside the measured audio duration. During rendering, referenced
approved files are copied into the temporary HyperFrames project's
`assets/sound-effects/` directory and app-relative paths are rewritten only in
the temporary render copy. The editable HTML saved in Baserow keeps the application
paths.
