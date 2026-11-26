'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { VoiceGroup, VoiceTake } from '@/lib/voice-manager';

let active: HTMLAudioElement | null = null;

export function pauseTakePreview() {
  active?.pause();
}

function timestamp(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
}

export default function TakePreview({ group, take }: { group: VoiceGroup; take: VoiceTake }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const audio = ref.current;
    return () => {
      audio?.pause();
      if (active === audio) active = null;
    };
  }, []);
  async function toggle() {
    const audio = ref.current;
    if (!audio) return;
    if (active === audio && !audio.paused) { audio.pause(); return; }
    pauseTakePreview();
    active = audio;
    if (failed) audio.load();
    setFailed(false);
    try { await audio.play(); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setFailed(true); }
  }
  return <span className="inline-flex items-center gap-2">
    <button type="button" onClick={toggle} aria-label={(playing ? 'Pause' : 'Play') + ' ' + take.status.toLowerCase() + ' take for ' + group.narration}
      className={'inline-flex h-8 items-center gap-2 rounded-full border px-2.5 text-xs font-semibold tabular-nums transition-colors focus-visible:outline-blue-600 ' +
        (playing ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:text-blue-700')}>
      {playing ? <Pause aria-hidden size={13} fill="currentColor" /> : <Play aria-hidden size={13} fill="currentColor" />}
      {timestamp(playing ? elapsed : take.duration)}
    </button>
    {failed && <span role="status" className="text-xs text-rose-700">Playback failed. Try again.</span>}
    <audio hidden ref={ref} preload="none" src={'/api/voice-manager?' + new URLSearchParams({ folder: group.folder, take: take.id })}
      onPlaying={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onTimeUpdate={e => setElapsed(e.currentTarget.currentTime)} onError={() => { setPlaying(false); setFailed(true); }} />
  </span>;
}
