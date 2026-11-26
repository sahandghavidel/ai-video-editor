'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceTake } from '@/lib/voice-manager';
import { claimTakePreview } from './TakePreview';

export type ReviewTrack = { folder: string; take: VoiceTake; pauseAfter?: number; onStart?: () => void };

export function useReviewAudio() {
  const player = useRef<HTMLAudioElement | null>(null);
  const version = useRef(0);
  const current = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [heard, setHeard] = useState('');
  const [playing, setPlaying] = useState('');
  const [error, setError] = useState('');
  const stop = useCallback(() => {
    version.current++;
    clearTimeout(timer.current);
    timer.current = undefined;
    current.current = '';
    setHeard('');
    player.current?.pause();
    setPlaying('');
  }, []);
  useEffect(() => () => {
    version.current++;
    player.current?.pause();
    clearTimeout(timer.current);
    player.current?.removeAttribute('src');
    player.current?.load();
  }, []);
  function play(key: string, tracks: ReviewTrack[], compare = false, startAt = 0, onFinish?: () => void) {
    if (!tracks.length) return;
    const audio = player.current ??= new Audio();
    if (timer.current !== undefined) {
      clearTimeout(timer.current); timer.current = undefined;
      if (current.current === key) { stop(); return; }
    }
    if (current.current === key && !audio.paused) { audio.pause(); setPlaying(''); return; }
    const resume = current.current === key && !audio.ended;
    let offset = compare && current.current.startsWith('compare:') ? audio.currentTime : startAt;
    claimTakePreview(audio);
    setError('');
    if (resume) {
      const token = version.current;
      void audio.play().catch(() => {
        if (version.current === token) { stop(); setError('Could not resume playback.'); }
      });
      setPlaying(key);
      return;
    }
    const token = ++version.current;
    current.current = key;
    function failed() {
      if (version.current !== token) return;
      stop(); setError('Could not play this recording.');
    }
    function start(index: number) {
      if (version.current !== token) return;
      const { folder, take } = tracks[index];
      tracks[index].onStart?.();
      setHeard(take.id);
      audio.onended = () => {
        if (version.current !== token) return;
        const next = () => {
          timer.current = undefined;
          if (version.current !== token) return;
          if (index + 1 < tracks.length) start(index + 1);
          else { stop(); onFinish?.(); }
        };
        setHeard('');
        if (tracks[index].pauseAfter) timer.current = setTimeout(next, tracks[index].pauseAfter! * 1000);
        else next();
      };
      audio.onerror = failed;
      audio.onloadedmetadata = () => {
        if (offset > 0) audio.currentTime = Math.min(offset, Math.max(0, audio.duration - 0.05));
        offset = 0;
      };
      audio.src = '/api/voice-manager?' + new URLSearchParams({ folder, take: take.id });
      void audio.play().catch(failed);
      setPlaying(key);
    }
    start(0);
  }
  return { play, stop, playing, heard, error };
}
