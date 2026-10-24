import { NextRequest, NextResponse } from 'next/server';
import { isTerminal, visibleBatchJobs, publicBatchJob, readBatchJob } from '@/lib/geminiBatchStore';
import { resumeBatchJobs, scheduleBatchJob, retryFailedBatchJob } from '@/lib/geminiBatchRunner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (id) {
      const job = await readBatchJob(id);
      if (!isTerminal(job)) scheduleBatchJob(id);
      return NextResponse.json({ job: publicBatchJob(job) });
    }
    await resumeBatchJobs();
    return NextResponse.json({ jobs: await visibleBatchJobs() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to read Batch job' }, { status: 400 });
  }
}
export async function POST(request: NextRequest) {
  try {
    const { id } = await request.json();
    const job = await retryFailedBatchJob(id);
    return NextResponse.json({ job: publicBatchJob(job) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to retry Batch job' }, { status: 400 });
  }
}
