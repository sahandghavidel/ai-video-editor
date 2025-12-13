# FFmpeg Fonts on this Machine (macOS)

This document lists fonts that FFmpeg (with fontconfig) can use on this specific machine, plus a quick guide on how to ensure deterministic font usage in FFmpeg `drawtext`.

Summary:

- FFmpeg is installed and built with libfontconfig and freetype support (so it will use system fonts).
- Fontconfig (`fc-list`) is available and can enumerate all fonts that FFmpeg can reference by family.
- Recommended: Always use `fontfile=/path/to/font.ttf` in `drawtext` for reproducible results.

## How FFmpeg locates fonts

- By family name (fontconfig): drawtext=font='Helvetica'
- By explicit file path (recommended): drawtext=fontfile='/path/to/Inter-Regular.ttf'

## Quick validation commands (run locally)

List all fonts recognized by fontconfig:

```bash
fc-list | sed -n '1,80p'
```

Test FFmpeg `drawtext` with a family name:

```bash
ffmpeg -f lavfi -i color=black:s=1280x720 -vf "drawtext=font='Arial':text='Arial test':fontcolor=white:x=10:y=10" -frames:v 1 test_arial.png
```

Test FFmpeg `drawtext` with an explicit fontfile (always works if the font exists):

```bash
ffmpeg -f lavfi -i color=black:s=1280x720 -vf "drawtext=fontfile='/System/Library/Fonts/Supplemental/Arial.ttf':text='Arial test':fontcolor=white:x=10:y=10" -frames:v 1 test_arial_file.png
```

## Fonts I found on this machine (paths & families)

These were discovered via `fc-list` and system font directories (`/System/Library/Fonts`, `/Library/Fonts`, and `~/Library/Fonts`).

Note: Many system fonts on macOS use TTC collections (`.ttc`), which are supported by FFmpeg/freetype.

| Family (human)                          | Sample path (use `fontfile` to be reliable)                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Arial / Arial Unicode                   | `/System/Library/Fonts/Supplemental/Arial.ttf`                                                   |
| Helvetica / Helvetica Neue              | `/System/Library/Fonts/Helvetica.ttc`, `/System/Library/Fonts/HelveticaNeue.ttc`                 |
| Menlo                                   | `/System/Library/Fonts/Menlo.ttc`                                                                |
| Monaco                                  | `/System/Library/Fonts/Monaco.ttf`                                                               |
| Courier / Courier New                   | `/System/Library/Fonts/Courier.ttc`, `/System/Library/Fonts/Supplemental/Courier New.ttf`        |
| Times / Times New Roman                 | `/System/Library/Fonts/Times.ttc`, `/System/Library/Fonts/Supplemental/Times New Roman.ttf`      |
| Avenir / Avenir Next                    | `/System/Library/Fonts/Avenir.ttc`, `/System/Library/Fonts/Avenir Next.ttc`                      |
| Palatino                                | `/System/Library/Fonts/Palatino.ttc`                                                             |
| Optima                                  | `/System/Library/Fonts/Optima.ttc`                                                               |
| New York (Apple)                        | `/System/Library/Fonts/NewYork.ttf`                                                              |
| SF Compact / SF NS / SF Family          | `/System/Library/Fonts/SFCompact.ttf`, `/System/Library/Fonts/SFNS.ttf`                          |
| Noto Sans / Noto Serif (many variants)  | `/System/Library/Fonts/Supplemental/NotoSans*.ttf`, `/System/Library/Fonts/NotoSerifMyanmar.ttc` |
| Arial Unicode MS (wide Unicode support) | `/Library/Fonts/Arial Unicode.ttf`                                                               |
| User-installed font (this machine)      | `/Users/sahand/Library/Fonts/KOMIKAX_.ttf`                                                       |

This is not a complete dump — `fc-list` will show everything. To search for a specific font name use `fc-list | grep -i <name>`.

A JSON mapping of common installed fonts and sample paths is available at `docs/ffmpeg-fonts.json` in this repository — feel free to use it for automation or CI tests.

### Popular fonts NOT installed (check and install if you need them)

The Google-fonts/modern list you provided contains many great fonts that are _not_ installed by default on macOS (e.g., Inter, Roboto, Montserrat, Poppins, JetBrains Mono, Fira Code). These will not be found by `fc-list` until installed.

You can install them with Homebrew Cask fonts and then use them by family or by `fontfile`:

```bash
brew tap homebrew/cask-fonts
brew install --cask font-inter font-roboto font-montserrat font-poppins font-jetbrains-mono font-fira-code font-source-code-pro
```

After installing, `fc-list` will list them and FFmpeg can use them either with `font='Inter'` or with `fontfile='/Library/Fonts/Inter-Regular.ttf'`.

## Recommendations

1. Always prefer `fontfile` for reproducibility. If you rely on family names, fonts may vary by machine.
2. If a font is not found, you can (a) point to a `fontfile` in your repo or `~/Library/Fonts`, or (b) install via cask/fonts and use by family.
3. For subtitles or UI text, the following present system fonts are reliable on macOS and good to use: `Helvetica`, `Arial`, `Noto Sans`, `Avenir`, `Menlo` (mono), `Monaco` (mono), and `New York`.

## Automated test snippets used in this environment

You can copy these tests to your machine to double-check availability:

```bash
# check fontconfig list
fc-list | head -n 40

# test drawtext using family name
ffmpeg -f lavfi -i color=black:s=320x240 -vf "drawtext=font='Arial':text='Arial':fontcolor=white:x=10:y=10" -frames:v 1 ./test_arial.png

# test drawtext using fontfile
ffmpeg -f lavfi -i color=black:s=320x240 -vf "drawtext=fontfile='/System/Library/Fonts/Helvetica.ttc':text='Helvetica':fontcolor=white:x=10:y=10" -frames:v 1 ./test_helvetica.png

# if you added Inter or Roboto, test them too
ffmpeg -f lavfi -i color=black:s=320x240 -vf "drawtext=font='Inter':text='Inter':fontcolor=white:x=10:y=10" -frames:v 1 ./test_inter.png
```

## Summary

- FFmpeg can use any TTF/OTF/collection (TTC) fonts recognized by the system's fontconfig.
- In this environment (macOS), the machine has many standard system fonts (Helvetica, Arial, Menlo/Monaco, Noto family, Avenir, Times/Palatino/Optima, New York, SF family).
- If you want Inter, Roboto, or other Google fonts, install them and then use `fontfile` or font family names. For reliable reproducibility, prefer `fontfile` where possible.

If you want, I can:

- Create a small script that writes a short `fonts.json` mapping (family -> path) for your machine and commit it to the repo.
- Add a sample FFmpeg script to the repo that uses bundled fonts (e.g. `assets/fonts/Inter-Regular.ttf`) and shows how to use them in `drawtext`.
  I added a helper script you can run locally to regenerate the fonts mapping: `scripts/generate_ffmpeg_fonts.py`. Run it like this:

```bash
python3 scripts/generate_ffmpeg_fonts.py > docs/ffmpeg-fonts.json
```

--
Generated on: 2025-12-13
