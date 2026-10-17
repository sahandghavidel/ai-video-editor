# Persian OmniVoice LoRA v1

Sahand approved the three listening examples on 2026-10-17 and authorized adding Persian as an optional application preset. This adds no new training, Baserow field, hosted service or replacement of the existing Persian provider. Read [OmniVoice-LoRA.md](OmniVoice-LoRA.md) for the original English procedure and worker contract.

## Approved package

- Experiment: `~/Documents/OmniVoice-Persian-LoRA-v1`.
- Frozen application adapter: `approved-v1/adapter/` under that root.
- Frozen reference/transcript: `approved-v1/reference.wav` and `reference.txt`.
- `approved-v1/approval.json` records approval, language `fa`, version `persian-v1`, training update 3000 and weight/reference hashes.
- Adapter weight SHA-256: `9b533411ee16edc0a644865a8fb72f1ce07b6e4114f417046f34eefbaefed642`.
- Reference SHA-256: `15b0ef2fe2eb84c4dcff148514b429b6ba0b03be042889ed1b1fece32ed257bb`.

Training used all 10,386 approved sentence/audio pairs (15.1394 hours), with no held-out set at the user's request. All 10,386 IDs reached the model; there were 11,991 example presentations. The successful final run completed 3,000 optimizer updates in 50.24 minutes. This is a listening-approved candidate, not a held-out quality benchmark or a guarantee of perfect pronunciation. Checkpoints 500/1000/1500/2000/2500/3000 remain available.

Training is documented in the experiment's `README.md`, `REPORT.md`, `completion-report.json`, config and coverage files. Its isolated environment uses the English pinned model/source and float32 with SciPy 1.14.1 to avoid the old 1.15.3 native-library import failure. To control MPS memory, the final training runner masked padding to 128-token buckets and cleaned unused cache every five updates. A same-batch numerical check found a loss difference below 1e-6. Those training-only batching changes are not applied to inference.

Keep environments, data, reference audio, weights, generated examples and runtime evidence outside commits.

## Choose the voice

In **Global Settings → TTS → Manage Language Presets**, find **Persian — LoRA v1** and click **Use for Persian TTS**. The button saves current preset edits and marks that entry as the Persian language default. It does not change global English TTS settings. To return to the old provider, use **Use for Persian TTS** on **Farsi Default Voice** (or select the desired Persian default and save).

The new entry is enabled but initially **not** the default. Existing entries and defaults are preserved. The initial preset has:

| Setting | Value |
| --- | --- |
| Preset ID | `persian-lora-v1` |
| Provider | `omnivoice-lora` |
| Language | `fa` |
| Adapter binding | `loraAdapterVersion: persian-v1` |
| Reference filename | `fa-lora-v1.wav` |
| Precision / device | float32 / MPS |
| Decoding steps / speed | 34 / 1 |

The reference is a byte-for-byte copy of the approved Persian recording into `omnivoice-local/references/fa-lora-v1.wav`; its exact transcript is copied into the preset. No existing reference is overwritten. This is independent of the English Nice references.

The field mapping is copied from the existing Persian preset: target sentence **7110**, original TTS **7117**, dubbed/fitted audio **7111**, duration **7107**, video SRT **7112**, reference SRT **6872**, merged dubbed audio **7113**. No Baserow rows/schema are changed by installation.

## Explicit version routing

`src/utils/omniVoiceLoraVersions.ts` contains the approved bindings:

| Binding | Language | Training update |
| --- | --- | ---: |
| `approved-v1` | `en` | 400 |
| `persian-v1` | `fa` | 3000 |

Legacy English presets without `loraAdapterVersion` continue selecting English `approved-v1`. Persian requires its explicit binding. Unknown bindings, unsupported languages and cross-language bindings are rejected rather than falling back. Preset load/save and the modal retain the field; the model selector lists only versions for the preset language.

The existing dubbing routes already pass the selected provider/reference filename through `create-dubbed-fa` → `generate-scene-tts-by-field` → `generate-tts-omnivoice-lora`. The shared OmniVoice route resolves that enabled preset from the saved store after ordinary text preparation; `generateOmniVoiceLora` validates its binding and resolves a server-approved root. Clients cannot submit arbitrary model paths. No ordinary OmniLocal worker is started on the LoRA branch.

Use a distinct reference filename for each deployed language/version: current preset lookup is filename-based. Adding a name alone never selects a different adapter. New versions require an explicit registry entry, compatible frozen package, version/language validation and worker identity, not repointing the existing English root.

## Runtime and lifecycle

| Configuration | Default |
| --- | --- |
| `OMNIVOICE_LORA_ROOT` | `~/Documents/OmniVoice-LoRA-Test` (English only, unchanged meaning) |
| `OMNIVOICE_PERSIAN_LORA_ROOT` | `~/Documents/OmniVoice-Persian-LoRA-v1` |
| Python | `<root>/runtime-env/bin/python` when present, otherwise `<root>/env/bin/python` |
| Base model / source | `<root>/base-model`, `<root>/source` |
| Application adapter | `<root>/approved-v1/adapter` |

