# English OmniVoice LoRA: training and application runbook

This is the handover for Sahand's approved English LoRA v1 and the procedure for making a later version. It records the dataset collection, isolated experiment, listening decisions, application integration, filename repair, and persistent worker. Read this document before retraining or changing LoRA inference. Last reviewed: 2026-10-06.

## Current approved result and boundaries

The application has an optional English provider, `omnivoice-lora`, and preset **English — Nice LoRA v1**. It runs the adapter selected at **400 optimizer updates**, with a copy of the approved `nice.wav` reference. The existing ordinary OmniVoice provider, Python environment, model, references, and defaults remain available.

The original request was to collect approved sentence/audio pairs and train entirely outside the current workflow. Application integration was authorized later, after listening approval. Future training must again use separate output directories. Training or exporting data does not automatically deploy a model. Preserve `approved-v1/adapter/` and the original provider; only integrate a new version when requested/approved.

The user approved the tone, preferred LoRA over the comparison base, and approved the final examples with the Nice reference and all fades/denoising disabled. Do not replace those settings with defaults from earlier test scripts. The user prefers doing listening tests himself; prepare a focused comparison and let him judge it, rather than run repeated extra tests.

A LoRA is an adaptation of the base model, not a complete standalone model. In this experiment, the adapter can influence voice characteristics, pronunciation, rhythm, and tone. The reference also conditions the voice. There is no guarantee that training affects only pronunciation or that every future sentence will need no review.

## Locations and provenance

| Item | Location |
| --- | --- |
| Repository | `/Users/sahand/Desktop/projects-test/ultimate-video-editr` |
| Shared approved collection | `/Users/sahand/Documents/OmniVoice-English-Dataset` |
| Original isolated experiment | `/Users/sahand/Documents/OmniVoice-LoRA-Test` |
| Separate Python | `OmniVoice-LoRA-Test/env/bin/python` |
| Pinned training source | `OmniVoice-LoRA-Test/source/` |
| Independent offline base + audio tokenizer | `OmniVoice-LoRA-Test/base-model/` |
| Training checkpoints | `OmniVoice-LoRA-Test/output/` |
| Selected packaged adapter | `OmniVoice-LoRA-Test/adapter/` |
| Frozen application adapter | `OmniVoice-LoRA-Test/approved-v1/adapter/` |
| Approved listening examples | `OmniVoice-LoRA-Test/nice-reference-test/raw-examples/` |
| Application worker | `omnivoice-lora-local/worker.py` |
| One-shot diagnostic | `omnivoice-lora-local/generate.py` |

The pilot ran on an Apple M2 Max with 32 GB RAM, using MPS and float32. The separate Python 3.10 environment used OmniVoice **0.2.1**, PEFT **0.21.2**, PyTorch/Torchaudio **2.8.0**, Transformers **5.18.0**, Accelerate **1.15.0**, NumPy **2.2.6**, and SoundFile **0.14.0**. The full package freeze is `environment-versions.txt`. Ordinary OmniLocal retained its existing OmniVoice **0.1.2** installation; these packages were not installed into that environment.

Recorded training source revision: `08be0b4ccbac3e13e374e86fbfead4b4cac343e2` in `k2-fsa/OmniVoice`. Recorded base revision: `999c332499c708b116876ff5fe1aa5dd15f422ce`. The base directory is an independent copy with cache symlinks dereferenced. Keep it intact; adapter/base compatibility matters.

Historical `README.md` and `REPORT.md` in the external experiment describe the earlier pre-integration stage. Their statements that the application has not been integrated are historical. This repository runbook describes the later approved integration. Their early `speak.py` command is also not the final approved audio-settings template.

Weights, virtual environments, training data, generated media, credentials, and local runtime files must not be committed. No hosted training, paid GPU, or training-data upload was used. Application generation uses the existing local MinIO upload workflow.

## 1. Collect approved sentence/audio pairs

For non-English collection, use the separate preset-driven dropdown described in [Language-Voice-Dataset.md](Language-Voice-Dataset.md). Each language has its own collection; the English procedure below remains independent.

See [English-Voice-Dataset.md](English-Voice-Dataset.md) for the exporter contract. In the application, select an approved video and click **Export English voice dataset** in the selected-video section. The implementation is `src/app/api/export-english-voice-dataset/route.ts`, called from `src/components/OriginalVideosList.tsx`; its request is `POST /api/export-english-voice-dataset` with `{"videoId":1623}` (substitute the approved ID).

The exact Baserow fields are:

