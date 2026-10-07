# Non-English voice dataset export

Select a reviewed video, then open **Export language dataset ▾** beside the existing English export button. Choose a language to export that video's approved sentence/audio pairs. The dropdown lists unique enabled preset languages, excludes English and unknown languages, and reloads saved presets on opening. Clicking a language starts export; no TTS generation or training is performed.

## Preset mapping and audio selection

`GET /api/export-language-voice-dataset` lists available languages. `POST` accepts `{ "videoId": 1623, "language": "fa" }`. The server resolves the language from `loadTtsAudioReferencesStore()`; callers cannot supply arbitrary fields or output paths. Among enabled presets, the language default supplies provenance, or the first preset if there is no default. If presets for a language disagree about any export sentence/audio mapping, export is rejected and the dropdown entry is disabled.

The sentence comes from `baserowFields.sceneTargetSentenceFieldKey`. Prefer populated `sceneOriginalAudioFieldKey` (narration before scene fitting); otherwise use `sceneDubbedAudioFieldKey`. Original audio that is present but fails download/validation is reported as a failure, not silently replaced with fitted audio. For Persian, current mappings are sentence **7110**, original audio **7117**, dubbed audio **7111**. The exporter reads all scene pages related to the video through field **6889**, without a Fix TTS filter or any Baserow writes.

Audio is selected from saved row fields, regardless of the current TTS provider. A recorded preset ID identifies the mapping used; it does not prove which provider originally generated the audio. Check transcript agreement and provenance before later training, including whether a provider permits training on its output. The exporter does not infer permissions or start training.

## Collections and duplicate rules

Each language has one shared collection across videos on the Next.js machine:

```text
~/Documents/OmniVoice-Language-Datasets/
  fa/
    dataset.jsonl
    sample_<sha256>.txt
    sample_<sha256>.wav
  tr/
    dataset.jsonl
    sample_<sha256>.txt
    sample_<sha256>.wav
```

Stable language codes determine folders. The English collection/export route is independent and remains at `~/Documents/OmniVoice-English-Dataset`.

Within each language, duplicates trim surrounding whitespace and collapse repeated whitespace; case and punctuation remain significant. First successfully collected pair wins, including repeated sentences within one video. Existing pairs are never overwritten. Save the translated sentence verbatim. Skip empty sentences and missing audio; report failures and indexed pairs with missing files.

Each manifest entry records `id`, absolute `audio_path`, `text`, `language_id`, `video_id`, `scene_id`, `exported_at`, `preset_id`, `sentence_field`, and `audio_field`. Moving a collection requires rebuilding its absolute training paths. The export report shows added pairs, original/dubbed source counts, duplicate/empty/missing skips, failures, and destination.

FFprobe validates downloaded audio. WAV sources are retained without fades, denoising, or resampling; non-WAV sources are converted to PCM WAV using FFmpeg. Separate per-language `.export.lock` files serialize writers, exclusive file publication avoids overwrite, and manifest replacement is atomic after the audio/text pair is present. Complete matching orphan files from interruption can be indexed on retry. Remove a stale lock or temporary `.sample-*` directories only after verifying that no export is running.

Requires configured Baserow, reachable saved audio URLs, FFprobe, and FFmpeg. No model, GPU, paid API call, or application restart is needed. Exporting source files is independent of LoRA training; follow [OmniVoice-LoRA.md](OmniVoice-LoRA.md) for a later isolated experiment.

## Verification on Hermes video 1623 (2026-10-06)

The live UI dropdown listed 50 distinct non-English languages, including Persian and Turkish. Choosing Persian for selected video 1623 exported **246 pairs**, all from original audio field 7117, skipped **57 empty sentences**, and reported zero missing audio/failures. The 246 WAVs total approximately **18.04 minutes**. Every WAV passed FFprobe duration validation; each text file matched its manifest verbatim, and language/video/source fields and sentence hashes were checked.

A second export through the UI added zero pairs and skipped all 246 duplicates plus the same 57 empty sentences. All 493 collection files (246 WAVs, 246 text files, one manifest) remained byte-identical; the lock was released and no temporary sample directories remained. English and path-traversal language requests returned HTTP 400. The English export route, English collection manifest, and saved preset file remained unchanged by hash comparison.

Configured Baserow and saved local MinIO audio were reachable, and FFprobe was available. This tested export/file integrity, not linguistic accuracy or training quality. Scoped ESLint had no errors and four existing unused-variable warnings in `OriginalVideosList.tsx`; `git diff --check` passed. No TTS generation, training, Baserow writes, model changes, or production build were performed.
