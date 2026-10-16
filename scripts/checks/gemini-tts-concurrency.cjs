/* eslint @typescript-eslint/no-require-imports: "off" -- CommonJS harness for isolated TypeScript modules. */
// Offline regression checks: no Google, Baserow, MinIO, or local model calls.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture(env = {}, globals = {}, mocks = {}) {
  let now = 100000, nextTimer = 0, active = 0, peak = 0;
  const timers = new Map(), calls = [], modules = new Map();
  const wav = Buffer.alloc(44); wav.write('RIFF'); wav.write('WAVE', 8);
  const success = () => ({ ok: true, status: 200, json: async () => ({
    status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'audio', data: wav.toString('base64') }] }],
  }) });
  const quotaError = () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'quota exhausted' } }) });
  const context = vm.createContext({
    Buffer, URLSearchParams, AbortController,
    console: { info() {}, log() {}, warn() {}, error() {} },
    process: { env: { GEMINI_API_KEY: 'offline-test-key', ...env } },
    Date: class extends Date { static now() { return now; } },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout: (id) => timers.delete(id),
    AbortSignal: { timeout: () => undefined },
    fetch: (url, options) => {
      const pending = deferred(); active++; peak = Math.max(peak, active);
      calls.push({ at: now, body: options.body, resolve: (response = success()) => { active--; pending.resolve(response); },
        reject: () => { active--; pending.reject(new Error('network failure')); } });
      return pending.promise;
    },
    ...globals,
  });
  function load(name) {
    const filename = path.resolve(root, name.replace(/^@\//, 'src/')) + (name.endsWith('.ts') ? '' : '.ts');
    if (modules.has(filename)) return modules.get(filename).exports;
    const loadedModule = { exports: {} }; modules.set(filename, loadedModule);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    const compiled = new vm.Script(`(function(require, module, exports) { ${source}\n})`, { filename }).runInContext(context);
    compiled((id) => Object.hasOwn(mocks, id) ? mocks[id] : id.startsWith('@/') ? load(id) : require(id), loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  async function advance(ms) {
    const end = now + ms; await flush();
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, timer] = due; timers.delete(id); now = timer.at; timer.callback(); await flush();
    }
    now = end; await flush();
  }
  return { load, calls, quotaError, advance, context, modules, peak: () => peak, active: () => active, now: () => now };
}
const settings = { voice: 'Charon', style: 'Steady narration' };

test('Gemini permits are global across jobs/reloads and starts are spaced one second apart', async () => {
  const f = fixture({ GEMINI_TTS_MAX_CONCURRENT: '3' });
  const first = f.load('src/lib/geminiTts.ts');
  const jobs = Array.from({ length: 5 }, (_, i) => first.generateGeminiTts(`Scene ${i}`, settings));
  f.modules.delete(path.join(root, 'src/lib/geminiTts.ts'));
  const second = f.load('src/lib/geminiTts.ts');
  jobs.push(second.generateGeminiTts('Other job', settings));
  await flush(); assert.equal(f.calls.length, 1);
  await f.advance(999); assert.equal(f.calls.length, 1);
  await f.advance(1001); assert.equal(f.calls.length, 3); assert.equal(f.peak(), 3);
  await f.advance(10000); assert.equal(f.calls.length, 3, 'fourth request must wait for a permit');
  f.calls[0].resolve(); await flush(); assert.equal(f.calls.length, 4);
  f.calls[1].resolve(); await flush(); await f.advance(1000); assert.equal(f.calls.length, 5);
  f.calls[2].resolve(); await flush(); await f.advance(1000); assert.equal(f.calls.length, 6);
  f.calls.slice(3).forEach(c => c.resolve()); await Promise.all(jobs);
  assert.equal(f.active(), 0); assert.equal(f.peak(), 3);
  assert.ok(f.calls.slice(1).every((c, i) => c.at - f.calls[i].at >= 1000));
});

test('a 429 pauses other starts, extends an already sleeping cooldown, and retries the identical scene', async () => {
  const f = fixture({ GEMINI_TTS_MAX_CONCURRENT: '3' });
  const api = f.load('src/lib/geminiTts.ts');
  const jobs = ['one', 'two', 'three'].map(text => api.generateGeminiTts(text, settings));
  await flush(); await f.advance(1000); assert.equal(f.calls.length, 2);
  f.calls[0].resolve(f.quotaError()); await flush();
  await f.advance(10000); f.calls[1].resolve(f.quotaError()); await flush();
  await f.advance(50000); assert.equal(f.calls.length, 2, 'second 429 extends the first cooldown');
  await f.advance(10000); assert.equal(f.calls.length, 3);
  await f.advance(2000); assert.equal(f.calls.length, 5);
  f.calls.slice(2).forEach(c => c.resolve()); await Promise.all(jobs);
  for (const text of ['one', 'two']) {
    const attempts = f.calls.filter(c => JSON.parse(c.body).input[0].content[0].text === text);
    assert.equal(attempts.length, 2); assert.equal(attempts[0].body, attempts[1].body);
  }
});

test('only two retries are allowed; terminal 429 still pauses the shared queue and releases its permit', async () => {
  const f = fixture({ GEMINI_TTS_MAX_CONCURRENT: '1' });
  const api = f.load('src/lib/geminiTts.ts');
  const failed = assert.rejects(api.generateGeminiTts('fails', settings), /quota exhausted/);
  const next = api.generateGeminiTts('next', settings);
  await flush(); f.calls[0].resolve(f.quotaError()); await flush();
  await f.advance(60000); f.calls[1].resolve(f.quotaError()); await flush();
  await f.advance(60000); f.calls[2].resolve(f.quotaError()); await failed; await flush();
  assert.equal(f.calls.length, 3);
  await f.advance(59999); assert.equal(f.calls.length, 3);
  await f.advance(1); assert.equal(f.calls.length, 4);
  f.calls[3].resolve(); await next;
});

test('network errors release permits without automatically regenerating speech', async () => {
  const f = fixture({ GEMINI_TTS_MAX_CONCURRENT: '1' });
  const api = f.load('src/lib/geminiTts.ts');
  const failed = assert.rejects(api.generateGeminiTts('network', settings), /network failure/);
  const next = api.generateGeminiTts('next', settings);
  await flush(); f.calls[0].reject(); await failed; await f.advance(1000);
  assert.equal(f.calls.length, 2); f.calls[1].resolve(); await next;
});

test('Gemini concurrency is configurable above five; invalid settings use safe defaults', async () => {
  const f = fixture({ GEMINI_TTS_MAX_CONCURRENT: '12', GEMINI_TTS_MIN_INTERVAL_MS: '2000' });
  const limits = f.load('src/lib/geminiTtsLimits.ts');
  assert.equal(limits.getGeminiTtsConcurrency(), 12); assert.equal(limits.getGeminiTtsRequestIntervalMs(), 2000);
  f.context.process.env.GEMINI_TTS_MAX_CONCURRENT = 'NaN';
  f.context.process.env.GEMINI_TTS_MIN_INTERVAL_MS = '0';
  assert.equal(limits.getGeminiTtsConcurrency(), 10); assert.equal(limits.getGeminiTtsRequestIntervalMs(), 1000);
});

for (const provider of ['chatterbox', 'chatterbox-persian', 'omnivoice', 'omnivoice-lora', 'fish-s2-pro']) {
  test(`${provider} scene processing remains sequential and preserves fail-fast`, async () => {
    const batch = fixture({ GEMINI_TTS_MAX_CONCURRENT: '20' }).load('src/lib/sceneTtsBatch.ts');
    const started = [], gates = [deferred(), deferred()]; let stop = false;
    const result = batch.runSceneTtsBatch({ provider, scenes: [0, 1, 2], shouldStop: () => stop,
      processScene: async i => { started.push(i); await gates[i].promise; if (i === 1) stop = true; } });
    await flush(); assert.deepEqual(started, [0]);
    gates[0].resolve(); await flush(); assert.deepEqual(started, [0, 1]);
    gates[1].resolve(); await result; assert.deepEqual(started, [0, 1]);
  });
}

test('Gemini scene pool runs above five, refills automatically, and drains in-flight saves before returning', async () => {
  const batch = fixture({ GEMINI_TTS_MAX_CONCURRENT: '8' }).load('src/lib/sceneTtsBatch.ts');
  const started = [], saved = [], gates = Array.from({ length: 12 }, deferred); let stop = false, finished = false;
  const result = batch.runSceneTtsBatch({ provider: 'gemini', scenes: Array.from({ length: 12 }, (_, i) => i),
    shouldStop: () => stop, processScene: async i => {
      started.push(i); await gates[i].promise;
      if (i === 2) stop = true; else saved.push(i);
    } }).then(() => { finished = true; });
  await flush(); assert.equal(started.length, 8);
  gates[0].resolve(); await flush(); assert.equal(started.length, 9);
  gates[2].resolve(); await flush(); assert.equal(started.length, 9); assert.equal(finished, false);
  for (const i of started) gates[i].resolve(); await result;
  assert.equal(finished, true); assert.equal(saved.length, 8); assert.equal(started.length, 9);
});

test('unexpected scene errors stop scheduling and drain other work before rejection', async () => {
  const batch = fixture({ GEMINI_TTS_MAX_CONCURRENT: '2' }).load('src/lib/sceneTtsBatch.ts');
  const gate = deferred(), started = []; let saved = false;
  const result = batch.runSceneTtsBatch({ provider: 'gemini', scenes: [0, 1, 2], shouldStop: () => false,
    processScene: async i => { started.push(i); if (i === 0) throw new Error('unexpected'); await gate.promise; saved = true; } });
  const failed = assert.rejects(result, /unexpected/);
  await flush(); assert.deepEqual(started, [0, 1]); assert.equal(saved, false);
  gate.resolve(); await failed; assert.equal(saved, true);
});

function sceneRouteFixture(scenes, options = {}) {
  const starts = [], patches = [], gates = new Map();
  const response = (data, status = 200) => ({ ok: status < 400, status,
    json: async () => data, text: async () => JSON.stringify(data) });
  const f = fixture({ GEMINI_TTS_MAX_CONCURRENT: '3', BASEROW_API_URL: 'https://offline-baserow.invalid' }, {
    fetch: async (url, init) => {
      if (init.method === 'GET') return response({ results: scenes, next: null });
      if (init.method === 'PATCH') {
        const id = Number(new URL(url).pathname.split('/').filter(Boolean).at(-1));
        const patch = JSON.parse(init.body); patches.push({ id, patch });
        if (id === options.saveFailure && patch.field_7117) return response({ error: 'save failed' }, 400);
        return response({});
      }
      const payload = JSON.parse(init.body); starts.push({ path: new URL(url).pathname, payload });
      if (payload.sceneId === options.providerFailure) return response({ error: 'quota exhausted' }, 429);
      const gate = deferred(); gates.set(payload.sceneId, gate); return gate.promise;
    },
  }, {
    'next/server': { NextResponse: { json: (data, init = {}) => ({ status: init.status || 200, data }) } },
    undici: { Agent: class {} },
    '@/lib/baserow-auth': { getBaserowToken: async () => 'offline-token', buildAuthHeader: () => ({}) },
    '@/utils/ffmpeg-direct': { uploadToMinio: async () => { throw new Error('External uploads prohibited in test'); } },
  });
  const route = f.load('src/app/api/generate-scene-tts-by-field/route.ts');
  const body = { videoId: 1623, provider: options.provider || 'gemini', language: 'fa',
    sourceTextFieldKey: 'field_7110', destinationAudioFieldKey: 'field_7111', originalAudioFieldKey: 'field_7117',
    ttsSettings: { gemini: { voice: 'voice_fq2rgu3usupa', style: 'Steady narration' } },
    failFastOnSaveError: options.failFast !== false,
    ...options.body,
  };
  return { starts, patches, clock: f, run: (overrides = {}) => route.POST({ json: async () => ({ ...body, ...overrides }), nextUrl: { origin: 'https://offline-app.invalid' } }),
    complete: (id) => gates.get(id).resolve(response({ audioUrl: `https://offline-audio.invalid/scene_${id}.wav` })) };
}

test('actual Gemini scene route preserves skips, custom voice, per-scene raw/destination saves and waits for completion', async () => {
  const scenes = [
    { id: 1, order: '1', field_7110: 'first' },
    { id: 2, order: '2', field_7110: 'existing', field_7111: 'https://offline-audio.invalid/existing.wav' },
    { id: 3, order: '3', field_7110: '' },
    { id: 4, order: '4', field_7110: 'fourth' },
    { id: 5, order: '5', field_7110: 'fifth' },
    { id: 6, order: '6', field_7110: 'filtered' },
  ];
  const f = sceneRouteFixture(scenes, { body: { onlySceneIds: [1, 2, 3, 4, 5] } });
  let done = false; const result = f.run().then(r => { done = true; return r; });
  await flush(); assert.deepEqual(f.starts.map(s => s.payload.sceneId), [1, 4, 5]);
  assert.ok(f.starts.every(s => s.path === '/api/generate-tts-gemini' && s.payload.ttsSettings.gemini.voice === 'voice_fq2rgu3usupa'));
  f.complete(5); await flush(); assert.equal(done, false);
  assert.equal(f.patches.filter(p => p.id === 5).length, 2);
  f.complete(1); f.complete(4); const { status, data } = await result;
  assert.equal(status, 200); assert.equal(data.ok, true); assert.equal(data.generatedCount, 3);
  assert.equal(data.originalSavedCount, 3); assert.equal(data.skippedExistingCount, 1);
  assert.equal(data.skippedNoTextCount, 1); assert.equal(data.skippedSceneFilterCount, 1);
  for (const id of [1, 4, 5]) {
    assert.deepEqual(f.patches.filter(p => p.id === id).map(p => Object.keys(p.patch)[0]), ['field_7117', 'field_7111']);
    assert.ok(f.patches.filter(p => p.id === id).every(p => Object.values(p.patch)[0].endsWith(`scene_${id}.wav`)));
  }
});

for (const failure of ['providerFailure', 'saveFailure']) {
  test(`actual Gemini route stops scheduling after ${failure} and saves the in-flight successful scenes`, async () => {
    const f = sceneRouteFixture(Array.from({ length: 8 }, (_, i) => ({ id: i + 1, order: String(i + 1), field_7110: `Scene ${i + 1}` })), { [failure]: 1 });
    const result = f.run(); await flush(); assert.equal(f.starts.length, 3);
    if (failure === 'saveFailure') { f.complete(1); await flush(); }
    assert.equal(f.starts.length, 3); f.complete(2); f.complete(3);
    const { data } = await result;
    assert.equal(data.ok, false); assert.equal(data.abortedSceneId, 1); assert.equal(data.generatedCount, 2);
    assert.equal(data.failureCount, 1); assert.equal(f.starts.length, 3);
    assert.deepEqual(Array.from(data.failedSceneIds), [1]);
    assert.deepEqual(Array.from(data.unfinishedSceneIds), [4, 5, 6, 7, 8]);
    assert.equal(data[ failure === 'providerFailure' ? 'abortedOnProviderFailure' : 'abortedOnSaveFailure' ], true);
    assert.ok([2, 3].every(id => f.patches.some(p => p.id === id && p.patch.field_7111)));
  });
}

test('actual local regeneration route stays sequential with Gemini concurrency configured above one', async () => {
  const f = sceneRouteFixture([1, 2, 3].map(id => ({ id, order: String(id), field_7110: `Scene ${id}` })), { provider: 'omnivoice', body: { skipIfDestinationExists: false } });
  const result = f.run(); await flush(); assert.equal(f.starts.length, 1);
  f.complete(1); await flush(); assert.equal(f.starts.length, 2);
  f.complete(2); await flush(); assert.equal(f.starts.length, 3);
  f.complete(3); const { data } = await result;
  assert.equal(data.ok, true); assert.equal(data.generatedCount, 3);
  assert.ok(f.starts.every(s => s.path === '/api/generate-tts-omnivoice'));
});

test('Gemini recovery waits 60 seconds, retries only failed/unfinished IDs, and drops completed scenes each round', async () => {
  const f = fixture();
  const { runWithGeminiSceneRecovery } = f.load('src/lib/geminiSceneRecovery.ts');
  const calls = [], logs = [];
  const payloads = [
    { ok: false, failedSceneIds: [2, 2], unfinishedSceneIds: [4, 5] },
    { ok: false, failedSceneIds: [4], unfinishedSceneIds: [] },
    { ok: true, failedSceneIds: [] },
  ];
  let done = false;
  const job = runWithGeminiSceneRecovery({ provider: 'gemini',
    send: async ids => { calls.push({ ids, at: f.now() }); return { response: { ok: true }, payload: payloads.shift() }; },
    onRetry: (round, ids) => logs.push({ round, ids }),
  }).then(result => { done = true; return result; });
  await flush(); assert.equal(calls.length, 1);
  await f.advance(59999); assert.equal(calls.length, 1);
  await f.advance(1); assert.deepEqual(Array.from(calls[1].ids), [2, 4, 5]);
  assert.equal(done, false, 'merge must still wait for scene recovery');
  await f.advance(59999); assert.equal(calls.length, 2);
  await f.advance(1); assert.deepEqual(Array.from(calls[2].ids), [4]);
  assert.equal((await job).payload.ok, true); assert.equal(logs.length, 2);
  assert.deepEqual(calls.map(call => call.at), [100000, 160000, 220000]);
});

test('Gemini scene recovery is bounded to two rounds and returns the final actual failures', async () => {
  const f = fixture(); let attempts = 0;
  const { runWithGeminiSceneRecovery } = f.load('src/lib/geminiSceneRecovery.ts');
  const job = runWithGeminiSceneRecovery({ provider: 'gemini',
    send: async () => { attempts++; return { response: { ok: true }, payload: {
      ok: false, failedSceneIds: [7], failures: [{ sceneId: 7, error: 'Google error' }],
    } }; }, onRetry() {},
  });
  await f.advance(120000);
  const result = await job; assert.equal(attempts, 3);
  assert.equal(result.payload.failures[0].error, 'Google error');
});

for (const provider of ['omnivoice', 'omnivoice-lora', 'chatterbox', 'chatterbox-persian', 'fish-s2-pro']) {
  test(`${provider} never enters Gemini scene recovery even with failed IDs`, async () => {
    const f = fixture(); let attempts = 0;
    const result = await f.load('src/lib/geminiSceneRecovery.ts').runWithGeminiSceneRecovery({ provider,
      send: async () => { attempts++; return { response: { ok: true }, payload: { ok: false, failedSceneIds: [7] } }; },
      onRetry() { assert.fail('Local TTS must not enter Gemini recovery'); },
    });
    assert.equal(attempts, 1); assert.equal(result.payload.ok, false);
  });
}

test('Gemini does not guess scene IDs or retry an unidentifiable route error', async () => {
  const f = fixture(); let attempts = 0;
  await f.load('src/lib/geminiSceneRecovery.ts').runWithGeminiSceneRecovery({ provider: 'gemini',
    send: async () => { attempts++; return { response: { ok: false }, payload: null }; },
    onRetry() { assert.fail('No identifiable scenes to retry'); },
  });
  assert.equal(attempts, 1);
});

test('Gemini provider logs scene, stage and nested cause without exposing the API key', async () => {
  const logs = [];
  const f = fixture({}, { console: { error: (...args) => logs.push(args) } }, {
    'next/server': { NextResponse: { json: (data, init = {}) => ({ data, status: init.status || 200 }) } },
    '@/lib/geminiTts': {
      GeminiTtsError: class extends Error {},
      generateGeminiTts: async () => { throw new Error('fetch failed offline-test-key', { cause: Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }) }); },
    },
    '@/utils/ffmpeg-direct': { uploadToMinio: async () => assert.fail('No upload after failure') },
  });
  const result = await f.load('src/app/api/generate-tts-gemini/route.ts').POST({ json: async () => ({ text: 'test', sceneId: 7, videoId: 10 }) });
  const log = JSON.parse(logs[0][1]);
  assert.equal(result.status, 500); assert.equal(log.sceneId, 7); assert.equal(log.videoId, 10);
  assert.equal(log.stage, 'generate-audio'); assert.match(log.error, /ECONNRESET/);
  assert.ok(!JSON.stringify(logs).includes('offline-test-key')); assert.match(result.data.error, /REDACTED/);
});