| Purpose | Field |
| --- | --- |
| Scene's video relation | `field_6889` |
| Sentence | `field_6890` / Sentence (6890) |
| English audio | `field_6891` / EN TTS (6891) |

Export reads all pages of scenes for that video through the existing authenticated Baserow helper. It does not filter by a Fix TTS status: user approval of the video is the approval boundary. It never edits Baserow or regenerates speech.

All videos contribute to **one shared flat folder**, not separate video folders:

```text
OmniVoice-English-Dataset/
  dataset.jsonl
  sample_<sentence-sha256>.wav
  sample_<sentence-sha256>.txt
```

Duplicate identity is the SHA-256 of the sentence after trimming outer whitespace and collapsing repeated whitespace. Case and punctuation remain significant. The first successfully exported pair wins. Re-exporting an existing sentence skips it, even if a later scene contains a different/better recording. Never silently replace the older approved pair. A targeted replacement needs deliberate approval and consistent updates to WAV, text, and manifest.

Skip empty/whitespace-only sentences and missing audio; report unreadable audio and failed rows. Save the Sentence field verbatim in the text file. FFprobe validates audio; WAV input is retained, other supported audio is converted to PCM WAV using FFmpeg. The manifest records `id`, absolute `audio_path`, `text`, `language_id: "en"`, `video_id`, `scene_id`, and `exported_at`.

The exporter uses `.export.lock`, per-pair temporary work, exclusive file publication, and atomic manifest replacement. Complete orphan pairs from an interrupted export can be indexed on retry. Indexed pairs with missing files are reported rather than overwritten. The repeated video-1623 export was checked to leave existing files unchanged.

**Transcript audit is still required before training:** export preserves the original Sentence field, while application TTS applies word replacement/text normalization before speaking. Audio and saved text can therefore differ. File integrity and `.txt`/manifest equality do not prove that the spoken words match. No ASR transcript audit was performed in v1.

## 2. The approved v1 dataset and split

The user approved these five videos:

| Video ID | Title | Unique pairs | Minutes |
| --- | --- | ---: | ---: |
| 1617 | INTRODUCTION DeepSeek Harness | 160 | 14.25 |
| 1621 | Introduction - HTML Tutorial for Beginners Full Course | 235 | 23.30 |
| 1623 | Introduction - Hermes Agent Tutorial for Beginners Install and | 246 | 19.49 |
| 1624 | Introduction - Higgsfield API in ChatGPT Codex Images and Video | 96 | 8.10 |
| 1625 | Introduction - Higgsfield API in ChatGPT Codex JavaScript King | 99 | 7.72 |
| Total | | 836 | 72.86 |

Training used **740 pairs / 64.76 minutes**. The whole video **1624** was held out for evaluation: **96 pairs / 8.10 minutes**. Text-equivalent training examples were excluded using lowercasing and non-alphanumeric removal; zero overlaps were found. This evaluation equivalence is stricter than the export duplicate rule.

All 836 audio files passed readability, finite-sample, and non-silence checks; they were 24 kHz and lasted approximately 1.76–28.28 seconds. This proves file integrity, not perfect pronunciation, exact transcripts, or identical speaker identity. See `dataset-summary.json`, `audio-integrity.json`, `train.jsonl`, `dev.jsonl`, and `excluded-overlap.jsonl` in the experiment.

## 3. Dataset preparation, tokenization, and Mac adjustment

The external scripts are the reproducible starting point, but they are **v1-specific**, not a general-purpose new-version command:

- `prepare_dataset.py` selects the five hardcoded IDs, holds out 1624, checks files/text agreement, writes train/dev/exclusion manifests, chooses three 3–6 second preflight clips, and writes the preflight configs and summary.
- `tokenize_dataset.py` invokes `omnivoice.scripts.extract_audio_tokens` for train/dev. It writes tar audio-token shards, JSONL text shards, and `data.lst`; these tokens are the model's audio representation, not ordinary WAV playback files.
- `run_train.py` loads the local training config, writes into `output/`, and appends metrics to `evaluation.jsonl` beside the script. Evaluation fixes seed 31415 and restores Python, NumPy, Torch CPU, and MPS random state so evaluation does not change subsequent training randomness. Training seed is 42.

Tokenization used the copied `base-model/audio_tokenizer`, two extraction workers (`--nj_per_gpu 2`), zero loader workers, at least four shards, and shuffling. It ran offline; nonempty `errors.jsonl` is a failure requiring inspection. The pilot tokenization ran on CPU.

On macOS, the isolated `source/omnivoice/training/builder.py` needed a multiprocessing fix: replace the local sample-length lambda with module-level `_sample_token_length`, used by both length callbacks. Spawn cannot pickle the local lambda. Preserve this adjustment when copying that source for a new run. Do not patch the original application's installed model/environment to solve a training issue.

