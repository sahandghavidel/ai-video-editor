import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { copyFile, mkdir } from 'fs/promises';
import { constants } from 'fs';
import path from 'path';
import { sanitizeTtsAudioReferenceEntries } from '@/lib/ttsAudioReferencesStore';
import { resolveReferenceAudioPath } from '@/lib/ttsReferenceAudio';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const original = sanitizeTtsAudioReferenceEntries([body?.entry])[0];
    if (!original) return NextResponse.json({ error: 'Provide a valid preset to duplicate' }, { status: 400 });
    const id = `audio-ref-copy-${randomUUID()}`;
    let filename = original.filename;
    if (original.provider === 'omnivoice' || original.provider === 'omnivoice-lora') {
      const source = resolveReferenceAudioPath({ filenameOrPath: filename }).fullPath;
      const directory = path.join(process.cwd(), 'omnivoice-local', 'references');
      const extension = path.extname(source).toLowerCase();
      if (!['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac'].includes(extension)) {
        return NextResponse.json({ error: 'The reference must be an audio file' }, { status: 400 });
      }
      filename = `${id}${extension}`;
      await mkdir(directory, { recursive: true });
      const destination = path.join(directory, filename);
      await copyFile(source, destination, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
      // Absolute path keeps the copy selectable even when a custom reference directory is configured.
      filename = destination;
    }
    return NextResponse.json({ entry: { ...original, id, name: `${original.name} (copy)`, filename,
      isDefault: false, updatedAt: new Date().toISOString() } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not duplicate preset' }, { status: 400 });
  }
}
