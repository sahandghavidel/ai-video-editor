import { fetchDubbedWithBatch } from './geminiBatchClient';

export type DubbedBatchItem = {
  videoId: number;
  language: string;
  outcome: 'Dubbed' | 'Previously dubbed' | 'Failed';
  files: string[];
  recovered: number;
  warnings: string[];
  stop: boolean;
};

type LocalFile = { path?: string; status?: 'present' | 'recovered' | 'saved'; warning?: string };
type ItemPayload = {
  error?: string;
  details?: string[];
  stopLanguageBatch?: boolean;
  recoveryOnly?: boolean;
  localSubtitle?: LocalFile;
  localAudio?: LocalFile;
};

export async function runDubbedBatchItem(
  videoId: number, language: string, existing: boolean,
  options: { saveFinalAudioAsWav?: boolean; includeHyperFramesSoundEffects?: boolean },
): Promise<DubbedBatchItem> {
  const result: DubbedBatchItem = {
    videoId, language, outcome: 'Failed', files: [], recovered: 0, warnings: [], stop: false,
  };
  const request = (recoveryMode: 'only' | 'if-existing') =>
    fetchDubbedWithBatch('/api/create-dubbed-fa', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, language, recoveryMode, ...options }),
    });
  try {
    const response = await request(existing ? 'only' : 'if-existing');
    const payload: ItemPayload = await response.json();
    result.stop = payload.stopLanguageBatch === true;
    if (!response.ok) {
      if (payload.localSubtitle?.path) result.files.push(`${payload.localSubtitle.path.split('/').pop()} (${payload.localSubtitle.status || 'saved'})`);
      if (payload.localSubtitle?.warning) result.warnings.push(payload.localSubtitle.warning);
      throw new Error([payload.error || `HTTP ${response.status}`, ...(payload.details ?? []).slice(0, 5)].join(' · '));
    }
    result.outcome = payload.recoveryOnly ? 'Previously dubbed' : 'Dubbed';
    // A reattached Gemini job may predate local copies or lack its original SRT result.
    if (!payload.localSubtitle || !payload.localAudio) {
      const recovery = await request('only');
      if (!recovery.ok) throw new Error(`Local recovery returned HTTP ${recovery.status}`);
      const checked: ItemPayload = await recovery.json();
      payload.localSubtitle ??= checked.localSubtitle;
      payload.localAudio ??= checked.localAudio;
    }
    for (const [label, file] of [['Subtitle', payload.localSubtitle], ['Audio', payload.localAudio]] as const) {
      if (file?.warning || !file?.path) {
        result.warnings.push(file?.warning || `${label}: no local file confirmed`);
      } else {
        if (file.status === 'recovered') result.recovered++;
        result.files.push(`${file.path.split('/').pop()} (${file.status || 'saved'})`);
      }
    }
  } catch (error) {
    result.warnings.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}
