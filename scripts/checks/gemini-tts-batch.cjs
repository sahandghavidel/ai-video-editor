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
  const calls = { creates: [], statuses: [], imports: [], merges: [], uploads: [], saves: 0, active: 0, peak: 0 };
  let operation;
  const store = {
    assertBatchPreset: async () => {}, assertBatchScene: (_job, scene, row) => { if (row.text !== scene.text) throw new Error('stale scene'); },
    batchJobDirectory: () => directory, fetchBatchScenes: async () => job.scenes.map(scene => ({ id: scene.id, text: scene.text })),
    isTerminal: j => ['completed', 'failed'].includes(j.state), listBatchJobs: async () => [job], readBatchJob: async () => job,
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
      calls.imports.push(body); calls.active++; calls.peak = Math.max(calls.peak, calls.active); await new Promise(resolve => setTimeout(resolve, 1)); calls.active--;
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
  assert.ok(f.calls.peak <= 2); assert.equal(f.calls.merges.length, 1);
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
