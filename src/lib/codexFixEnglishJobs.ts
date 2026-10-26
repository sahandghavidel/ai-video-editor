import core from '../../scripts/codex-fix-english/core.cjs';

export type CodexFixEnglishJob = {
  id: string;
  videoId: number;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  phase: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  result?: { reviewedScenes: number; changedScenes: number; flaggedScenes?: number; verified: boolean; issues: string[] };
};
type JobCore = {
  assertLocalRequest(request: Request): void;
  publicJob(job: CodexFixEnglishJob): CodexFixEnglishJob;
  startJob(root: string, videoId: unknown): Promise<CodexFixEnglishJob>;
  readJob(root: string, id: string): Promise<CodexFixEnglishJob>;
  cancelJob(root: string, id: string): Promise<CodexFixEnglishJob>;
};
// A static CommonJS import lets Next bundle the shared job helpers. The worker
// itself is still launched as a separate Node process by those helpers.
export const codexFixEnglishJobs = core as JobCore;
