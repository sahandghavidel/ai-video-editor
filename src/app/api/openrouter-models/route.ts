import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
    });
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return new Response(JSON.stringify(json), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      return new Response(text, {
        status: res.status,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
