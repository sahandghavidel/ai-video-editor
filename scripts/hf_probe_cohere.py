import os
import traceback
from pathlib import Path
from huggingface_hub import hf_hub_download

# load HF_TOKEN from .env.local safely
p = Path('/Users/sahand/Desktop/projects-test/ultimate-video-editr/.env.local')
if p.exists():
    for raw in p.read_text(encoding='utf-8').splitlines():
        s = raw.strip()
        if not s or s.startswith('#') or '=' not in s:
            continue
        k, v = s.split('=', 1)
        k = k.strip()
        v = v.strip()
        if len(v) >= 2 and ((v[0] == '"' and v[-1] == '"') or (v[0] == "'" and v[-1] == "'")):
            v = v[1:-1]
        if k and (os.getenv(k) is None or not os.getenv(k).strip()):
            os.environ[k] = v

tok = (os.getenv('HF_TOKEN') or os.getenv('HUGGINGFACE_HUB_TOKEN') or '').strip()
print('token_present=', bool(tok))

try:
    path = hf_hub_download(
        repo_id='CohereLabs/cohere-transcribe-03-2026',
        filename='config.json',
        token=tok,
    )
    print('ok=True')
    print('path_exists=', Path(path).exists())
except Exception as e:
    print('ok=False')
    print('exc_type=', type(e).__name__)
    print('exc=', str(e))
    traceback.print_exc()
