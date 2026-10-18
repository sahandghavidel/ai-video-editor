# Persian full fine-tuning: optional application preset

The user authorized adding this model for application testing on 2026-10-18. This is an optional full checkpoint, not a LoRA adapter. Existing language defaults, presets, ordinary OmniVoice and frozen English/Persian LoRA weights are preserved. Listening approval is pending.

## Use it

Open **Global Settings → TTS → Manage Language Presets**, find **Persian — Full Fine-tune v1**, and click **Use for Persian TTS**. This saves the entry and selects it for new Persian dubbing jobs. Existing audio is skipped; selecting the voice does not replace recordings already generated. Use the same button on the previous Persian preset to switch back. English settings remain separate.

The new entry is enabled, initially not the default, and has:

- Preset/model ID: `persian-full-v1`.
- Language: `fa`.
- Visible provider: **OmniVoice Full Fine-tune — Local**.
- Reference filename: `fa-full-finetune-v1.wav`.
- Generation: float32 MPS, 34 steps, speed 1, no prompt preprocessing, output postprocessing, denoising, fades or padding.
- Existing Persian-only number normalization and existing Persian Baserow field mappings.

## Runtime and packaging

Default root: `~/Documents/OmniVoice-Persian-Full-Finetune-v1`. Optional server environment variable **`OMNIVOICE_PERSIAN_FULL_ROOT`** overrides only this experiment's root. Python uses `runtime-env/bin/python` if present, otherwise `env/bin/python` in that root. No new external service or Baserow field is needed.

The frozen inference package is `application-v1/model/`: full `model.safetensors`, config and text-tokenizer files copied from `full-output/checkpoint-2348`. Its audio tokenizer points to the isolated experiment's own `base-model/audio_tokenizer`, never the ordinary application's model. Optimizer/checkpoint state stays outside the inference package. The full model weight SHA-256 is `7cd692538e9c3c152bb9395680d965c5ca4ea504cc85775c3f30815258b7f763`.

`application-v1/approval.json` records integration authorization, language, version, 2348 updates, weight hash and `listening_approved: false`. The worker checks the language/version/update/weight binding before loading. Full-checkpoint hashing streams through bounded buffers.

To retain the existing route, storage and lifecycle contracts, this preset uses the internal provider ID `omnivoice-lora` and version field `loraAdapterVersion`. Those are compatibility identifiers. The server derives `modelType: full-finetune` from the trusted `persian-full-v1` registry entry. The Python worker loads `application-v1/model` directly and does **not** call `load_lora_adapter` for this version. Other model IDs keep their previous adapter paths and loading behavior. The diagnostic one-shot script also supports the full model.

It shares the serialized fine-tuned-model worker queue, version-aware switching, reference cache, default five-minute idle unloading and recycling after 100 generations. Switching LoRA/full versions waits for the old worker to close before loading the new model. Ordinary OmniVoice remains a separate runtime.

Generated scene filenames remain `video_<videoId>_tts_original_fa_scene_<sceneId>_<13-digit timestamp>.wav` for synchronization compatibility. Response metadata includes `adapterVersion: persian-full-v1`, `modelType: full-finetune`, language `fa`, trainingStep `2348`, preset/reference identity and worker metrics.

## Training provenance and verification

One full pass over 9,390 digit-free, unchanged Persian transcript/audio pairs (about 13.5 hours), starting from an independent original base copy. All 612,577,280 speech-generation parameters were trained, with the audio tokenizer unchanged. Float32 MPS, batch size 1, accumulation 4, learning rate 1e-5, cosine schedule and 5% warmup; 2348 optimizer updates in about 61 minutes. A short full-model trial, gradient audit, optimizer/scheduler restoration and longest-clip stress test passed before the full run. External `README.md`, `REPORT.md`, training configs and reports document the exact frozen-input cursor/resume procedure. Preserve those sources rather than reconstructing a resume from inference weights alone.

The application integration checks exercise all five versions and reject cross-language bindings. Four live API generations exercise full model twice, LoRA v2, then full model again; they check correct metadata, timestamp filenames, actual MinIO audio, cached-worker reuse and distinct workers on version switches. The WAVs match the standalone comparison output byte for byte. Browser inspection checks the full-model label and binding, enabled status, and unchecked default. Focused ESLint, Python compilation and `git diff --check` complete the source checks.

Evidence is stored in `application-integration/` under the external root. No Baserow write, paid provider call, production build, full-service restart or full-video dubbing test is part of this integration. Short tests do not prove 100-generation endurance or five-minute idle behavior. The user will judge pronunciation in actual videos.

Keep weights, reference media, environments, runtime data and generated samples outside commits. For future versions create a new frozen package and explicit registry/runtime binding; never overwrite this checkpoint, existing LoRAs or ordinary OmniVoice.