test('actual Gemini scene route recovery preserves saved scenes and resumes scenes never attempted', async () => {
  const options = { providerFailure: 1, failFast: false };
  const scenes = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, order: String(i + 1), field_7110: `Scene ${i + 1}` }));
  const f = sceneRouteFixture(scenes, options);
  const { runWithGeminiSceneRecovery } = f.clock.load('src/lib/geminiSceneRecovery.ts');
  const requests = [];
  const job = runWithGeminiSceneRecovery({ provider: 'gemini',
    send: async ids => {
      requests.push(ids);
      const result = await f.run(ids ? { onlySceneIds: ids, skipIfDestinationExists: true } : {});
      return { response: { ok: result.status === 200 }, payload: result.data };
    }, onRetry() { options.providerFailure = undefined; },
  });
  await flush(); f.complete(2); f.complete(3); await flush();
  await f.clock.advance(59999); assert.equal(requests.length, 1);
  await f.clock.advance(1); assert.deepEqual(Array.from(requests[1]), [1, 4, 5, 6, 7, 8]);
  f.complete(1); f.complete(4); f.complete(5); await flush();
  f.complete(6); f.complete(7); f.complete(8);
  assert.equal((await job).payload.ok, true);
  for (const id of [2, 3]) {
    assert.equal(f.starts.filter(call => call.payload.sceneId === id).length, 1);
    assert.equal(f.patches.filter(patch => patch.id === id && patch.patch.field_7111).length, 1);
  }
  assert.ok(scenes.every(scene => f.patches.some(patch => patch.id === scene.id && patch.patch.field_7111)));
});
