# English voice dataset export

After reviewing the selected video's English narration, click **Export English
voice dataset** in the Selected Video section. Clicking means the video's pairs
are approved for collection; no Fix TTS status filter is applied.

`POST /api/export-english-voice-dataset` accepts `{ "videoId": 1623 }`. It reads
all pages of scenes related through field 6889 using the existing Baserow helper,
exports Sentence (6890) and EN TTS (6891), and never updates Baserow or regenerates
audio. Existing Baserow configuration and reachable audio storage are required.
FFprobe validates downloaded audio; FFmpeg converts non-WAV sources to PCM WAV.
WAV sources are preserved without processing. No model or GPU is needed.

All videos share `~/Documents/OmniVoice-English-Dataset/` on the machine running
Next.js. This is a local server export, not a browser download. Each pair has a
SHA-256 sentence-based `sample_<hash>.wav` and matching `.txt`. `dataset.jsonl`
contains OmniVoice input fields `id`, absolute `audio_path`, `text`, and
`language_id: "en"`, plus source `video_id`, `scene_id`, and `exported_at`.

Empty/whitespace-only sentences and missing audio are skipped. Duplicate matching
trims surrounding whitespace and collapses repeated whitespace. Case and
punctuation remain significant; the original field 6890 text is saved. The first
successfully exported pair wins, including duplicates within one video. Existing
pairs are never overwritten. Missing files for an indexed pair are reported as
failures so they can be restored. Counts and per-scene errors appear after export.

An exclusive `.export.lock` prevents concurrent writers. If the server terminates
mid-export, remove this lock only after verifying that no export is running.
Interrupted exports can leave complete audio/text files without a manifest entry;
the next export can index the matching files. The manifest is replaced atomically
only after both files are saved. Temporary `.sample-*` directories left by a
terminated process can be removed when no export is running.

The transcript must match what the audio actually says. The exporter deliberately
uses field 6890 as requested; it does not rewrite text to match TTS preprocessing.
Review mismatches before training. Keep narration free of background music.

OmniVoice's preparation tools accept WAV/FLAC/MP3 and resample to 24 kHz, then
convert the JSONL collection into audio-token shards. Tokenization, train/dev
splitting, and training are later steps. If the dataset moves to another machine,
regenerate the absolute audio paths in the training manifest.

Official format: https://github.com/k2-fsa/OmniVoice/blob/master/docs/data_preparation.md
