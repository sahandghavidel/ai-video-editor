import { getAuthHeader } from '@/lib/baserow-auth';
import type { SvgAsset } from '@/lib/svg-library';

const table = 737;
export async function request(path: string, init: RequestInit = {}) {
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
export function asset(row: Record<string, unknown>): SvgAsset {
  const status = row.Status as { value?: string } | null;
  return { id: Number(row.id), name: String(row.Name || ''), description: String(row.Description || ''), svg: String(row['SVG Code'] || ''), status: status?.value === 'Approved' ? 'Approved' : 'Draft', viewBox: String(row.ViewBox || ''), width: Number(row.Width || 0), height: Number(row.Height || 0), tags: String(row.Tags || ''), usageRules: String(row['Usage Rules'] || '') };
}
export async function listSvgAssets(): Promise<SvgAsset[]> {
  const assets: SvgAsset[] = [];
  for (let page = 1; ; page++) {
    const data = await (await request(`?user_field_names=true&size=200&page=${page}`)).json();
    assets.push(...data.results.map(asset));
    if (!data.next) break;
  }
  return assets;
}
