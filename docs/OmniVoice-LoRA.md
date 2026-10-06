# English OmniVoice LoRA v1

The optional `omnivoice-lora` provider uses the approved 400-update adapter, independently of the existing OmniVoice installation. Its initial English preset is **English — Nice LoRA v1** with `nice-lora-v1.wav`, a byte-identical copy of `nice.wav`, and the same transcript. Existing presets and defaults are retained.

## Selecting a voice

Open **Manage Language Presets**, find **English — Nice LoRA v1**, and click **Use for English TTS**. This saves the presets and selects the provider/reference in the existing browser TTS settings. Settings persist through the existing localStorage update/load/reset paths. When LoRA is selected globally, its reference takes precedence over older scene/video voice overrides. Ordinary provider precedence remains unchanged. To select LoRA for just one scene, right-click its TTS button and choose **English — Nice LoRA v1**. To return to the original voice, use the original English preset or choose its filename in that menu.

The English preset copies its existing Baserow field mapping; no schema is added. Raw English generation continues to save EN TTS (`field_6891`) through the existing callers. Configured-language batching carries the selected provider and reference through `create-dubbed-fa` and `generate-scene-tts-by-field`. Existing scene fitting remains a separate pipeline stage.

## Separate runtime

`OMNIVOICE_LORA_ROOT` optionally specifies the external runtime directory. The default is `~/Documents/OmniVoice-LoRA-Test`, containing:

- `env/bin/python`: the separate OmniVoice 0.2.1 / PEFT environment.
- `base-model/`: the complete offline base model and audio tokenizer.
- `approved-v1/adapter/`: a frozen copy of the approved adapter, separate from training outputs.

`omnivoice-lora-local/generate.py` runs one request per Python process. It never imports or changes the original app Python environment. Requests run offline. The process exits after generation, releasing its model memory; this adds model-loading time to each scene. A filesystem lock prevents concurrent LoRA loads. If Next.js is forcibly stopped, remove `application.lock` only after confirming no LoRA generation process remains.

Generation uses float32, the preset device (auto resolves to MPS), preset decoding steps/speed (initially 34 / 1), and the existing TTS seed (default 1212). Denoising, reference preprocessing, output silence removal, fade-in, fade-out, and added padding are disabled. Automatic chunking is disabled to avoid chunk cross-fades. Existing model volume normalization is retained, matching the approved experiments.

`/api/generate-tts-omnivoice-lora` shares normal OmniVoice text preparation. The original endpoint also recognizes the distinct LoRA reference and dispatches before starting or changing its original worker. Invalid LoRA selections fail explicitly instead of falling back to a different model. Outputs use the same timestamp-at-the-end filenames as ordinary English OmniVoice (`video_<videoId>_tts_original_en_scene_<sceneId>_<timestamp>.wav`, or the existing video-only/scene-only variants). Provider and adapter identity stay in generation metadata. This preserves sync timestamp parsing. Uploads use the existing MinIO mechanism. Generation alone does not update Baserow; existing UI/batch callers do that.

## Future training

Train into separate versioned output directories, evaluate against v1, and explicitly approve a new version before changing the deployed adapter. Do not overwrite `approved-v1` during training. Reference audio, environments, model weights, and generated audio stay local and must not be committed.
