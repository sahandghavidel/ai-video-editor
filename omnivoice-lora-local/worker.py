"""Persistent isolated LoRA worker. JSONL jobs on stdin, results on stdout."""
import argparse
from collections import OrderedDict
import fcntl
import json
import os
from pathlib import Path
import random
import resource
import sys
import threading
import time


def respond(value):
    print(json.dumps(value), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--device', choices=['mps', 'cpu'], required=True)
    args = parser.parse_args()
    root = Path(args.root)
    # Advisory lock releases automatically on process exit, including crashes.
    lock = (root / 'application-worker.lock').open('a+')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise RuntimeError('Another LoRA worker owns this runtime')
    import numpy as np
    import soundfile as sf
    import torch
    from omnivoice import OmniVoice
    from omnivoice.utils.lora import load_lora_adapter
    peak = {'driver': 0, 'tensor': 0}
    stop = threading.Event()

    def monitor_memory():
        while not stop.is_set():
            if args.device == 'mps':
                peak['driver'] = max(peak['driver'], torch.mps.driver_allocated_memory())
                peak['tensor'] = max(peak['tensor'], torch.mps.current_allocated_memory())
            stop.wait(0.1)

    monitor = threading.Thread(target=monitor_memory, daemon=True)
    monitor.start()
    model = OmniVoice.from_pretrained(str(root / 'base-model'), device_map=args.device, dtype=torch.float32)
    model = load_lora_adapter(model, str(root / 'approved-v1' / 'adapter'))
    limit = max(1, int(os.environ.get('OMNIVOICE_LORA_MAX_GENERATIONS_BEFORE_RELOAD', '100')))
    cache_limit = max(1, int(os.environ.get('OMNIVOICE_LORA_PROMPT_CACHE_SIZE', '16')))
    cache = OrderedDict()
    count = 0
    respond({'event': 'ready', 'pid': os.getpid(), 'generation_limit': limit})
    try:
        for line in sys.stdin:
            req = {}
            try:
                req = json.loads(line)
                job_id = req['id']
                reference = Path(req['reference_audio']).resolve()
                stat = reference.stat()
                key = (str(reference), stat.st_size, stat.st_mtime_ns, req['reference_text'], False)
                hit = key in cache
                start = time.perf_counter()
                if hit:
                    prompt = cache[key]
                    cache.move_to_end(key)
                else:
                    prompt = model.create_voice_clone_prompt(str(reference), ref_text=req['reference_text'], preprocess_prompt=False)
                    cache[key] = prompt
                    while len(cache) > cache_limit:
                        cache.popitem(last=False)
                prompt_ms = (time.perf_counter() - start) * 1000
                seed = req['seed']
                random.seed(seed)
                np.random.seed(seed % (2**32))
                torch.manual_seed(seed)
                if torch.backends.mps.is_available():
                    torch.mps.manual_seed(seed)
                start = time.perf_counter()
                audio = np.asarray(model.generate(text=req['text'], language='en', voice_clone_prompt=prompt,
                    num_step=req['num_step'], speed=req['speed'], denoise=False, postprocess_output=False,
                    fade_duration=0.0, pad_duration=0.0, audio_chunk_threshold=1e9)[0]).squeeze()
                generate_ms = (time.perf_counter() - start) * 1000
                if audio.size == 0 or not np.isfinite(audio).all() or np.max(np.abs(audio)) == 0:
                    raise RuntimeError('LoRA generated invalid or silent audio')
                sf.write(req['output'], audio, model.sampling_rate, subtype='PCM_16')
                count += 1
                respond({'id': job_id, 'ok': True, 'pid': os.getpid(), 'generation_count': count,
                    'reload_needed': count >= limit, 'cache_hit': hit, 'prompt_cache_size': len(cache),
                    'prompt_ms': round(prompt_ms, 3), 'generate_ms': round(generate_ms, 3),
                    'duration_seconds': len(audio) / model.sampling_rate, 'sample_rate': model.sampling_rate,
                    'sampled_peak_mps_driver_bytes': peak['driver'], 'sampled_peak_mps_tensor_bytes': peak['tensor'],
                    'mps_driver_bytes': torch.mps.driver_allocated_memory() if args.device == 'mps' else 0,
                    'mps_tensor_bytes': torch.mps.current_allocated_memory() if args.device == 'mps' else 0,
                    'max_rss_bytes': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss})
                if count >= limit:
                    break
            except Exception as exc:
                respond({'id': req.get('id') if isinstance(req, dict) else None, 'ok': False, 'error': str(exc)})
    finally:
        stop.set()
        monitor.join()
        lock.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        respond({'event': 'fatal', 'error': str(exc)})
        sys.exit(1)
