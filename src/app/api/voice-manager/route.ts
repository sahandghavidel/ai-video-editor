import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { POST as synthesize } from '../generate-tts-omnivoice-lora/route';
import { loadTtsAudioReferencesStore } from '@/lib/ttsAudioReferencesStore';
import { listVoiceScripts, saveVoiceScript } from '@/lib/voice-scripts';
import { splitEnglishNarration } from '@/lib/omniVoiceLora';
import { existingSentence, approveVoice, saveVoiceTake, spokenSentence, listVoices, trashTakes, voiceAudio } from '@/lib/voice-manager';

export const maxDuration = 900;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    if (params.has('scripts')) return Response.json(await listVoiceScripts());
    if (params.has('take')) {
      const audio = await voiceAudio(params.get('folder') || '', params.get('take') || '');
      return new Response(new Uint8Array(audio), { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'private, no-store' } });
    }
    return Response.json(await listVoices());
  } catch {
    return Response.json({ error: 'Could not read the local Narration Pilot library or take.' }, { status: 404 });
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if ((origin && new URL(origin).host !== request.headers.get('host')) ||
      !request.headers.get('content-type')?.startsWith('application/json')) return new Response(null, { status: 403 });
  try {
    const { action, folder, ids, id, text, voiceID, title } = await request.json();
    if (action === 'approve') return Response.json({ group: await approveVoice(folder, id) });
    if (action === 'generate' || action === 'prepareSentence' || action === 'addScript') {
      if (typeof text !== 'string' || !spokenSentence(text)) return Response.json({ error: 'Enter a spoken sentence.' }, { status: 400 });
      const { entries } = await loadTtsAudioReferencesStore();
      const preset = entries.find(v => v.id === voiceID && v.enabled && v.provider === 'omnivoice-lora' && v.language === 'en');
      if (!preset) return Response.json({ error: 'Choose an enabled English LoRA voice.' }, { status: 400 });
      if (action === 'addScript') {
        const sentences = await splitEnglishNarration(spokenSentence(text), preset);
        if (!sentences.length) return Response.json({ error: 'Enter a script with spoken narration.' }, { status: 400 });
        return Response.json(await saveVoiceScript(typeof title === 'string' ? title : '', text, voiceID, sentences));
      }
      if (action === 'prepareSentence') {
        const group = await existingSentence(text, voiceID);
        if (group) return Response.json({ group, reused: true });
      }
      const takeID = randomUUID().toUpperCase();
      const result = await synthesize(new NextRequest(request.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: spokenSentence(text), sceneId: 'clipboard-' + takeID, referenceAudioFilename: voiceID }),
      }));
      const generation = await result.json();
      if (!result.ok) return Response.json({ error: generation.error || 'Generation failed.' }, { status: result.status });
      const download = await fetch(generation.audioUrl, { cache: 'no-store' });
      if (!download.ok) throw Error('Could not download the generated WAV.');
      const { name, language, provider, enabled } = preset;
      const group = await saveVoiceTake(text, { id: voiceID, name, language, provider, enabled }, takeID,
        Buffer.from(await download.arrayBuffer()), generation);
      return Response.json({ group, id: takeID });
    }
    if (action) return Response.json({ error: 'Unknown voice action.' }, { status: 400 });
    if (typeof folder !== 'string' || !Array.isArray(ids) || !ids.length || !ids.every(id => typeof id === 'string')) {
      return new Response(null, { status: 400 });
    }
    return Response.json({ moved: await trashTakes(folder, ids) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Voice operation failed. Refresh the library.' }, { status: 409 });
  }
}
