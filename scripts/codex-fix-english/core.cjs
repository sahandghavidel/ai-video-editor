/* eslint @typescript-eslint/no-require-imports: "off" -- Shared by the standalone Node worker and Next server. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const terminal = state => ['completed', 'failed', 'cancelled', 'interrupted'].includes(state);
const validId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
function videoId(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('videoId must be a positive integer');
  return value;
}
const rootDir = root => path.join(root, '.cache/codex-fix-english');
function jobDir(root, id) {
  if (!validId(id)) throw new Error('Invalid job ID');
  return path.join(rootDir(root), id);
}
async function saveJob(root, job) {
  const dir = jobDir(root, job.id);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  job.updatedAt = new Date().toISOString();
  const temp = path.join(dir, `${randomUUID()}.tmp`);
  await fs.writeFile(temp, JSON.stringify(job), { mode: 0o600 });
  await fs.rename(temp, path.join(dir, 'job.json'));
}
const loadJob = async (root, id) => JSON.parse(await fs.readFile(path.join(jobDir(root, id), 'job.json'), 'utf8'));
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; }
}
function publicJob(job) {
  const { id, videoId, state, phase, createdAt, updatedAt, result, error } = job;
  return { id, videoId, state, phase, createdAt, updatedAt, result, error };
}
async function readJob(root, id) {
  const job = await loadJob(root, id);
  if (!terminal(job.state) && !alive(job.pid) && Date.now() - Date.parse(job.updatedAt) > 30000) {
    // Never restart a worker whose Baserow writes might already have happened.
    job.state = 'interrupted';
    job.error = 'Codex worker stopped. Review the video before starting a new run; partial edits may be saved.';
    await saveJob(root, job);
  }
  return job;
}
async function withVideoGuard(root, idVideo, action) {
  await fs.mkdir(rootDir(root), { recursive: true, mode: 0o700 });
  const guard = path.join(rootDir(root), `video-${idVideo}.guard`);
  let acquired = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await fs.mkdir(guard); acquired = true; break; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  if (!acquired) throw new Error('Video job coordination is busy or interrupted; no new Codex task was started');
  try { return await action(); } finally { await fs.rmdir(guard); }
}
async function startJob(root, input) {
  return withVideoGuard(root, videoId(input), () => startJobLocked(root, input));
}
async function startJobLocked(root, input) {
  const idVideo = videoId(input);
  await fs.mkdir(rootDir(root), { recursive: true, mode: 0o700 });
  const lock = path.join(rootDir(root), `video-${idVideo}.lock`);
  let handle;
  try { handle = await fs.open(lock, 'wx', 0o600); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const previousId = (await fs.readFile(lock, 'utf8')).trim();
    if (!validId(previousId)) throw new Error('Video job is being initialized. Try again shortly.');
    const previous = await readJob(root, previousId);
    if (!terminal(previous.state)) return previous;
    if (previous.state === 'completed') {
      await releaseLockLocked(root, previous);
      return startJobLocked(root, input);
    }
    // Retain failed/uncertain jobs until explicitly acknowledged by cancellation.
    return previous;
  }
  const job = { id: randomUUID(), videoId: idVideo, state: 'queued', phase: 'Starting Codex', createdAt: new Date().toISOString() };
  try {
    await handle.writeFile(job.id);
    await saveJob(root, job);
    const child = spawn(process.execPath, [path.join(root, 'scripts/codex-fix-english/worker.cjs'), job.id], {
      cwd: root, detached: true, stdio: 'ignore', env: process.env,
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    return job;
  } catch {
    job.state = 'failed'; job.error = 'Unable to launch Codex worker';
    await saveJob(root, job);
    return job;
  } finally { await handle.close(); }
}
async function releaseLock(root, job) {
  return withVideoGuard(root, job.videoId, () => releaseLockLocked(root, job));
}
async function releaseLockLocked(root, job) {
  const lock = path.join(rootDir(root), `video-${job.videoId}.lock`);
  try { if ((await fs.readFile(lock, 'utf8')).trim() === job.id) await fs.unlink(lock); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
async function cancelJob(root, id) {
  const job = await readJob(root, id);
  if (!terminal(job.state)) {
    // A file is checked by the worker; never signal an old/reused process ID.
    await fs.writeFile(path.join(jobDir(root, id), 'cancel'), '', { mode: 0o600 });
    return { ...job, phase: 'Cancellation requested' };
  }
  if (alive(job.codexPid)) throw new Error('The Codex process is still running; do not start another job yet');
  await releaseLock(root, job);
  return job;
}
const hash = text => createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
const ENGLISH_REVIEW_PREFIX = '[Codex English]';
function mergeEnglishReviewReason(existing, reason) {
  if (typeof reason !== 'string' || !reason.trim() || /[\r\n]/.test(reason) || reason.trim().startsWith(ENGLISH_REVIEW_PREFIX)) throw new Error('Invalid English review reason');
  const note = `${ENGLISH_REVIEW_PREFIX} ${reason.trim()}`;
  const original = String(existing ?? '');
  const normalize = value => value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (original.split(/\r?\n/).some(line => normalize(line) === normalize(note))) return original;
  return original ? original + (original.endsWith('\n') ? '' : '\n') + note : note;
}
function flagOptionId(value) {
  return value && typeof value === 'object' ? value.id : value;
}
function reviewFields(schema) {
  const flag = schema.find(f => f.id === 7096), reason = schema.find(f => f.id === 7106);
  const trueOption = flag?.select_options?.find(option => option.value === 'true');
  if (!flag || flag.name !== 'Flagged' || flag.type !== 'single_select' || flag.read_only || !Number.isSafeInteger(trueOption?.id) || !reason || reason.name !== 'Mismatch Reason' || reason.type !== 'text' || reason.read_only) throw new Error('Baserow English review flag schema does not match');
  return { flag, trueOption };
}
function validateSchema(schema) {
  reviewFields(schema);
  const sentence = schema.find(f => f.id === 6890), owner = schema.find(f => f.id === 6889);
  if (!sentence || sentence.name !== 'Sentence' || sentence.type !== 'long_text' || sentence.read_only || !owner || owner.name !== 'Videos ID' || owner.type !== 'number') throw new Error('Baserow schema does not match the English-fix skill');
}
function orderKey(value) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match || (match[3] || '').length > 40) throw new Error('Invalid scene order');
  const magnitude = BigInt(match[2]) * 10n ** 40n + BigInt((match[3] || '').padEnd(40, '0'));
  return match[1] ? -magnitude : magnitude;
}
function orderedRows(rows, idVideo) {
  const ids = new Set(), orders = new Set();
  for (const row of rows) {
    const key = orderKey(row.order).toString();
    if (!Number.isSafeInteger(row.id) || row.id <= 0 || Number(row.field_6889) !== idVideo || ids.has(row.id) || orders.has(key)) throw new Error('Scene ownership, membership or order mismatch');
    ids.add(row.id); orders.add(key);
  }
  return [...rows].sort((a, b) => orderKey(a.order) < orderKey(b.order) ? -1 : 1);
}
function verify(before, after, schema, report, idVideo) {
  if (!report || report.videoId !== idVideo || report.status !== 'completed' || report.verified !== true || report.totalScenes !== before.length || !Array.isArray(report.changed) || !Array.isArray(report.flagged) || !Array.isArray(report.issues) || report.issues.some(i => typeof i !== 'string')) throw new Error('Codex did not report a complete verified review');
  before = orderedRows(before, idVideo); after = orderedRows(after, idVideo);
  if (before.length !== after.length) throw new Error('Scene membership changed');
  const changedEmptySceneIds = [];
  for (let i = 0; i < before.length; i++) {
    const a = before[i], b = after[i];
    if (a.id !== b.id || orderKey(a.order) !== orderKey(b.order)) throw new Error('Scene membership or order changed');
    if (String(a.field_6890 ?? '').trim() === '' && a.field_6890 !== b.field_6890) changedEmptySceneIds.push(a.id);
  }
  if (changedEmptySceneIds.length) {
    throw new Error(`Originally empty Sentence changed for scene IDs: ${changedEmptySceneIds.join(', ')}. Pipeline stopped; review these scenes. Saved values were not rolled back`);
  }
  const expected = new Map();
  for (const item of report.changed) {
    if (!Number.isSafeInteger(item.id) || expected.has(item.id) || !/^[a-f0-9]{64}$/.test(item.sentenceHash)) throw new Error('Invalid or duplicate changed-scene report');
    expected.set(item.id, item.sentenceHash);
  }
  const { flag, trueOption } = reviewFields(schema);
  const flagged = new Map();
  for (const item of report.flagged) {
    if (!Number.isSafeInteger(item.id) || flagged.has(item.id)) throw new Error('Invalid or duplicate flagged-scene report');
    // Validate reason format even if the row is absent from the scoped scene set.
    mergeEnglishReviewReason('', item.reason);
    flagged.set(item.id, item.reason);
  }
  const scopedIds = new Set(before.map(row => row.id));
  if ([...flagged.keys()].some(id => !scopedIds.has(id))) throw new Error('Flagged scene does not belong to the video');
  let changes = 0;
  for (let i = 0; i < before.length; i++) {
    const a = before[i], b = after[i];
    if (flagged.has(a.id)) {
      if (String(a.field_6890 ?? '').trim() === '') throw new Error(`Silent scene ${a.id} must not receive an English review flag`);
      const expectedReason = mergeEnglishReviewReason(a.field_7106, flagged.get(a.id));
      const previousOption = flag.select_options.find(option => option.id === flagOptionId(a.field_7096));
      if (previousOption?.value === 'confirmed' && expectedReason === a.field_7106) throw new Error(`Confirmed scene ${a.id} cannot be reopened for the same review reason`);
      if (flagOptionId(b.field_7096) !== trueOption.id || b.field_7106 !== expectedReason) throw new Error(`English review flag or reason was not saved correctly for scene ${a.id}`);
    }
    const changed = a.field_6890 !== b.field_6890;
    if (changed) {
      changes++;
      if (expected.get(a.id) !== hash(b.field_6890)) throw new Error('Saved sentence does not match Codex result');
    } else if (expected.has(a.id)) {
      // Some Codex reports include flag-only row updates in `changed`. Accept
      // only declared, fully verified review rows whose saved sentence hash matches.
      if (!flagged.has(a.id)) throw new Error(`Codex reported a Sentence change that was not saved for scene ${a.id}`);
      if (expected.get(a.id) !== hash(b.field_6890)) throw new Error(`Saved sentence does not match Codex result for flag-only scene ${a.id}`);
      expected.delete(a.id); // Do not count a verified flag-only row as a Sentence edit.
    }
    for (const field of schema) {
      if (field.id === 6890 || (flagged.has(a.id) && [7096, 7106].includes(field.id)) || field.read_only || ['formula', 'lookup', 'rollup', 'count', 'created_on', 'last_modified'].includes(field.type)) continue;
      if (!isDeepStrictEqual(a[`field_${field.id}`], b[`field_${field.id}`])) throw new Error(`Another writable field changed on scene ${a.id}`);
    }
  }
  if (changes !== expected.size) throw new Error('Changed-scene count mismatch');
  return { reviewedScenes: before.length, changedScenes: changes, flaggedScenes: flagged.size, verified: true, issues: report.issues };
}
function assertLocalRequest(request) {
  // This endpoint launches a local account-authenticated process; reject cross-origin browser calls.
  const origin = request.headers.get('origin');
  const url = new URL(request.url);
  if (origin && origin !== url.origin) throw new Error('Cross-origin Codex requests are not allowed');
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new Error('Cross-site Codex requests are not allowed');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Codex jobs are available only through localhost');
}
module.exports = { mergeEnglishReviewReason, terminal, videoId, jobDir, saveJob, loadJob, readJob, startJob, cancelJob, publicJob, releaseLock, hash, validateSchema, orderedRows, verify, assertLocalRequest };
