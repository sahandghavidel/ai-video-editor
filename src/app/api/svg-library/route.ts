import { NextRequest, NextResponse } from 'next/server';
import { getAuthHeader } from '@/lib/baserow-auth';
import { validateSvg, type SvgAsset } from '@/lib/svg-library';

export const runtime = 'nodejs';
const table = 737;
async function request(path: string, init: RequestInit = {}) {
  const base = process.env.BASEROW_API_URL;
  if (!base) throw new Error('Baserow is not configured.');
  const run = async (refresh = false) => fetch(`${base}/database/rows/table/${table}/${path}`, {
    ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...await getAuthHeader(refresh) },
  });
  let response = await run();
  if (response.status === 401) response = await run(true);
  if (!response.ok) throw new Error(`SVG Library storage request failed (${response.status}).`);
  return response;
}
function asset(row: Record<string, unknown>): SvgAsset {
  const status = row.Status as { value?: string } | null;
  return { id: Number(row.id), name: String(row.Name || ''), description: String(row.Description || ''), svg: String(row['SVG Code'] || ''), status: status?.value === 'Approved' ? 'Approved' : 'Draft', viewBox: String(row.ViewBox || ''), width: Number(row.Width || 0), height: Number(row.Height || 0), tags: String(row.Tags || ''), usageRules: String(row['Usage Rules'] || '') };
}
export async function GET() {
  try {
    const assets: SvgAsset[] = [];
    for (let page = 1; ; page++) {
      const data = await (await request(`?user_field_names=true&size=200&page=${page}`)).json();
      assets.push(...data.results.map(asset));
      if (!data.next) break;
    }
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
