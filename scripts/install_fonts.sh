#!/usr/bin/env bash
set -euo pipefail

# Downloads Space Grotesk, JetBrains Mono, and IBM Plex Sans open-source fonts
# into assets/fonts/ so your FFmpeg `fontfile` references can use them reliably.

OUT_DIR="$(pwd)/assets/fonts"
mkdir -p "$OUT_DIR"

echo "Downloading fonts into $OUT_DIR"

# Space Grotesk from Google Fonts repo (SIL OFL)
# Use the variable font filename (which includes [wght])
curl -Lf -o "$OUT_DIR/SpaceGrotesk-Variable.ttf" \
  "https://raw.githubusercontent.com/google/fonts/main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf"

# JetBrains Mono (Apache License 2.0) - official GitHub repo
curl -Lf -o "$OUT_DIR/JetBrainsMono-Regular.ttf" \
  https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/ttf/JetBrainsMono-Regular.ttf

# IBM Plex Sans (SIL OFL)
curl -Lf -o "$OUT_DIR/IBMPlexSans-Regular.ttf" \
  https://github.com/google/fonts/raw/main/ofl/ibmplexsans/IBMPlexSans-Regular.ttf

echo "Downloaded fonts. You can now run:
  python3 scripts/generate_ffmpeg_fonts.py > docs/ffmpeg-fonts.json
And restart your dev server to see the new fonts in the dropdown."