**Script traps for the next run:**

1. Change all copied allowed-video/held-out-video IDs, including summary construction, not just the `allowed` set.
2. `prepare_dataset.py` currently reads the base revision from Hugging Face cache `refs/main`. That ref can move. For a new run, record the actual frozen base provenance/hashes instead of assuming that cache ref describes the copied weights.
3. `tokenize_dataset.py` also rewrites `train-config.json` and `data-config.json` with v1 pilot defaults. Customize the final training config **after tokenization** or change the copied script first.
4. Scripts derive their root from their own location. Running them from another working directory does not redirect their outputs. Copy them into the new version root before running.
5. Reusing v1's `run_train.py` in place risks its existing `output/` and appends to its evaluation log. Never do that for a new version.

## 4. Preflight and 400-update pilot

The three-update preflight used only three short approved examples. It confirmed MPS forward/backward passes, optimizer updates, and adapter checkpoint saving. It was not a useful trained voice.

The full pilot configuration is preserved in `train-config.json` and `data-config.json`. Important values:

| Setting | v1 value |
| --- | --- |
| Initialization | Local `base-model/`, no resume checkpoint |
| LLM architecture | `Qwen/Qwen3-0.6B` |
| LoRA rank / alpha / dropout / bias | 16 / 32 / 0.05 / none |
| LoRA targets | q/k/v/o projections and gate/up/down projections |
| Fully saved modules | `audio_embeddings`, `audio_heads` |
| Learning rate / weight decay / gradient clipping | `5e-5` / `0.01` / `1.0` |
| Updates / training seed | 400 / 42 |
| Warmup | 5% of updates |
| Attention / precision | SDPA / float32, mixed precision `no`, TF32 disabled |
| Maximum samples per microbatch | 2 |
| Batch tokens / sample token bounds | 1024 / 50–1000 |
| Gradient accumulation / data workers | 2 / 1 |
| Log / evaluate / save intervals | 10 / 100 / 100 updates |
| Checkpoint retention | All (`keep_last_n_checkpoints: -1`) |

Audio configuration: vocabulary size 1025, mask ID 1024, eight codebooks, weights `[8,8,6,6,4,4,2,2]`. Conditioning settings: drop-condition ratio 0.1, prompt ratio range `[0,0.3]`, mask ratio range `[0,1]`, language ratio 0.8, pinyin/instruction/only-instruction ratios zero. Consult the saved JSON rather than recreate omitted architecture settings from memory.

There were **26,886,144 trainable parameters** out of **639,463,424 total** (4.2045%). The pilot took approximately 8 minutes 29 seconds on that machine; this is a historical measurement, not an ETA for future data/configuration.

“400 steps” means **400 optimizer updates**, not 400 sentences, 400 epochs, or audio-generation steps. Gradient accumulation combines microbatches before an optimizer update. An epoch is one pass through the training data. The application's decoding `numStep` (original listening tests: 34) is a separate synthesis setting. The 100-generation worker recycle limit is also unrelated to training updates.

“Held-out masked-token loss” measures how well the model predicts hidden audio tokens for the development set it did not train on. Lower is better for this objective, but it is not a human pronunciation score.

| Optimizer update | Held-out loss |
| ---: | ---: |
| 0 (base) | 3.7042129039764404 |
| 100 | 3.450204372406006 |
| 200 | 3.3350775241851807 |
| 300 | 3.299241304397583 |
| 400 | 3.2934038639068604 |

Checkpoint 400 had the lowest recorded loss, roughly 11.1% below baseline. This does **not** mean the voice is 11.1% better. Listening approval was essential. Checkpoints 100/200/300/400 remain in `output/`; see `evaluation.jsonl`, `train.log`, and `selected-adapter.json`.

## 5. Packaging the selected adapter

The selected inference package in `adapter/` contains 394 tensors, 107,596,368 bytes of adapter weights, all checked finite. A separate frozen copy in `approved-v1/adapter/` is what the application loads. Do not train into or overwrite this directory.

A required packaging correction: upstream `target_modules` short names such as `q_proj` also match the full inference model's audio-tokenizer semantic encoder. That tokenizer was not part of the training builder's adapted LLM, causing missing-adapter-weight warnings when loading the full inference model.

The packaged `adapter_config.json` instead specifies the **196 exact trained `llm.*` module paths** derived from the saved LoRA-A weight keys. No learned tensor changed. The original broad config is preserved in `adapter-config-before-target-scoping.json`; training snapshots are untouched.

