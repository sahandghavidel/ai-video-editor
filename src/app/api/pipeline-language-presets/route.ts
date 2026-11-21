import { NextResponse } from 'next/server';
import {
  manageLanguagePreset,
  parseLanguagePreset,
  readLanguagePresets,
  writeLanguagePresets,
} from '@/lib/pipelineLanguagePresetsStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ presets: await readLanguagePresets() });
  } catch (error) {
    console.error('Failed to read language presets:', error);
    return NextResponse.json({ error: 'Could not load shared language presets.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const action = body?.action;
    if (action === 'duplicate' || action === 'rename' || action === 'delete') {
      const source = parseLanguagePreset(body.source);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!source || (action !== 'delete' && !name)) {
        return NextResponse.json({ error: 'Provide the original preset and a name for the new preset.' }, { status: 400 });
      }
      const result = await manageLanguagePreset(action, source, name);
      return NextResponse.json(result, { status: result.error ? 409 : 200 });
    }
    if (action !== 'create' && action !== 'update' && action !== 'import') {
      return NextResponse.json({ error: 'Invalid language preset action.' }, { status: 400 });
    }
    const values: unknown[] = Array.isArray(body.presets) ? body.presets : [];
    const presets = values.map(parseLanguagePreset);
    if (!values.length || (action !== 'import' && values.length !== 1) || presets.some((preset) => !preset)) {
      return NextResponse.json({ error: 'Provide a preset name and ordered language list.' }, { status: 400 });
    }
    const expected = body.source === undefined ? undefined : parseLanguagePreset(body.source);
    if (expected === null) {
      return NextResponse.json({ error: 'Invalid original preset.' }, { status: 400 });
    }
    const result = await writeLanguagePresets(action, presets.filter((preset) => preset !== null), expected);
    return NextResponse.json(result, { status: result.error ? 409 : 200 });
  } catch (error) {
    console.error('Failed to save language presets:', error);
    return NextResponse.json({ error: 'Could not save shared language presets.' }, { status: 500 });
  }
}
