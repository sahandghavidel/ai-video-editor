import { access } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { listSoundEffects } from '@/lib/sound-effects-storage';
import { buildSoundEffectsSection } from '@/utils/hyperframes-sound-effects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sounds = await listSoundEffects();
    for (const sound of sounds.filter(item => item.status === 'Approved')) {
      await access(path.join(process.cwd(), 'public', sound.filePath));
    }
    return NextResponse.json({ section: buildSoundEffectsSection(sounds) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load approved Sound Effects Library.' }, { status: 502 });
  }
}
