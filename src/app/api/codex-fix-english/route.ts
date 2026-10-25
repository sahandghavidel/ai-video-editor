import { NextRequest, NextResponse } from 'next/server';
import { codexFixEnglishJobs as jobs } from '@/lib/codexFixEnglishJobs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try { jobs.assertLocalRequest(request); } catch {
    return NextResponse.json({ error: 'Codex jobs require a same-origin localhost request' }, { status: 403 });
  }
  try {
    const body = await request.json();
    if (!body || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'videoId')) {
      return NextResponse.json({ error: 'Submit only { videoId }' }, { status: 400 });
    }
    const job = await jobs.startJob(process.cwd(), body.videoId);
    return NextResponse.json({ jobId: job.id, job: jobs.publicJob(job) }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to start Codex job' }, { status: 400 });
  }
}