For a new version, derive target paths from that adapter's actual saved weights and match them to inference model module names. Do not blindly assume 196 targets or attach adapters to the audio tokenizer. Verify loading without missing adapter keys and inspect finite tensors. Keep the original checkpoint/config for training resumption; inference target scoping is a packaging step, not an architecture change to an existing training checkpoint.

## 6. Listening history: mouth sound, Nice reference, and fades

The first five base/LoRA pairs in `comparison/` included three unseen sentences and two held-out sentences. Both models used the standalone 0.2.1 environment, identical seeds/settings, and a 3.52-second reference saying “Next, I need my Telegram user ID to connect the bot.” This comparison isolated the adapter effect within 0.2.1; it did not compare against the application's older 0.1.2 worker. The user preferred LoRA's tone.

A recurring swallowing/click-like mouth sound at the start occurred in both base and LoRA outputs with the old reference. Enabling denoising and cleanup did not solve it. A completely unrelated gardening passage was also tested (`new-topic-comparison/`). The user then requested `nice.wav`. Using that reference removed the annoying sound in the user's listening assessment. The evidence points to reference conditioning; it does not establish that training alone caused the artifact.

The approved source is `omnivoice-local/references/nice.wav`: approximately 19.633 seconds, 44.1 kHz stereo, with its existing preset transcript. Integration copies it byte-for-byte to `nice-lora-v1.wav` and copies the transcript. Preserve the exact recording/transcript pair. A reference transcript must describe what that reference actually says, not the new sentence being generated.

Four further examples covered cooking, travel, astronomy, and everyday life, with seeds 173, 829, 2401, and 6709. Earlier versions used output cleanup. The user heard a fade-out. Source inspection showed that `fade_and_pad_audio` still runs even when output postprocessing is disabled, with a default 0.1-second fade at both ends. Simply setting `postprocess_output=False` was therefore insufficient.

The final examples in `nice-reference-test/raw-examples/`, generated by `test_nice_raw.py`, explicitly used:

```text
reference: nice.wav + its correct transcript
float32; speed=1; num_step=34
preprocess_prompt=False
postprocess_output=False
denoise=False
fade_duration=0.0
pad_duration=0.0
```

The user approved these results. The application also sets `audio_chunk_threshold=1e9` to avoid automatic long-audio chunk cross-fades. Model RMS/volume normalization remains; “raw examples” does not mean unnormalized decoder samples. Downstream scene-duration fitting/mixing is a separate existing application stage and can still alter the final video audio.

**Do not reuse early scripts unchanged:** `speak.py` and `generate_comparison.py` retain the old reference/default fade behavior. Use `test_nice_raw.py` or the current application worker as the approved-settings reference. No ASR/WER or speaker-similarity benchmark was run. User listening and technical file checks are the v1 evidence.

## 7. Application selection, routing, and storage

Open **Manage Language Presets**, find **English — Nice LoRA v1**, and click **Use for English TTS**. This saves presets and selects its provider/reference through the existing browser TTS settings/localStorage paths. To choose it for one scene, right-click that scene's TTS button and select the named preset. Return to ordinary OmniVoice using the original English preset or its filename menu entry.

The preset ID is `english-nice-lora-v1`, provider `omnivoice-lora`, reference filename `nice-lora-v1.wav`, with English/LoRA tags and the original reference transcript/field mapping. It was added enabled and **not as a replacement language default**. Initial settings were MPS, float32, 34 decoding steps, speed 1. Presets are mutable: the later saved persistent-worker API tests used **8 decoding steps** because the preset had changed. Do not reset the user's current saved setting to 34; 34 describes the original approved listening experiment.

When LoRA is selected globally, its global reference wins over older scene/video voice overrides. An explicit right-click voice selection wins for that request. Ordinary provider precedence remains unchanged; choosing an original reference explicitly routes to its original provider even when LoRA is the global selection.

Configured-language batching still resolves its language/default preset. Selecting LoRA globally for English does not silently replace every dubbed-language default. Inspect the actual resolved preset when diagnosing batch behavior.

