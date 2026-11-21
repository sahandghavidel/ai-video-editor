import { NextResponse } from 'next/server';
import {
  importPipelineTemplates,
  parsePipelineTemplate,
  readPipelineTemplates,
  replacePipelineTemplates,
} from '@/lib/pipelineTemplatesStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await readPipelineTemplates());
  } catch (error) {
    console.error('Failed to load shared pipeline templates:', error);
    return NextResponse.json({ error: 'Could not load shared pipeline templates.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!Array.isArray(body?.templates)) {
      return NextResponse.json({ error: 'Provide the browser templates to import.' }, { status: 400 });
    }

    const templates = (body.templates as unknown[]).map(parsePipelineTemplate);
    if (templates.some(template => !template)) {
      return NextResponse.json({ error: 'Could not read the browser templates to import.' }, { status: 400 });
    }

    return NextResponse.json(await importPipelineTemplates(templates.filter(template => template !== null)));
  } catch (error) {
    console.error('Failed to import pipeline templates:', error);
    return NextResponse.json({ error: 'Could not import browser pipeline templates.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (typeof body?.revision !== 'string' || !Array.isArray(body.templates)) {
      return NextResponse.json({ error: 'Provide the saved template revision and templates.' }, { status: 400 });
    }

    const templates = (body.templates as unknown[]).map(parsePipelineTemplate).filter(template => template !== null);
    if (
      templates.length !== body.templates.length ||
      templates.some(template => !template.id) ||
      new Set(templates.map(template => template.id)).size !== templates.length ||
      new Set(templates.map(template => template.name.toLowerCase())).size !== templates.length
    ) {
      return NextResponse.json({ error: 'Each template needs a unique ID and name.' }, { status: 400 });
    }

    const result = await replacePipelineTemplates(body.revision, templates);
    if (result.conflict) {
      return NextResponse.json({
        ...result,
        error: 'Templates changed in another browser. Review the refreshed list and try again.',
      }, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to save shared pipeline templates:', error);
    return NextResponse.json({ error: 'Could not save shared pipeline templates.' }, { status: 500 });
  }
}
