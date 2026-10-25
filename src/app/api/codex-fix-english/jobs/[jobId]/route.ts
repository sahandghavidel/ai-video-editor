import { NextRequest, NextResponse } from 'next/server';
import { codexFixEnglishJobs as jobs } from '@/lib/codexFixEnglishJobs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  try { jobs.assertLocalRequest(request); } catch {
    return NextResponse.json({ error: 'Codex jobs require a same-origin localhost request' }, { status: 403 });
  }
  try {
    const { jobId } = await context.params;
    const job = await jobs.readJob(process.cwd(), jobId);
    return NextResponse.json({ job: jobs.publicJob(job) });
  } catch {
    return NextResponse.json({ error: 'Codex job not found or unreadable' }, { status: 404 });
  }
}
