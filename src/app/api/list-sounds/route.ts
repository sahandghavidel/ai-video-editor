import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const ALLOWED_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg']);

export async function GET() {
  try {
    const soundsDir = path.join(process.cwd(), 'public', 'sounds');

    let entries: string[] = [];
    try {
      entries = await fs.promises.readdir(soundsDir);
    } catch {
      // If folder doesn't exist, return empty list.
      return NextResponse.json({ sounds: [] });
    }

    const sounds = entries
      .filter((name) => {
        const ext = path.extname(name).toLowerCase();
        return ALLOWED_EXTENSIONS.has(ext);
      })
      .map((name) => ({
        name,
        url: `/sounds/${encodeURIComponent(name)}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ sounds });
  } catch (error) {
    console.error('Error listing sounds:', error);
    return NextResponse.json({ sounds: [] }, { status: 500 });
  }
}
