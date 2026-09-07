import { NextRequest, NextResponse } from 'next/server';
import { request, asset, listSvgAssets } from '@/lib/svg-library-storage';
import { validateSvg } from '@/lib/svg-library';

export const runtime = 'nodejs';
export async function GET() {
  try {
    const assets = await listSvgAssets();
    return NextResponse.json({ assets });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Unable to load SVG Library.' }, { status: 502 }); }
}
export async function POST(req: NextRequest) { return save(req, false); }
export async function PATCH(req: NextRequest) { return save(req, true); }
async function save(req: NextRequest, updating: boolean) {
  let input;
  try {
    const raw = await req.text();
    if (raw.length > 650_000) throw new Error('Asset is too large.');
    input = JSON.parse(raw);
    if (updating && (!Number.isSafeInteger(input.id) || input.id <= 0)) throw new Error('Invalid asset ID.');
    for (const key of ['name', 'description', 'tags', 'usageRules']) if (typeof input[key] !== 'string' || input[key].length > (key === 'name' ? 200 : 10000)) throw new Error(`Invalid ${key}.`);
    if (!input.name.trim()) throw new Error('Name is required.');
    if (!['Draft', 'Approved'].includes(input.status)) throw new Error('Invalid status.');
    const checked = validateSvg(input.svg);
    input = { ...input, ...checked };
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid asset.' }, { status: 400 }); }
  try {
    const body = { Name: input.name.trim(), Description: input.description, 'SVG Code': input.svg, Status: input.status, ViewBox: input.viewBox, Width: input.width.toFixed(6), Height: input.height.toFixed(6), Tags: input.tags, 'Usage Rules': input.usageRules };
    const row = await (await request(`${updating ? `${input.id}/` : ''}?user_field_names=true`, { method: updating ? 'PATCH' : 'POST', body: JSON.stringify(body) })).json();
    return NextResponse.json({ asset: asset(row) });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Unable to save asset.' }, { status: 502 }); }
}
export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid asset ID.' }, { status: 400 });
  try {
    await request(`${id}/`, { method: 'DELETE' });
    return NextResponse.json({ success: true });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Unable to delete asset.' }, { status: 502 }); }
}