The old English `env/` already failed to import SciPy's `_spropack` native library before this integration. It is preserved unchanged. An independent `runtime-env/` copy under the English root uses SciPy 1.14.1; other package versions and the English source/base/adapter are retained. Python is invoked directly, not through copied entry-point shebangs. The Persian environment already had the compatible version. Neither ordinary OmniLocal nor the original English environment is repaired in place.

One shared LoRA queue owns one worker at a time across both languages. Its key includes root, resolved Python, device, float32, adapter version, language, protocol, worker script timestamp/size and cache/recycle settings. Changing version/language waits for the previous worker to close before loading the next, so an English adapter/reference cache cannot be reused as Persian. Global state still spans Next route bundles/HMR.

`worker.py` accepts `--adapter-version approved-v1|persian-v1`, defaulting to English for old diagnostic callers. Each worker loads one bound language/adapter; readiness reports its identity and the manager verifies it. Jobs with another language are rejected. The Persian worker additionally verifies `approval.json` and its adapter weight hash before loading, preventing a misconfigured Persian root from silently loading English weights. One-shot `generate.py` supports the same explicit `adapter_version`/`language` pair for diagnostics; old jobs remain English by default.

The existing policies remain:

- Serialize requests; preserve queued work across failure/reload.
- Cache up to 16 prepared reference prompts, keyed by path, size, mtime and transcript.
- Unload after five idle minutes, measured after completion; do not interrupt busy work.
- Recycle after 100 successful generations, returning the 100th audio first.
- Preserve advisory locks, process-exit cleanup and job-timeout behavior.

`OMNIVOICE_LORA_IDLE_TIMEOUT_MS`, `OMNIVOICE_LORA_MAX_GENERATIONS_BEFORE_RELOAD`, `OMNIVOICE_LORA_PROMPT_CACHE_SIZE` and `OMNIVOICE_LORA_JOB_TIMEOUT_MS` retain the English runbook's defaults/fallbacks. Inference stays offline (`HF_HUB_OFFLINE`, `TRANSFORMERS_OFFLINE`), uses the selected root's source on `PYTHONPATH`, four CPU threads, float32 and no MPS fallback.

## Audio and saved filenames

The shared OmniLocal/LoRA text-preparation route normalizes Persian (`۰۱۲۳۴۵۶۷۸۹`) and Arabic (`٠١٢٣٤٥٦٧٨٩`) digit shapes to ASCII (`0123456789`) only when the resolved synthesis language is `fa`. LoRA uses its selected preset language; ordinary OmniVoice uses its existing preset/request language precedence. This happens after existing text cleanup, before synthesis, and is included in outbound-text logging. Stored sentences, reference transcripts, number punctuation and other languages are unchanged. This does not spell numbers out or alter Gemini/Chatterbox text handling.

Both languages preserve the approved inference flags: no prompt preprocessing, denoising or output cleanup; zero fade duration and zero padding; `audio_chunk_threshold=1e9` avoids automatic long-audio chunk cross-fades. Volume/RMS normalization remains. Later scene fitting/mixing is a separate existing stage. Preset speed/decoding steps and the shared request seed still apply; no saved English parameters are reset.

Persian uploads follow the original timestamp-at-the-end convention:

```text
video_<videoId>_tts_original_fa_scene_<sceneId>_<13-digit-timestamp>.wav
video_<videoId>_tts_original_fa_<13-digit-timestamp>.wav
scene_<sceneId>_tts_original_fa_<13-digit-timestamp>.wav
```

English retains the same patterns with `en`. Do not append adapter names or UUIDs after the timestamp. Adapter version, language, training update and worker PID/cache metrics are returned in generation metadata. Upload still uses the existing MinIO helper; generation does not itself patch Baserow.

## Verification and limits

Run focused checks with:

```bash
node --test scripts/checks/omnivoice-lora-routing.cjs
```

These offline regressions cover legacy English selection, Persian explicit binding, rejected language/version combinations, saved-field normalization, language-specific filenames/metadata and queued worker switching/idle shutdown. They do not prove live media generation.

Live integration evidence is retained at `~/Documents/OmniVoice-Persian-LoRA-v1/application-integration/`. API tests use sentinel scene/video IDs only to name new diagnostic MinIO objects; they do not save to Baserow or replace existing scene audio. UI selection is tested and restored to the original defaults; existing preset values are compared and preserved. See the saved API, lifecycle and final verification reports for exact results. Short lifecycle tests use isolated limits of two generations and 300 ms idle; these are not production settings or a 100-job endurance test. User listening approval came from the three original 3,000-update samples.