| Layer | Implementation / responsibility |
| --- | --- |
| Provider types and validation | `src/utils/geminiTtsSettings.ts`, `src/lib/ttsAudioReferencesStore.ts`, `src/app/api/tts-audio-references/route.ts` |
| Preset UI and data | `src/components/TTSAudioReferencesModal.tsx`, `src/data/tts-audio-references.json` |
| Persisted/global settings | `src/store/useAppStore.ts`, `src/components/TTSSettings.tsx`; existing default/load/save/update/reset paths |
| Per-scene choice | `src/components/SceneCard.tsx`; passes reference provider explicitly |
| Full-script/selected generation | `src/components/OriginalVideosList.tsx`, `src/app/api/generate-tts-selected/route.ts` |
| LoRA endpoint | `src/app/api/generate-tts-omnivoice-lora/route.ts` forwards to the shared OmniVoice POST with the LoRA provider |
| Shared text preparation/dispatch | `src/app/api/generate-tts-omnivoice/route.ts`; existing replacements/normalization; LoRA branches before starting the original worker |
| LoRA job/upload wrapper | `src/lib/omniVoiceLora.ts` |
| Worker manager | `src/lib/omniVoiceLoraWorker.ts` |
| Python inference | `omnivoice-lora-local/worker.py` |
| Configured-language propagation | `src/app/api/create-dubbed-fa/route.ts`, `src/app/api/generate-scene-tts-by-field/route.ts` |

The LoRA wrapper validates local files, English reference/transcript selection, and input length (maximum 12,000 characters). It resolves the preset device (auto to MPS on this setup), keeps float32, copies the current preset decoding steps/speed, and uses the existing seed behavior (default 1212 or valid request seed). Invalid LoRA selections fail explicitly instead of silently falling back.

The base and adapter are loaded from the external runtime. PEFT merges adapter weights into the process's in-memory model for inference; it does not replace the original model on disk. Generation writes a temporary WAV and uploads via existing MinIO helpers. The generation endpoint itself does not patch Baserow: the existing UI/batch caller saves the resulting EN TTS URL to `field_6891`. No Baserow field/schema was added. Existing scene fitting remains separate.

### Filename contract and the sync repair

All LoRA English output must follow the existing OmniVoice timestamp-at-the-end contract:

```text
video_<videoId>_tts_original_en_scene_<sceneId>_<13-digit-timestamp>.wav
video_<videoId>_tts_original_en_<13-digit-timestamp>.wav
scene_<sceneId>_tts_original_en_<13-digit-timestamp>.wav
```

An early file ended in `_<timestamp>_lora_v1_<uuid>.wav`. Sync could not extract its TTS timestamp. The fix removed the provider/UUID suffix and retained version identity in generation metadata. Do not change sync parsers to compensate for a different LoRA naming scheme.

The affected video 1623 / scene 227095 file was copied to `video_1623_tts_original_en_scene_227095_1791266895726.wav`, preserving audio bytes and timestamp; only that scene's `field_6891` was patched (its computed last-modified field also changed). The old object was retained and protected fields were compared. Evidence: `naming-repair-before.json`, `naming-repair-after.json`, `naming-generation-test.json` and WAV. The existing parser in `src/utils/batchOperations.ts` recognized repaired/new names; the video route uses the same trailing-timestamp assumption. Refresh stale browser scene data after repairing a saved URL.

## 8. Persistent worker: how the model runs

The first application version launched `generate.py` once per request and used a request lock. The user requested the ordinary OmniLocal lifecycle: retain the loaded model, unload after idle time, and recycle periodically. This was added **only to the LoRA worker**.

`worker.py --root <runtime-root> --device mps` loads the independent base and `approved-v1/adapter/` once, then accepts JSONL jobs on stdin and emits JSONL readiness/results on stdout. The manager launches it automatically on demand; do not manually start a competing worker while using the application. CPU is supported separately, but the measured/approved setup was MPS.

`src/lib/omniVoiceLoraWorker.ts` holds a shared `globalThis.__omniVoiceLoraRuntime` state so route bundles/dev reloads share one LoRA worker and one promise queue. Requests are serialized. The worker cache retains up to 16 prepared voice prompts, keyed by resolved reference path, file size, modification timestamp, transcript, and preprocessing flag; least-recently-used entries are evicted.

Each request resets Python/NumPy/Torch CPU/MPS randomness from its seed, generates with the approved flags, and writes PCM16 WAV. A successful WAV increments the generation count. After **100 successful generations**, the worker returns the last result with `reload_needed`, exits, and the next queued request loads a new worker. This is 100 synthesis jobs, not 100 training updates.

The **five-minute idle timer starts after completion**. New work cancels it; busy generation is not killed by an idle timer. Timer actions use the same queue and an idle version guard to prevent a stale timer shutting down a newly busy process. Shutdown waits for close (SIGTERM, then SIGKILL after five seconds if needed) before replacement loads. Worker object identity protects a new worker from old exit callbacks. Generation failures/timeouts reset only LoRA; later queued requests are preserved.

