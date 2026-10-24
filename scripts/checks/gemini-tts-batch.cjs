/* eslint @typescript-eslint/no-require-imports: "off" -- Offline TypeScript module harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function loader(mocks = {}, globals = {}) {
  const cache = new Map();
  const context = vm.createContext({ process: { ...process, env: { GEMINI_API_KEY: 'offline-placeholder' } }, Buffer, console: { info() {}, error() {} }, setTimeout, clearTimeout, URLSearchParams, AbortSignal, ...globals });
  function load(id) {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (!id.startsWith('@/')) return require(id);
    const filename = path.join(root, 'src', id.slice(2) + '.ts');
    if (cache.has(filename)) return cache.get(filename).exports;
    const loadedModule = { exports: {} }; cache.set(filename, loadedModule);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    vm.runInContext(`(function(require,module,exports){${source}\n})`, context, { filename })(load, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return load;
}
const wav = Buffer.alloc(44); wav.write('RIFF'); wav.write('WAVE', 8);
const audio = { candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }] } }] };
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-batch-offline-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const job = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', videoId: 123, language: 'tr', presetId: 'tr', presetSnapshot: 'saved', origin: 'http://offline', state: 'queued', round: 0,
    step2: { sourceTextFieldKey: 'field_1', sceneDurationFieldKey: 'field_2', ttsSettings: { gemini: { voice: 'voice_test', style: 'Natural Turkish', mode: 'batch' } } },
    merge: { requireAudioForDurationScenes: true }, scenes: [1, 2, 3].map(id => ({ id, key: `scene-${id}`, text: id === 3 ? '' : `Sentence ${id}`, duration: 3, inputs: {}, existing: false })) };
  const calls = { creates: [], statuses: [], imports: [], merges: [], uploads: [], saves: 0, active: 0, peak: 0, readyAtImport: [] };
  let operation;
  const store = {
    BatchSceneLookupError: loader({ '@/lib/baserow-auth': {}, '@/lib/ttsAudioReferencesStore': {} })('@/lib/geminiBatchStore').BatchSceneLookupError,
    assertBatchPreset: async () => {}, assertBatchScene: (_job, scene, row) => { if (row.text !== scene.text) throw new Error('stale scene'); },
    batchJobDirectory: () => directory, fetchBatchScenes: async () => job.scenes.map(scene => ({ id: scene.id, text: scene.text })),
    isTerminal: j => ['completed', 'failed', 'cancelled'].includes(j.state), listBatchJobs: async () => [job], readBatchJob: async () => job,
    saveBatchJob: async () => { calls.saves++; }, withBatchLock: async (_id, fn) => fn(),
  };
  const load = loader({
    '@/lib/geminiBatchStore': store,
    '@/utils/ffmpeg-direct': { uploadToMinio: async (file, name) => { calls.uploads.push({ file, name }); return `https://offline/${name}`; } },
  }, { fetch: async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    if (url.includes('batchGenerateContent')) { calls.creates.push(body); return { ok: true, json: async () => ({ name: 'batches/operation1' }) }; }
    if (url.includes('generativelanguage')) { calls.statuses.push(url); return { ok: true, json: async () => operation }; }
    if (url.endsWith('generate-scene-tts-by-field')) {
      calls.readyAtImport.push(job.scenes.filter(scene => scene.rawFile).length);
      calls.imports.push(body); calls.active++; calls.peak = Math.max(calls.peak, calls.active);
      try {
        if (job.scenes.find(scene => scene.id === body.onlySceneIds[0])?.text) await load('@/lib/geminiBatchProcessing').ensureBatchOriginalUploaded(job.id, body.onlySceneIds[0]);
        await new Promise(resolve => setTimeout(resolve, 20));
      } finally { calls.active--; }
      return { ok: true, status: 200, json: async () => ({ ok: true, generatedCount: 1 }) };
    }
    if (url.endsWith('merge-dubbed-audio-by-field')) { calls.merges.push(body); return { ok: true, json: async () => ({ ok: true, finalDubbedAudioUrl: 'https://offline/final.wav' }) }; }
    throw new Error(`Unexpected offline URL: ${url}`);
  } });
  return { job, calls, store, load, advance: load('@/lib/geminiBatchRunner').advanceBatchJob, setOperation: value => { operation = value; } };
}

test('legacy presets remain Standard; explicit Batch survives normalization', () => {
  const { normalizeGeminiTtsSettings } = loader()('@/utils/geminiTtsSettings');
  assert.equal(normalizeGeminiTtsSettings({ voice: 'voice_saved', style: 'Keep me' }).mode, 'standard');
  const settings = normalizeGeminiTtsSettings({ mode: 'batch', voice: 'voice_saved', style: 'Keep me' });
  assert.equal(settings.mode, 'batch'); assert.equal(settings.voice, 'voice_saved'); assert.equal(settings.style, 'Keep me');
});
test('one job preserves scene keys/custom voice/style; excludes completed and silent scenes', async t => {
  const f = fixture(t); f.job.scenes[1].existing = true;
  await f.advance(f.job);
  assert.equal(f.job.state, 'waiting'); assert.equal(f.calls.creates.length, 1);
  const requests = f.calls.creates[0].batch.input_config.requests.requests;
  assert.equal(requests.length, 1); assert.equal(requests[0].metadata.key, 'scene-1');
  assert.equal(requests[0].request.generationConfig.speechConfig.voiceConfig.voice, 'voice_test');
  assert.equal(requests[0].request.contents[0].parts[0].speechMetadata.style, 'Natural Turkish');
});
test('out-of-order results save correct per-scene WAVs, reuse existing fitting, and merge only after all imports', async t => {
  const f = fixture(t); await f.advance(f.job);
  f.setOperation({ done: true, response: { inlinedResponses: { inlinedResponses: [2, 1].map(id => ({ metadata: { key: `scene-${id}` }, response: audio })) } } });
  await f.advance(f.job);
  assert.equal(f.job.state, 'completed'); assert.equal(f.calls.uploads.length, 2); assert.equal(f.calls.imports.length, 3);
  assert.ok(f.calls.peak <= 6); assert.equal(f.calls.merges.length, 1);
  for (const body of f.calls.imports) { assert.equal(body.geminiBatchJobId, f.job.id); assert.equal(body.onlySceneIds.length, 1); assert.equal(body.skipIfDestinationExists, false); }
  assert.equal(f.calls.merges[0].requireAudioForDurationScenes, true);
});
test('missing generation retries after 60 seconds using only missing keys and keeps successful audio', async t => {
  const f = fixture(t); await f.advance(f.job);
  f.setOperation({ done: true, response: { inlinedResponses: { inlinedResponses: [{ metadata: { key: 'scene-2' }, response: audio }] } } });
  await f.advance(f.job);
  assert.equal(f.job.state, 'queued'); assert.equal(f.job.round, 1); assert.ok(f.job.nextAttemptAt >= Date.now() + 59000);
  assert.equal(f.job.scenes[1].rawFile, 'scene-2.wav'); assert.equal(f.calls.merges.length, 0);
  await f.advance(f.job); assert.equal(f.calls.creates.length, 1, 'no early retry');
  f.job.nextAttemptAt = Date.now() - 1; await f.advance(f.job);
  assert.deepEqual(f.calls.creates[1].batch.input_config.requests.requests.map(item => item.metadata.key), ['scene-1']);
});
test('duplicate or foreign result keys block every import', async t => {
  const f = fixture(t); await f.advance(f.job);
  f.setOperation({ done: true, response: { inlinedResponses: { inlinedResponses: [{ metadata: { key: 'wrong-scene' }, response: audio }] } } });
  await assert.rejects(f.advance(f.job), /unknown or duplicate/); assert.equal(f.calls.uploads.length, 0); assert.equal(f.calls.merges.length, 0);
});
test('crashed submission reconciles by display name and never repeats create', async t => {
  const f = fixture(t); f.job.state = 'submitting'; f.job.displayName = 'unique-intent';
  f.setOperation({ batches: [{ name: 'batches/recovered', metadata: { displayName: 'unique-intent' } }] });
  await f.advance(f.job);
  assert.equal(f.job.operation, 'batches/recovered'); assert.equal(f.job.state, 'waiting'); assert.equal(f.calls.creates.length, 0);
});
test('unacknowledged submission remains pending without duplicate paid work', async t => {
  const f = fixture(t); f.job.state = 'submitting'; f.job.displayName = 'unique-intent'; f.setOperation({ batches: [] });
  await f.advance(f.job); assert.equal(f.job.state, 'submitting'); assert.equal(f.job.submissionUnknown, true); assert.equal(f.calls.creates.length, 0);
});
test('scene/preset changes prevent import and final merge', async t => {
  const f = fixture(t); f.job.state = 'merging'; f.store.fetchBatchScenes = async () => [{ id: 1, text: 'changed' }, { id: 2 }, { id: 3 }];
  await assert.rejects(f.advance(f.job), /stale scene/); assert.equal(f.calls.merges.length, 0);
});
test('reject truncated WAV and incomplete model output', () => {
  const { decodeBatchAudio } = loader()('@/lib/geminiBatchApi');
  assert.throws(() => decodeBatchAudio({ candidates: [{ finishReason: 'MAX_TOKENS' }] }), /Incomplete/);
  assert.throws(() => decodeBatchAudio({ candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: 'bad' } }] } }] }), /Invalid Batch WAV/);
});

test('failed scene import retries cached raw audio without another Google request', async t => {
  const f = fixture(t); await f.advance(f.job);
  f.setOperation({ done: true, response: { inlinedResponses: { inlinedResponses: [1, 2].map(id => ({ metadata: { key: `scene-${id}` }, response: audio })) } } });
  // Simulate a storage failure before import. Successfully uploaded WAVs must not be regenerated.
  const original = f.load('@/utils/ffmpeg-direct').uploadToMinio;
  let first = true;
  f.load('@/utils/ffmpeg-direct').uploadToMinio = async (...args) => { if (first && args[1].includes('_scene_1_')) { first = false; throw new Error('temporary MinIO failure'); } return original(...args); };
  await f.advance(f.job);
  assert.equal(f.job.state, 'processing'); assert.equal(f.calls.merges.length, 0);
  assert.ok(f.job.scenes[0].rawFile); assert.equal(f.job.scenes[1].done, true);
  f.job.nextAttemptAt = Date.now() - 1; await f.advance(f.job);
  assert.equal(f.job.state, 'completed'); assert.equal(f.calls.creates.length, 1);
  assert.equal(f.calls.imports.filter(body => body.onlySceneIds[0] === 2).length, 1, 'completed scene is preserved');
});
test('generation recovery stops after two rounds and retains successful WAVs', async t => {
  const f = fixture(t); await f.advance(f.job); f.job.round = 2;
  f.setOperation({ done: true, response: { inlinedResponses: { inlinedResponses: [{ metadata: { key: 'scene-1' }, response: audio }] } } });
  await assert.rejects(f.advance(f.job), /after two recovery rounds/);
  assert.equal(f.job.scenes[0].rawFile, 'scene-1.wav'); assert.equal(f.calls.merges.length, 0);
});
test('real manifest store survives reload, validates preset/scene inputs and enforces disk locks', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-batch-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const preset = { id: 'tr', enabled: true, isDefault: true, language: 'tr', provider: 'gemini', gemini: { mode: 'batch', voice: 'voice_test', style: 'Natural' }, baserowFields: {} };
  const mocks = { '@/lib/baserow-auth': {}, '@/lib/ttsAudioReferencesStore': { loadTtsAudioReferencesStore: async () => ({ entries: [preset] }) } };
  const globals = { process: { ...process, cwd: () => directory, env: {} } };
  const store = loader(mocks, globals)('@/lib/geminiBatchStore');
  const row = { id: 1, order: '1', field_1: 'Text', field_2: 3 };
  const scene = { id: 1, key: 'scene-1', text: 'Text', duration: 3, inputs: store.sceneBatchInputs(row), existing: false, rawUrl: 'https://offline/raw.wav' };
  const job = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', state: 'processing', videoId: 123, language: 'tr', presetId: 'tr', presetSnapshot: store.presetBatchSnapshot(preset), scenes: [scene], step2: { provider: 'gemini', language: 'tr', sourceTextFieldKey: 'field_1', sceneDurationFieldKey: 'field_2' } };
  await store.saveBatchJob(job);
  const reloaded = loader(mocks, globals)('@/lib/geminiBatchStore');
  const diskJob = await reloaded.readBatchJob(job.id); assert.equal(diskJob.scenes[0].rawUrl, scene.rawUrl);
  const body = { ...job.step2, videoId: 123 };
  assert.equal(await reloaded.validateBatchImport(job.id, body, row), scene.rawUrl);
  await assert.rejects(reloaded.validateBatchImport(job.id, body, { ...row, field_1: 'Edited' }), /changed since submission/);
  await assert.rejects(reloaded.validateBatchImport(job.id, { ...body, destinationAudioFieldKey: 'field_999' }, row), /configuration mismatch/);
  preset.gemini.voice = 'voice_changed'; await assert.rejects(reloaded.assertBatchPreset(diskJob), /preset changed/);
  let blocked;
  await store.withBatchLock(job.id, async () => { blocked = await reloaded.withBatchLock(job.id, async () => 'wrong worker'); });
  assert.equal(blocked, undefined); assert.equal(await reloaded.withBatchLock(job.id, async () => 'released'), 'released');
  await assert.rejects(store.withBatchLock('../bad', async () => {}), /Invalid Batch lock/);
});


test('pending Google checks skip full Baserow lookups and use a ten-second interval', async t => {
  const f = fixture(t); f.job.state = 'waiting'; f.job.operation = 'batches/pending';
  f.store.fetchBatchScenes = async () => { throw new Error('Polling must not fetch Baserow scenes'); };
  f.setOperation({ done: false, metadata: { state: 'BATCH_STATE_RUNNING' } });
  await f.advance(f.job); assert.equal(f.calls.statuses.length, 1); assert.equal(f.calls.imports.length, 0);
  assert.equal(f.load('@/lib/geminiBatchProcessing').GEMINI_BATCH_POLL_INTERVAL_MS, 10000);
});
test('six processing workers begin importing before all WAVs have been written', async t => {
  const f = fixture(t);
  f.job.scenes = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, key: `scene-${i + 1}`, text: `Sentence ${i + 1}`, duration: 3, inputs: {}, existing: false }));
  await f.advance(f.job);
  f.setOperation({ done: true, response: { inlinedResponses: { inlinedResponses: f.job.scenes.map(scene => ({ metadata: { key: scene.key }, response: audio })) } } });
  await f.advance(f.job);
  assert.equal(f.job.state, 'completed'); assert.ok(f.calls.peak <= 6); assert.ok(f.calls.peak > 2);
  assert.ok(f.calls.readyAtImport[0] < 12, 'first import starts before the final WAV is ready');
  assert.equal(f.calls.imports.length, 12); assert.equal(f.calls.merges.length, 1);
});
test('fitting permits are shared globally and bound simultaneous work to three', async t => {
  const f = fixture(t), processing = f.load('@/lib/geminiBatchProcessing');
  let active = 0, peak = 0;
  await Promise.all(Array.from({ length: 12 }, () => processing.withBatchFitSlot(async () => {
    active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 1)); active--;
  })));
  assert.equal(peak, 3); assert.equal(active, 0);
  await assert.rejects(processing.withBatchFitSlot(async () => { throw new Error('fit failed'); }), /fit failed/);
  assert.equal(await processing.withBatchFitSlot(async () => 'released'), 'released');
});
test('original upload is deduplicated and its checkpoint survives a module reload', async t => {
  const f = fixture(t), scene = f.job.scenes[0];
  f.job.state = 'processing'; scene.rawFile = 'scene-1.wav';
  fs.writeFileSync(path.join(f.store.batchJobDirectory(), scene.rawFile), wav);
  const processing = f.load('@/lib/geminiBatchProcessing');
  const [first, second] = await Promise.all([processing.ensureBatchOriginalUploaded(f.job.id, 1), processing.ensureBatchOriginalUploaded(f.job.id, 1)]);
  assert.equal(first, second); assert.equal(f.calls.uploads.length, 1);
  const reloaded = loader({ '@/lib/geminiBatchStore': f.store, '@/utils/ffmpeg-direct': { uploadToMinio: async () => { throw new Error('must reuse upload'); } } })('@/lib/geminiBatchProcessing');
  assert.equal(await reloaded.ensureBatchOriginalUploaded(f.job.id, 1), first);
  assert.equal(await reloaded.getBatchLocalAudio(f.job.id, 1), path.join(f.store.batchJobDirectory(), scene.rawFile));
  scene.rawFile = '../wrong.wav'; await assert.rejects(reloaded.getBatchLocalAudio(f.job.id, 1), /Invalid Batch WAV path/);
});
test('an interrupted result import resumes the same Google operation without a new submission', async t => {
  const f = fixture(t); f.job.state = 'processing'; f.job.operation = 'batches/existing'; f.job.roundKeys = ['scene-1', 'scene-2'];
  f.job.scenes[0].rawFile = 'scene-1.wav'; fs.writeFileSync(path.join(f.store.batchJobDirectory(), 'scene-1.wav'), wav);
  f.setOperation({ done: true, response: { inlinedResponses: { inlinedResponses: [1, 2].map(id => ({ metadata: { key: `scene-${id}` }, response: audio })) } } });
  await f.advance(f.job); assert.equal(f.job.state, 'completed'); assert.equal(f.calls.creates.length, 0); assert.equal(f.calls.statuses.length, 1);
});
test('targeted scene lookup accepts the live numeric Videos ID field and rejects wrong-video rows', async () => {
  let row = { id: 7, field_6889: '123' }; const urls = [];
  const store = loader({ '@/lib/baserow-auth': { getBaserowToken: async () => 'offline', buildAuthHeader: () => ({}) }, '@/lib/ttsAudioReferencesStore': {} }, {
    process: { ...process, env: { BASEROW_API_URL: 'https://offline' } },
    fetch: async url => { urls.push(url); return { ok: true, json: async () => row }; },
  })('@/lib/geminiBatchStore');
  assert.equal((await store.fetchBatchScene(123, 7)).id, 7); assert.equal(urls[0], 'https://offline/database/rows/table/714/7/');
  row = { id: 7, field_6889: 123 }; assert.equal((await store.fetchBatchScene(123, 7)).id, 7);
  for (const value of ['999', 999, '', null, [{ id: 123 }], '123oops', '123.5']) {
    row = { id: 7, field_6889: value };
    await assert.rejects(store.fetchBatchScene(123, 7), /no longer belongs/);
  }
  row = { id: 8, field_6889: '123' };
  await assert.rejects(store.fetchBatchScene(123, 7), /no longer belongs/);
});


function rerunInput(job) {
  const input = { ...job, scenes: job.scenes.map(({ id, key, text, duration, inputs, existing }) => ({ id, key, text, duration, inputs, existing })) };
  delete input.id; delete input.state; delete input.round;
  return input;
}
async function waitForWorker(job) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (['completed', 'failed', 'cancelled'].includes(job.state)) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Offline worker did not settle');
}
test('Create Dubbed rerun resumes a matching failed job and reuses cached WAVs without Google', async t => {
  const f = fixture(t); f.job.state = 'failed'; f.job.lookupRetryCount = 3;
  for (const scene of f.job.scenes.filter(scene => scene.text)) {
    scene.rawFile = `scene-${scene.id}.wav`; scene.attempts = 3;
    fs.writeFileSync(path.join(f.store.batchJobDirectory(), scene.rawFile), wav);
  }
  const resumed = await f.load('@/lib/geminiBatchRunner').createOrResumeBatchJob(rerunInput(f.job));
  assert.equal(resumed.id, f.job.id); assert.equal(resumed.state, 'processing'); assert.equal(resumed.lookupRetryCount, 0);
  await waitForWorker(f.job);
  assert.equal(f.job.state, 'completed'); assert.equal(f.calls.creates.length, 0); assert.equal(f.calls.imports.length, 3);
});
test('cleared scene destination is refitted from cache on rerun rather than incorrectly skipped', async t => {
  const f = fixture(t); f.job.state = 'failed';
  for (const scene of f.job.scenes) {
    scene.done = true;
    if (scene.text) { scene.rawFile = `scene-${scene.id}.wav`; fs.writeFileSync(path.join(f.store.batchJobDirectory(), scene.rawFile), wav); }
  }
  const resumed = await f.load('@/lib/geminiBatchRunner').createOrResumeBatchJob(rerunInput(f.job));
  assert.ok(resumed.scenes.every(scene => !scene.done)); await waitForWorker(f.job);
  assert.equal(f.job.state, 'completed'); assert.equal(f.calls.creates.length, 0);
});
test('changed text or voice settings never reuse a failed job with stale audio', async t => {
  for (const change of ['text', 'preset']) {
    const f = fixture(t); f.job.state = 'failed'; f.job.scenes[0].rawFile = 'scene-1.wav';
    const input = rerunInput(f.job);
    if (change === 'text') input.scenes[0].text = 'Changed sentence'; else input.presetSnapshot = 'Changed voice';
    const fresh = await f.load('@/lib/geminiBatchRunner').createOrResumeBatchJob(input);
    assert.notEqual(fresh.id, f.job.id); assert.equal(fresh.scenes[0].rawFile, undefined);
    await new Promise(resolve => setTimeout(resolve, 10)); // Fixture keeps the old failed record; no work is submitted.
  }
});
test('temporary Baserow 503 preserves completed Google operation and recovers after 60 seconds', async t => {
  const f = fixture(t); await f.advance(f.job);
  const operationName = f.job.operation;
  f.setOperation({ done: true, response: { inlinedResponses: { inlinedResponses: [1, 2].map(id => ({ metadata: { key: `scene-${id}` }, response: audio })) } } });
  const fetchRows = f.store.fetchBatchScenes;
  f.store.fetchBatchScenes = async () => { throw new f.store.BatchSceneLookupError('Batch scene lookup failed (503)', 503); };
  try { await f.advance(f.job); assert.fail('expected Baserow failure'); }
  catch (error) { await f.load('@/lib/geminiBatchRunner').handleBatchJobError(f.job, error); }
  assert.equal(f.job.state, 'waiting'); assert.equal(f.job.operation, operationName); assert.ok(f.job.nextAttemptAt >= Date.now() + 59000);
  await f.advance(f.job); assert.equal(f.calls.creates.length, 1);
  f.job.nextAttemptAt = Date.now() - 1; f.store.fetchBatchScenes = fetchRows;
  await f.advance(f.job); assert.equal(f.job.state, 'completed'); assert.equal(f.job.lookupRetryCount, 0); assert.equal(f.calls.creates.length, 1);
});
test('Baserow lookup retries are bounded and do not consume Google generation recovery rounds', async t => {
  const f = fixture(t); f.job.state = 'waiting'; f.job.operation = 'batches/existing'; f.job.round = 1;
  const runner = f.load('@/lib/geminiBatchRunner');
  for (let retry = 1; retry <= 3; retry++) {
    await runner.handleBatchJobError(f.job, new f.store.BatchSceneLookupError('Temporary lookup failure', 503));
    assert.equal(f.job.lookupRetryCount, retry); assert.equal(f.job.round, 1); assert.equal(f.job.operation, 'batches/existing');
    assert.equal(f.job.state, retry <= 2 ? 'waiting' : 'failed');
  }
  assert.equal(f.calls.creates.length, 0);
});
test('scene mismatch remains a hard failure instead of being retried as an outage', async t => {
  const f = fixture(t); f.job.state = 'processing';
  await f.load('@/lib/geminiBatchRunner').handleBatchJobError(f.job, new Error('Batch scene changed since submission'));
  assert.equal(f.job.state, 'failed'); assert.equal(f.job.nextAttemptAt, undefined);
});
test('cancelled Google operation becomes terminal with no generation or merge retry', async t => {
  for (const result of [{ done: true, metadata: { state: 'BATCH_STATE_CANCELLED' } }, { done: true, error: { code: 1, message: 'Cancelled' } }]) {
    const f = fixture(t); f.job.state = 'waiting'; f.job.operation = 'batches/cancelled'; f.job.roundKeys = ['scene-1', 'scene-2'];
    f.setOperation(result); await f.advance(f.job);
    assert.equal(f.job.state, 'cancelled'); assert.equal(f.job.nextAttemptAt, undefined); assert.equal(f.job.round, 0);
    assert.equal(f.calls.creates.length, 0); assert.equal(f.calls.imports.length, 0); assert.equal(f.calls.merges.length, 0);
  }
});
test('cancelled jobs stop the client wait and block following languages', async () => {
  const client = loader({}, {
    Response, Event: class {}, window: { dispatchEvent() {} }, setTimeout: callback => { callback(); return 0; },
    fetch: async (_url, init) => init?.method === 'POST'
      ? Response.json({ jobId: 'cancelled' }, { status: 202 })
      : Response.json({ job: { id: 'cancelled', state: 'cancelled', error: 'Cancelled at Google' } }),
  })('@/utils/geminiBatchClient');
  const response = await client.fetchDubbedWithBatch('/api/create-dubbed-fa', { method: 'POST' });
  assert.equal(response.status, 409); assert.equal((await response.json()).stopLanguageBatch, true);
});
test('real Baserow lookup errors carry retryable status while wrong-video validation stays strict', async () => {
  let status = 503;
  const store = loader({ '@/lib/baserow-auth': { getBaserowToken: async () => 'offline', buildAuthHeader: () => ({}) }, '@/lib/ttsAudioReferencesStore': {} }, {
    process: { ...process, env: { BASEROW_API_URL: 'https://offline' } },
    fetch: async () => ({ ok: status === 200, status, json: async () => ({ results: [], next: null }) }),
  })('@/lib/geminiBatchStore');
  await assert.rejects(store.fetchBatchScenes(123), error => error instanceof store.BatchSceneLookupError && error.status === 503 && error.retryable);
  status = 403;
  await assert.rejects(store.fetchBatchScenes(123), error => error instanceof store.BatchSceneLookupError && !error.retryable);
});

test('rerunning a failed job with a known Google operation retrieves that operation without resubmission', async t => {
  const f = fixture(t); f.job.state = 'failed'; f.job.operation = 'batches/already-paid'; f.job.roundKeys = ['scene-1', 'scene-2'];
  f.setOperation({ done: true, response: { inlinedResponses: { inlinedResponses: [1, 2].map(id => ({ metadata: { key: `scene-${id}` }, response: audio })) } } });
  const resumed = await f.load('@/lib/geminiBatchRunner').createOrResumeBatchJob(rerunInput(f.job));
  assert.equal(resumed.id, f.job.id); assert.equal(resumed.state, 'waiting');
  await waitForWorker(f.job);
  assert.equal(f.job.state, 'completed'); assert.equal(f.calls.creates.length, 0); assert.equal(f.calls.statuses.length, 1);
});
test('explicit failed-job retry API helper refuses a cancelled job', async t => {
  const f = fixture(t); f.job.state = 'cancelled'; f.job.operation = 'batches/cancelled';
  await assert.rejects(f.load('@/lib/geminiBatchRunner').retryFailedBatchJob(f.job.id), /Only failed/);
  assert.equal(f.job.state, 'cancelled'); assert.equal(f.calls.creates.length, 0);
});
