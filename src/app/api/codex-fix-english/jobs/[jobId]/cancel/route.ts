import { NextRequest, NextResponse } from 'next/server';
import { codexFixEnglishJobs as jobs } from '@/lib/codexFixEnglishJobs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  try { jobs.assertLocalRequest(request); } catch {
    return NextResponse.json({ error: 'Codex jobs require a same-origin localhost request' }, { status: 403 });
  }
  try {
    const { jobId } = await context.params;
    return NextResponse.json({ job: jobs.publicJob(await jobs.cancelJob(process.cwd(), jobId)) });
  } catch {
    return NextResponse.json({ error: 'Unable to cancel or acknowledge Codex job' }, { status: 409 });
  }
}