A process-owned `fcntl` advisory lock at `<root>/application-worker.lock` prevents competing LoRA workers. The OS releases it on exit/crash. The presence of that file alone is harmless and is not proof of a busy worker. Do not confuse it with the earlier request-based `application.lock` design.

The original OmniLocal worker/configuration remains separate. Its Python fallback recycle default was 10, but this application's configured limit was 100; normal idle timeout was five minutes and job timeout was disabled. LoRA matches the configured behavior while retaining its own state/process.

| Environment variable | Default / resolution |
| --- | --- |
| `OMNIVOICE_LORA_ROOT` | `~/Documents/OmniVoice-LoRA-Test` |
| `OMNIVOICE_LORA_MAX_GENERATIONS_BEFORE_RELOAD` | Override; else original `OMNIVOICE_MAX_GENERATIONS_BEFORE_RELOAD`; else 100 |
| `OMNIVOICE_LORA_IDLE_TIMEOUT_MS` | 300000 (five minutes) |
| `OMNIVOICE_LORA_PROMPT_CACHE_SIZE` | 16 |
| `OMNIVOICE_LORA_JOB_TIMEOUT_MS` | Override; else original `OMNIVOICE_JOB_TIMEOUT_MS`; else 0 (disabled) |

The Python subprocess runs offline with `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, `OMP_NUM_THREADS=4`, `MKL_NUM_THREADS=4`, and `PYTORCH_ENABLE_MPS_FALLBACK=0`. No network model download is part of a normal generation. The worker key includes root, device, float32, `approved-v1`, protocol version, and cache/recycle configuration; a key change replaces the worker.

For an intentionally separate one-shot diagnostic, `generate.py --job /absolute/path/job.json` expects JSON fields `runtime_root`, `device`, `reference_audio`, `reference_text`, `seed`, `text`, `num_step`, `speed`, and `output`. Supply absolute local paths, the correct Nice transcript, and an output in an experiment folder. Run it with the external `env/bin/python` and the same offline variables. It loads v1 for that process and exits; it does not upload to MinIO or update Baserow. It does not share the persistent worker's queue/lock, so avoid running it alongside a loaded application worker when measuring memory. Ordinary application use requires no manual Python command: select the preset and generate through the existing UI.

Results/logs expose PID, successful generation count, reload flag, cache hit/size, prompt/generation time, duration/sample rate, RSS, current MPS allocation, and sampled peak tensor/driver allocation. Check both MPS tensor and driver memory; tensor memory alone misses driver growth. Sampling is approximately every 0.1 seconds, not a guarantee of observing every instantaneous peak.

### Saved verification and limits

The external `test-worker-lifecycle.cjs` used a separate process with limit **2**, idle **300 ms**, and a 180-second timeout; it did not change production defaults. Its `lifecycle-test/` root points read-only to the existing environment/base/adapter while keeping a separate worker lock. It tested queued jobs, prompt-cache reuse, recycle/reload, a failing reference followed by a successful queued job, and idle exit. Four successful WAVs matched the approved cooking example byte-for-byte. Evidence: `worker-lifecycle-results.json` and `worker-lifecycle-test.log`.

The first two application API results (`persistent-app-first.json`, `persistent-app-second.json`) reused PID 28407: counts 1/2, prompt-cache miss then hit. The second prompt preparation took approximately 0.005 ms and generation 4.89 seconds at that preset's 8 decoding steps. Sampled driver peak was approximately 4.48 GB decimal. This is focused reuse/recycle evidence, **not** a 100-job endurance benchmark. Saved typecheck logs include unrelated baseline errors; do not claim a clean repository-wide typecheck/build. The user took over further manual listening tests.

## 9. Procedure for a new LoRA version

Do this in order. The following is a future-run procedure, not evidence that v2 has already been trained.

1. Read this runbook and the dataset exporter document. Inspect current preset data/browser selection, runtime root, adapter config, worker version key, and saved v1 metrics. Preserve the user's current settings and v1 files. Confirm the approved new video IDs and the intended voice/reference. Ask for missing approvals/IDs before including unapproved data.
2. Export approved videos to the same collection, honoring its duplicate rule. Freeze a selected manifest and record file hashes for the experiment so later collection changes cannot silently alter the run. Review transcript/audio agreement, speaker consistency, clipped starts/ends, mouth sounds, repetitions, and known difficult words. Keep raw approved pairs; do not add fades/denoising by default.
3. Create a fresh version directory, for example `/Users/sahand/Documents/OmniVoice-LoRA-v2` (proposed name, not an existing deployment). Copy/adapt the preparation, tokenization, and training scripts into it. Reuse the known separate environment and compatible frozen base through deliberate read-only links/copies; ensure the new scripts' `env/`, `base-model/`, and `source/` references resolve correctly. Do not install into or modify ordinary OmniLocal. Record actual dependency/source/base revisions and the local Mac patch.
4. Set approved video IDs and a whole-video held-out split in the copied preparation script. Exclude canonical text overlap across train/dev. Keep the v1 held-out benchmark available for comparison; if expanding training to include old dev data, designate a new unseen held-out video and report that evaluation sets differ. Inspect pair/minute counts and manifest paths.
5. Tokenize the three preflight clips with the copied tokenizer; run a three-update hardware preflight. Then tokenize train/dev, inspect extraction errors and manifests. Customize final configs after the tokenization script's config writes. Save an immutable copy of the final configs before full training.
6. Start conservatively with the proven rank/precision/batching. Decide explicitly whether this is fresh adaptation from the same base or resuming a checkpoint. For resume, inspect upstream optimizer/scheduler/global-step restoration and the new schedule horizon first. Do not assume that increasing `steps` and pointing at an adapter alone is a correct resume. Use the training checkpoint and unchanged compatible architecture, not just the inference-scoped package.
7. Train offline into the new root, save intermediate checkpoints, record baseline and fixed-seed held-out evaluation. If testing longer training, 600/800 updates are comparison candidates, not promises of improvement. Watch loss, omissions, artifacts, overfitting, and actual listening quality; pick a checkpoint from evidence rather than automatically taking the last.
8. Package the selected checkpoint into a new adapter directory; scope target modules to actual trained LLM paths, check finite weights and missing-key warnings, and record step/loss/hashes/base version. Never overwrite `approved-v1`.
9. Produce a small matched v1/v2/base comparison with identical Nice reference/transcript, seeds, precision, decoding steps, speed, and all approved audio flags. Include wholly new topics and known difficult pronunciations; keep training/dev sentences labeled. Let the user listen before deployment. A reference change must be tested separately so its effect is not confused with a training change.
10. After approval, freeze the selected version, add explicit version routing as described below, copy the approved reference under a distinct filename/preset name if desired, and preserve v1 and ordinary OmniVoice. Validate filenames, route/preset resolution, queue/cache/recycle behavior, and controlled MinIO output without overwriting unrelated approved scene audio. Document the new run's dataset, configs, revisions, metrics, listening decision, and deployment binding here or in a linked version report.

### Command pattern for isolated training

These commands describe the existing scripts' interfaces. Run them only after preparing a **new root** and inspecting its copied scripts/configs. The root below is an example, not an instruction to rerun v1.

```bash
lora_run_root="/Users/sahand/Documents/OmniVoice-LoRA-v2"
export HF_HUB_OFFLINE=1
export OMP_NUM_THREADS=4
export MKL_NUM_THREADS=4
export PYTHONPATH="$lora_run_root/source"

