#!/usr/bin/env python3
"""
Simple script that runs `fc-list` to generate a JSON mapping of font family to a sample file path recognized by fontconfig.
Run: python3 scripts/generate_ffmpeg_fonts.py > docs/ffmpeg-fonts.json
"""
import json
import subprocess
import sys

families_to_check = [
    "Arial","Helvetica","Helvetica Neue","Menlo","Monaco","Courier","Courier New",
    "Times","Times New Roman","Avenir","Avenir Next","Palatino","Optima","New York",
    "SF Compact","SF NS","Noto Sans","Noto Serif","Arial Unicode MS"
]

def main():
    try:
        proc = subprocess.run(["fc-list","-f","%{file}|%{family}\n"], capture_output=True, text=True, check=True)
        lines = proc.stdout.splitlines()
    except Exception as e:
        print("fc-list failed:", e, file=sys.stderr)
        sys.exit(1)

    mapping = {}
    for f in families_to_check:
        mapped = None
        for l in lines:
            if '|' not in l:
                continue
            file, family = l.split('|',1)
            if f.lower() in family.lower() or f.lower() in file.lower():
                mapped = file
                break
        mapping[f] = mapped

    # Add a check for user-installed fonts where possible
    # Add the user's local fonts directory as well
    mapping['user_fonts_dir'] = '/Users/sahand/Library/Fonts'

    print(json.dumps(mapping, indent=2))

if __name__ == '__main__':
    main()
