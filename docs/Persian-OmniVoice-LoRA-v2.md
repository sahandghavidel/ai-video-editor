# Persian OmniVoice LoRA v2 application options

The user authorized adding both v2 checkpoints as optional presets on 2026-10-17. Human listening approval is still pending. Existing presets, language defaults, ordinary OmniVoice, English v1 and Persian v1 are preserved. See [the original runbook](OmniVoice-LoRA.md), [Persian v1](Persian-OmniVoice-LoRA.md), and [dataset export](English-Voice-Dataset.md).

## Selecting a checkpoint

Open **Global Settings → TTS → Manage Language Presets**. Choose **Persian — LoRA v2 — 2 passes** or **Persian — LoRA v2 — 8 passes**, then click **Use for Persian TTS** on that card. This saves the preset and makes it the Persian default for new dubbing jobs. Existing audio is skipped; selecting a preset does not regenerate it. English settings remain separate. Use the same button on a previous Persian preset to switch back.

Both new entries are enabled and initially not the default. Each binds its own model ID and distinct reference filename; renaming a preset alone never selects different weights. Provider must be `omnivoice-lora`.

| Setting | Two passes | Eight passes |
| --- | --- | --- |
| Preset ID / adapter version | `persian-v2-pass-2` | `persian-v2-pass-8` |
| Language | `fa` | `fa` |
| Optimizer updates | 4,700 | 18,799 |
| Frozen adapter below v2 root | `application-v2/pass-2/adapter` | `application-v2/pass-8/adapter` |
| Reference filename | `fa-lora-v2-pass-2.wav` | `fa-lora-v2-pass-8.wav` |
| Weight SHA-256 | `8ece1e6d12666305403fc1b08f9e1316ed5e9bda4891192dec4771e786366bdd` | `6521f8a77fedd75d5bb613a6db45c8dbc38b7abf01a2827d66a7236fdc86c50f` |

## Packages and runtime

Default v2 root: `~/Documents/OmniVoice-Persian-LoRA-v2`. Optional server environment variable **`OMNIVOICE_PERSIAN_LORA_V2_ROOT`** overrides only that root. It must contain `base-model`, the isolated Python environment (`runtime-env/bin/python` if present, otherwise `env/bin/python`), and both application packages. No new service or Baserow field is required. Do not repoint either v1 root.

Application packages are copies of `candidates/pass-2/adapter` and `candidates/pass-8/adapter`; training candidates and `selected-v2` remain intact. Each package's `approval.json` binds language, version, update count and weight hash. It records integration authorization and `listening_approved: false`. The persistent worker checks those bindings and the weight hash before loading.

Reference WAVs in ignored `omnivoice-local/references/` are exact copies of v2 `reference/reference.wav`; both preset transcripts come from `reference/reference.txt`. Keep these local files and external packages available after a checkout. Do not commit media, environments, weights or runtime evidence.

Routing follows preset → shared version registry → server runtime → persistent worker. The worker key includes adapter version, so switching between these two checkpoints closes the old worker before loading the other even though they share a root and language. Existing defaults remain five-minute idle unloading, recycling after 100 generations, a serialized queue and bounded prepared-reference cache. Ordinary OmniVoice retains its separate runtime.

Both presets use MPS float32, 34 generation steps and speed 1. Raw inference retains `preprocess_prompt=False`, `postprocess_output=False`, `denoise=False`, fade/padding zero and chunk threshold `1e9`. Existing Persian-only text/number normalization still runs before generation. Scene filenames retain `video_<videoId>_tts_original_fa_scene_<sceneId>_<13-digit timestamp>.wav`, without adapter suffixes, for sync compatibility.

## Training and comparison evidence

V2 excluded 996 pairs containing digits and retained 9,390 unchanged transcript/audio pairs (13.511744 hours). Training started from the original base with rank 16, alpha 32 and learning rate 5e-5, completing eight exact passes and 75,120 presentations. Checkpoints at passes 2, 3, 5 and 8 were evaluated on 100 generated clips each with two speech recognition models. Pass 2 was selected by the declared earlier-checkpoint tie rule; pass 8's raw machine score was effectively tied. This does not establish a human pronunciation preference or a measured improvement over v1.

Full training commands, data accounting, reports and resumable checkpoints remain in the external root's `README.md`, `OPERATIONS.md`, `REPORT.md` and machine-readable reports. Listening comparisons remain in `evaluation/pass-2/` and `evaluation/pass-8/`, with matching filenames, texts and seeds.

## Integration verification

Focused routing checks cover all four model versions, language rejection, wrapper forwarding, model reuse and switching versions within the same Persian root. Scoped ESLint, Python compilation and `git diff --check` passed.

Three real requests through `/api/generate-tts-omnivoice-lora` exercised pass 2 twice and pass 8 once using sentinel video/scene IDs. Both checkpoints returned the correct language/version/update metadata, valid MinIO WAVs and timestamp-compatible names. All three WAVs matched the corresponding evaluation audio byte for byte. The second request reused the worker PID and reference cache; switching checkpoints used a different PID. The browser preset cards showed the correct model binding, enabled status and unchecked default status after refresh.

Evidence and preservation baselines are in `application-integration/` under the external v2 root. All pre-existing preset entries and both frozen v1 packages were compared against their baselines. No Baserow row was written, paid provider called, full video dubbing run, or production build/dev-service restart performed. Short checks do not constitute a 100-generation endurance or five-minute idle-unload test.