"$lora_run_root/env/bin/python" "$lora_run_root/prepare_dataset.py"
```

For preflight tokenization, use the same extraction module as the full tokenization script, but input `preflight.jsonl`, outputs under `preflight-tokens/`, and the local audio tokenizer. Check the pinned module's CLI and resulting `data.lst` rather than assume an upstream version's flags. Then:

```bash
"$lora_run_root/env/bin/python" -m omnivoice.scripts.extract_audio_tokens \
  --input_jsonl "$lora_run_root/preflight.jsonl" \
  --tar_output_pattern "$lora_run_root/preflight-tokens/audios/shard-%06d.tar" \
  --jsonl_output_pattern "$lora_run_root/preflight-tokens/txts/shard-%06d.jsonl" \
  --tokenizer_path "$lora_run_root/base-model/audio_tokenizer" \
  --nj_per_gpu 2 --loader_workers 0 --min_num_shards 4 --shuffle True
# Inspect extraction errors and preflight-tokens/data.lst before training.
"$lora_run_root/env/bin/python" -m omnivoice.cli.train \
  --train_config "$lora_run_root/preflight-train-config.json" \
  --data_config "$lora_run_root/preflight-data-config.json" \
  --output_dir "$lora_run_root/preflight-output"

"$lora_run_root/env/bin/python" "$lora_run_root/tokenize_dataset.py"
# Inspect tokenization errors, then edit/freeze final training configs.
"$lora_run_root/env/bin/python" "$lora_run_root/run_train.py" \
  > "$lora_run_root/train.log" 2>&1
