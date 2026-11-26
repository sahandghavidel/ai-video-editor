'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceTake } from '@/lib/voice-manager';
import { claimTakePreview } from './TakePreview';

export type ReviewTrack = { folder: string; take: VoiceTake };

export function useReviewAudio() {
  const player = useRef<HTMLAudioElement | null>(null);
  const version = useRef(0);
  const current = useRef('');
  const [playing, setPlaying] = useState('');
  const [error, setError] = useState('');
  const stop = useCallback(() => {
    version.current++;
    current.current = '';
    player.current?.pause();
    setPlaying('');
  }, []);
  useEffect(() => () => {
    version.current++;
    player.current?.pause();
    player.current?.removeAttribute('src');
    player.current?.load();
  }, []);
  function play(key: string, tracks: ReviewTrack[], compare = false) {
    if (!tracks.length) return;
    const audio = player.current ??= new Audio();
    if (current.current === key && !audio.paused) { audio.pause(); setPlaying(''); return; }
    const resume = current.current === key && !audio.ended;
    let offset = compare && current.current.startsWith('compare:') ? audio.currentTime : 0;
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
      audio.onended = () => {
        if (version.current !== token) return;
        if (index + 1 < tracks.length) start(index + 1);
        else stop();
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
  return { play, stop, playing, error };
}
