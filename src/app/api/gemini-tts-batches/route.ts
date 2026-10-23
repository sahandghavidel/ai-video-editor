import { NextRequest, NextResponse } from 'next/server';
import { assertBatchPreset, isTerminal, visibleBatchJobs, publicBatchJob, readBatchJob, saveBatchJob, withBatchLock } from '@/lib/geminiBatchStore';
import { resumeBatchJobs, scheduleBatchJob } from '@/lib/geminiBatchRunner';

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
    const result = await withBatchLock(id, async () => {
      const job = await readBatchJob(id);
      if (job.state !== 'failed') throw new Error('Only failed Batch jobs can be retried');
      await assertBatchPreset(job);
      job.state = job.submissionUnknown ? 'submitting' : job.operation ? 'waiting' : job.scenes.some(scene => !scene.existing && !scene.done && scene.text && !scene.rawFile) ? 'queued' : 'processing';
      if (job.state !== 'waiting' && job.state !== 'submitting') job.operation = undefined;
      job.round = 0; job.mergeAttempts = 0; job.nextAttemptAt = undefined; job.error = undefined;
      // Fresh unique submission names when a user explicitly starts a new recovery cycle.
      for (const scene of job.scenes) { scene.attempts = 0; scene.error = undefined; }
      await saveBatchJob(job); return publicBatchJob(job);
    });
    if (!result) return NextResponse.json({ error: 'Job is busy. Try again shortly.' }, { status: 409 });
    scheduleBatchJob(id); return NextResponse.json({ job: result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to retry Batch job' }, { status: 400 });
  }
}
