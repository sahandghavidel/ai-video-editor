"""One request per process; uses only the separate approved OmniVoice environment."""
import argparse
import json
import random
import resource
import threading
from pathlib import Path
import numpy as np
import soundfile as sf
import torch
from omnivoice import OmniVoice
from omnivoice.utils.lora import load_lora_adapter

parser = argparse.ArgumentParser()
parser.add_argument('--job', required=True)
args = parser.parse_args()
job = json.loads(Path(args.job).read_text())
root = Path(job['runtime_root'])
peak = {'driver': 0, 'tensor': 0}
stop_monitor = threading.Event()
def monitor_memory():
    while not stop_monitor.is_set():
        if job['device'] == 'mps':
            peak['driver'] = max(peak['driver'], torch.mps.driver_allocated_memory())
            peak['tensor'] = max(peak['tensor'], torch.mps.current_allocated_memory())
        stop_monitor.wait(0.1)
monitor = threading.Thread(target=monitor_memory, daemon=True)
monitor.start()
model = OmniVoice.from_pretrained(str(root / 'base-model'), device_map=job['device'], dtype=torch.float32)
model = load_lora_adapter(model, str(root / 'approved-v1' / 'adapter'))
prompt = model.create_voice_clone_prompt(job['reference_audio'], ref_text=job['reference_text'], preprocess_prompt=False)
seed = job['seed']
random.seed(seed)
np.random.seed(seed % (2**32))
torch.manual_seed(seed)
if torch.backends.mps.is_available():
    torch.mps.manual_seed(seed)
audio = np.asarray(model.generate(text=job['text'], language='en', voice_clone_prompt=prompt,
    num_step=job['num_step'], speed=job['speed'], denoise=False, postprocess_output=False,
    fade_duration=0.0, pad_duration=0.0, audio_chunk_threshold=1e9)[0]).squeeze()
if audio.size == 0 or not np.isfinite(audio).all() or np.max(np.abs(audio)) == 0:
    raise RuntimeError('LoRA generated invalid or silent audio')
sf.write(job['output'], audio, model.sampling_rate, subtype='PCM_16')
stop_monitor.set()
monitor.join()
print(json.dumps({'sampled_peak_mps_driver_bytes': peak['driver'], 'sampled_peak_mps_tensor_bytes': peak['tensor'], 'duration_seconds': len(audio) / model.sampling_rate,
    'sample_rate': model.sampling_rate, 'max_rss_bytes': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    'mps_driver_bytes': torch.mps.driver_allocated_memory() if job['device'] == 'mps' else 0,
    'mps_tensor_bytes': torch.mps.current_allocated_memory() if job['device'] == 'mps' else 0}), flush=True)