```

Do not rerun into populated token/output directories without an intentional recovery plan. Persist logs and evaluate the process result; file existence alone does not prove success. The local environment must already contain the model dependencies/cache required by the pinned training source.

### Important: v2 selection is not implemented yet

Currently every `omnivoice-lora` preset loads **the same hardcoded v1 adapter**. Duplicating a preset and naming it v2 does not select a new adapter.

To keep v1 and v2 selectable together, add an explicit, validated adapter-version binding to presets and pass it through the server job. Resolve only approved version directories; include the selected version in the worker key so it reloads when changing adapter. Update the Python load path and returned metadata consistently. The current hardcoded locations are:

- `omnivoice-lora-local/worker.py`: `approved-v1/adapter` loading.
- `src/lib/omniVoiceLoraWorker.ts`: `approved-v1` worker identity.
- `src/lib/omniVoiceLora.ts`: adapter validation and `adapterVersion: approved-v1` / `trainingStep: 400` metadata.

Update the preset schema/store/API/UI and request propagation together if adding a version field. Keep old persisted presets backward compatible with v1 and preserve load/save/reset/default behavior. `OMNIVOICE_LORA_ROOT` is a single runtime root override, not per-preset adapter routing. Do not repoint the application to an experimental root as a substitute for keeping both versions.

## 10. Improving the next version

The strongest next step is more **varied, correctly transcribed, consistently voiced approved audio**, especially examples targeting repeated pronunciation mistakes. Another 60–120 approved minutes would give roughly 2–3 hours total; this is a practical experiment target, not an official minimum or quality guarantee.

Include technical terms, numbers, dates, abbreviations, questions, and different sentence lengths. Exclude incorrect/clipped examples even if it reduces minutes. Approved v1-generated audio can be useful, but blindly training on its output may reinforce its errors and narrow its style. Retain independent held-out/new-topic tests. Longer training on the same data may help or overfit; compare checkpoints before deciding.

## Troubleshooting and validation rules

| Symptom | First checks |
| --- | --- |
| Mouth click/swallow at each start | Reference recording/transcript and matched reference test; denoising did not solve the original issue |
| Fade at beginning/end | Explicit `fade_duration=0`, `pad_duration=0`, not only postprocessing false; downstream fitting and chunk behavior |
| Missing adapter keys during load | Exact trained LLM target scoping, compatible base/environment, no accidental tokenizer adapters |
| Model reloads every request | Actual provider route, shared worker PID, lifecycle logs; application should use `worker.py`, not one-shot `generate.py` |
| First request slow, later faster | Expected load and prepared-reference cache; verify PID/cache hit before diagnosing |
| Worker lock file remains | OS advisory ownership/process, not file existence; do not delete a live worker's lock |
| Sync cannot extract timestamp | Trailing `_<13 digits>.wav`, no provider/version/UUID suffix |
| Selected v2 sounds like v1 | No per-preset version binding currently; inspect actual worker path/key and generation metadata |
| Export skips corrected sentence | Expected first-pair-wins rule; arrange a deliberate targeted replacement |
| Memory concern | Sample both MPS tensor and driver allocation, queue/recycle and cache bounds; short tests do not prove endurance |

For application code changes, use scoped ESLint on touched JS/TS and `git diff --check`; distinguish baseline typecheck errors. Do not run a production build routinely or restart the full development helper unintentionally (it also restarts MinIO). Manual app smoke tests require the configured Baserow/MinIO/runtime dependencies. Use controlled outputs and no unrelated scene mutations. For a documentation-only update, inspect source/config/evidence and check the diff; no new generation or training is necessary.

## Upstream references and evidence index

Consult the pinned source and recheck guidance if upgrading; upstream `master` may change:

- [OmniVoice LoRA fine-tuning](https://github.com/k2-fsa/OmniVoice/blob/master/docs/lora_finetuning.md)
- [Training](https://github.com/k2-fsa/OmniVoice/blob/master/docs/training.md)
- [Data preparation](https://github.com/k2-fsa/OmniVoice/blob/master/docs/data_preparation.md)
- [LoRA training example](https://github.com/k2-fsa/OmniVoice/blob/master/examples/run_finetune_lora.sh)

Evidence retained under the external experiment root includes: `environment-versions.txt`, `dataset-summary.json`, `audio-integrity.json`, preflight/tokenization/training logs and configs, `evaluation.jsonl`, `selected-adapter.json`, original and scoped adapter configs, comparison/new-topic/Nice examples, `application-unchanged-check.json` (pre-integration preservation), `application-integration-verification.json`, application preset/settings snapshots, naming repair/generation evidence, and persistent-worker lifecycle/API results. Preserve stage labels: an early “unchanged application” report and a later integrated application report describe different points in this procedure.
