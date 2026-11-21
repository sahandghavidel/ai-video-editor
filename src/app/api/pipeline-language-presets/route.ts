import { NextResponse } from 'next/server';
import {
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
    if (action !== 'create' && action !== 'update' && action !== 'import') {
      return NextResponse.json({ error: 'Invalid language preset action.' }, { status: 400 });
    }
    const values: unknown[] = Array.isArray(body.presets) ? body.presets : [];
    const presets = values.map(parseLanguagePreset);
    if (!values.length || (action !== 'import' && values.length !== 1) || presets.some((preset) => !preset)) {
      return NextResponse.json({ error: 'Provide a preset name and ordered language list.' }, { status: 400 });
    }
    const result = await writeLanguagePresets(action, presets.filter((preset) => preset !== null));
    if (action !== 'import' && result.conflicts.length) {
      const error = action === 'create'
        ? 'That preset name is already in use.'
        : 'That preset is no longer available to update.';
      return NextResponse.json({ ...result, error }, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to save language presets:', error);
    return NextResponse.json({ error: 'Could not save shared language presets.' }, { status: 500 });
  }
}
