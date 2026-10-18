/* eslint @typescript-eslint/no-require-imports: "off" -- Isolated regression harness. */
// Offline checks: no Python models, Baserow, MinIO, or provider API calls.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '../..');
function fixture(mocks = {}, env = {}, globals = {}) {
  const modules = new Map();
  const context = vm.createContext({ Buffer, console: { info() {}, warn() {}, error() {} },
    process: { env, cwd: () => root }, setTimeout, clearTimeout, Promise, Uint8Array, ...globals });
  const load = (relative) => {
    const filename = path.join(root, relative);
    if (modules.has(filename)) return modules.get(filename).exports;
    const loadedModule = { exports: {} }; modules.set(filename, loadedModule);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    const localRequire = (name) => Object.hasOwn(mocks, name) ? mocks[name]
      : name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : require(name);
    vm.runInContext(`(function(require,module,exports){${source}\n})`, context, { filename })(localRequire, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  };
  return { load };
}

test('old English presets stay on English v1; Persian requires an explicit matching binding', () => {
  const api = fixture().load('src/utils/omniVoiceLoraVersions.ts');
  assert.equal(api.resolveOmniVoiceLoraVersion('en', undefined).id, 'approved-v1');
  assert.equal(api.resolveOmniVoiceLoraVersion('fa', 'persian-v1').trainingStep, 3000);
  for (const [language, version] of [['fa', undefined], ['fa', 'approved-v1'], ['en', 'persian-v1'], ['tr', 'persian-v1'], ['fa', '../adapter'], ['en', '']]) {
    assert.equal(api.resolveOmniVoiceLoraVersion(language, version), undefined);
  }
  assert.match(api.validateOmniVoiceLoraPreset({ language: 'fa', loraAdapterVersion: 'persian-v1', referenceText: ' ' }), /transcript/);
});

test('preset normalization retains the binding and never turns an invalid binding into legacy English', () => {
  const api = fixture().load('src/lib/ttsAudioReferencesStore.ts');
  const normalized = api.sanitizeTtsAudioReferenceEntries([
    { id: 'fa', language: 'fa', filename: 'fa-lora-v1.wav', provider: 'omnivoice-lora', loraAdapterVersion: 'persian-v1' },
    { id: 'en', language: 'en', filename: 'nice.wav', provider: 'omnivoice-lora' },
    { id: 'bad', language: 'en', filename: 'bad.wav', provider: 'omnivoice-lora', loraAdapterVersion: 123 },
  ]);
  assert.equal(normalized[0].loraAdapterVersion, 'persian-v1');
  assert.equal(normalized[1].loraAdapterVersion, undefined);
  assert.equal(normalized[2].loraAdapterVersion, 'invalid');
});

test('upload wrapper binds the correct runtime, language, step and timestamp-at-end filename', async () => {
  const jobs = [], uploads = [];
  const wav = Buffer.alloc(44); wav.write('RIFF'); wav.write('WAVE', 8);
  const generate = fixture({
    '@/lib/omniVoiceLoraWorker': { runOmniVoiceLoraJob: async (...args) => {
      jobs.push(args); await require('node:fs/promises').writeFile(args[2].output, wav); return {};
    } },
    'fs': { existsSync: () => false },
    'fs/promises': { ...require('node:fs/promises'), access: async () => {} },
    '@/lib/minio-runtime': { ensureMinioRunning: async () => ({ baseUrl: 'http://minio.test:9000', bucket: 'audio' }) },
    '@/lib/ttsReferenceAudio': { resolveReferenceAudioPath: () => ({ fullPath: '/references/voice.wav' }) },
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
  }, { OMNIVOICE_LORA_ROOT: '/english', OMNIVOICE_PERSIAN_LORA_ROOT: '/persian', OMNIVOICE_PERSIAN_LORA_V2_ROOT: '/persian-v2', OMNIVOICE_PERSIAN_FULL_ROOT: '/persian-full' }, {
    fetch: async (...args) => { uploads.push(args); return { ok: true }; },
  }).load('src/lib/omniVoiceLora.ts').generateOmniVoiceLora;
  for (const [language, version, expectedRoot, step] of [['en', undefined, '/english', 400], ['fa', 'persian-v1', '/persian', 3000], ['fa', 'persian-v2-pass-2', '/persian-v2', 4700], ['fa', 'persian-v2-pass-8', '/persian-v2', 18799], ['fa', 'persian-full-v1', '/persian-full', 2348]]) {
    const result = await generate({ text: 'text', videoId: 1623, sceneId: 227095, preset: {
      id: 'preset', language, loraAdapterVersion: version, referenceText: 'reference', filename: 'voice.wav', deviceMap: 'mps', numStep: 34, speed: 1,
    } });
    assert.equal(result.status, 200);
    const last = jobs.at(-1); assert.equal(last[0], expectedRoot); assert.equal(last[2].language, language);
    assert.equal(last[3], version ?? 'approved-v1');
    assert.match(result.body.filename, new RegExp(`^video_1623_tts_original_${language}_scene_227095_\\d{13}\\.wav$`));
    assert.equal(result.body.generationParams.trainingStep, step);
    assert.equal(result.body.generationParams.modelType, version === 'persian-full-v1' ? 'full-finetune' : 'lora');
  }
  assert.equal(uploads.length, 5);
  const bad = await generate({ text: 'text', preset: { language: 'fa', loraAdapterVersion: 'approved-v1', referenceText: 'ref' } });
  assert.equal(bad.status, 400); assert.equal(uploads.length, 5);
});

function fakeProcesses() {
  let pid = 100;
  const calls = [], children = [], events = [];
  return { calls, children, events, spawn(python, args) {
    const child = new EventEmitter(); child.pid = ++pid; child.exitCode = null; child.signalCode = null;
    child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
    child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {};
    child.stdin = new EventEmitter();
    child.stdin.write = (text, done) => { const job = JSON.parse(text); calls.push(job); done?.(); setImmediate(() => {
      child.stdout.emit('data', JSON.stringify({ id: job.id, ok: true, generation_count: 1, reload_needed: false, pid: child.pid }) + '\n');
    }); };
    child.kill = () => { events.push(`stop-${child.pid}`); setTimeout(() => { child.signalCode = 'SIGTERM'; events.push(`closed-${child.pid}`); child.emit('close', null, 'SIGTERM'); }, 5); return true; };
    events.push(`start-${child.pid}`); children.push({ child, python, args });
    setImmediate(() => child.stdout.emit('data', JSON.stringify({ event: 'ready', adapter_version: args.at(-1), language: args.at(-1).startsWith('persian-') ? 'fa' : 'en' }) + '\n'));
    return child;
  } };
}

test('shared queue waits for old worker close when changing language/version, reuses workers and idles out', async () => {
  const procs = fakeProcesses();
  const api = fixture({ 'child_process': procs, 'fs': { existsSync: () => false } }, { OMNIVOICE_LORA_IDLE_TIMEOUT_MS: '15' }).load('src/lib/omniVoiceLoraWorker.ts');
  const job = { text: 'text', output: '/tmp/out.wav', reference_audio: '/ref.wav', reference_text: 'ref', seed: 173, num_step: 34, speed: 1 };
  const results = await Promise.all([
    api.runOmniVoiceLoraJob('/fa', 'mps', { ...job, language: 'fa' }, 'persian-v1'),
    api.runOmniVoiceLoraJob('/fa', 'mps', { ...job, language: 'fa' }, 'persian-v1'),
    api.runOmniVoiceLoraJob('/en', 'mps', job),
  ]);
  assert.equal(results[0].pid, results[1].pid); assert.notEqual(results[1].pid, results[2].pid);
  assert.equal(procs.children.length, 2);
  assert.ok(procs.events.indexOf('closed-101') < procs.events.indexOf('start-102'));
  assert.equal(procs.calls[0].language, 'fa'); assert.equal(procs.calls[2].language, 'en');
  assert.equal(procs.children[0].args.at(-1), 'persian-v1'); assert.equal(procs.children[1].args.at(-1), 'approved-v1');
  await assert.rejects(api.runOmniVoiceLoraJob('/en', 'mps', { ...job, language: 'fa' }), /does not match/);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(procs.events.includes('closed-102'));
});


test('Farsi digit shapes normalize while other languages and number punctuation stay unchanged', () => {
  const { normalizePersianTtsDigits } = fixture().load('src/utils/persianTtsDigits.ts');
  const mixed = 'سال ۱۴۰۵، ١٢٣ و 45؛ نسخه ۲.۵، ۱۲٫۵٪، ۱٬۰۰۰، ۰۱۲۳۴۵۶۷۸۹ ٠١٢٣٤٥٦٧٨٩';
  const expected = 'سال 1405، 123 و 45؛ نسخه 2.5، 12٫5٪، 1٬000، 0123456789 0123456789';
  assert.equal(normalizePersianTtsDigits(mixed, 'fa'), expected);
  assert.equal(normalizePersianTtsDigits(mixed, ' FA '), expected);
  for (const language of ['en', 'arb', 'ar', 'tr', 'ur', '']) {
    assert.equal(normalizePersianTtsDigits(mixed, language), mixed);
  }
  assert.equal(normalizePersianTtsDigits(expected, 'fa'), expected);
});

test('outbound LoRA normalization follows the selected preset language rather than stale request settings', async () => {
  const presets = ['fa', 'en'].map((language) => ({ id: language, name: language, tags: [],
    filename: `${language}.wav`, enabled: true, provider: 'omnivoice-lora', language }));
  const calls = [];
  const { POST } = fixture({
    '@/lib/omniVoiceLora': { generateOmniVoiceLora: async (input) => { calls.push(input); return { status: 200 }; } },
    '@/lib/ttsAudioReferencesStore': { loadTtsAudioReferencesStore: async () => ({ entries: presets }) },
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
  }, {}, { fetch: async () => ({ ok: true, json: async () => ({ entries: [] }) }) })
    .load('src/app/api/generate-tts-omnivoice/route.ts');
  for (const language of ['fa', 'en']) {
    const body = { text: '۱۲۳ ٤٥٦', sceneId: 1, referenceAudioFilename: `${language}.wav`,
      ttsSettings: { provider: 'omnivoice-lora', omniVoice: { language: language === 'fa' ? 'en' : 'fa' } } };
    const result = await POST({ url: 'http://localhost:9540/api/generate-tts-omnivoice', json: async () => body });
    assert.equal(result.status, 200);
    assert.equal(calls.at(-1).text, language === 'fa' ? 'صد و بیست و سه چهارصد و پنجاه و شش' : '۱۲۳ ٤٥٦');
    assert.equal(body.text, '۱۲۳ ٤٥٦');
  }
});


test('Farsi quantities become spoken words, including percentages, grouping, signs and precise decimals', () => {
  const { normalizePersianTtsNumbers: convert } = fixture().load('src/utils/persianTtsNumbers.ts');
  for (const [input, expected] of [
    ['۱۲۳', 'صد و بیست و سه'], ['١٢٣', 'صد و بیست و سه'], ['0', 'صفر'],
    ['۲۵٪', 'بیست و پنج درصد'], ['25 %', 'بیست و پنج درصد'],
    ['۱۲٫۵٪', 'دوازده ممیز پنج درصد'], ['12.5%', 'دوازده ممیز پنج درصد'],
    ['۱٬۵۰۰', 'هزار و پانصد'], ['1,500', 'هزار و پانصد'],
    ['−۵', 'منفی پنج'], ['-5.25', 'منفی پنج ممیز بیست و پنج'], ['+5', 'مثبت پنج'],
    ['0.05', 'صفر ممیز صفر پنج'], ['12.50', 'دوازده ممیز پنج صفر'],
    ['1000000', 'یک میلیون'], ['قیمت ۱۲۳ تومان است.', 'قیمت صد و بیست و سه تومان است.'],
  ]) assert.equal(convert(input, 'fa'), expected, input);
  const input = 'نسخه 3.8 و version 4.2 و 1.2.3؛ 1405/01/02 و 12:30؛ 09123456789؛ https://example.com/123؛ item123؛ 1,23؛ 9007199254740993';
  assert.equal(convert(input, 'fa'), input);
  for (const language of ['en', 'arb', 'ar', 'tr', 'ur', '']) {
    assert.equal(convert('۱۲۳ و ٢٥٪ و -5.25', language), '۱۲۳ و ٢٥٪ و -5.25');
  }
  assert.equal(convert(convert('۱۲۳ و ۲۵٪', 'fa'), 'fa'), convert('۱۲۳ و ۲۵٪', 'fa'));
});


test('v2 resolves distinct frozen packages without changing v1 roots or allowing cross-language fallback', () => {
  const runtime = fixture({}, { OMNIVOICE_LORA_ROOT: '/english', OMNIVOICE_PERSIAN_LORA_ROOT: '/v1', OMNIVOICE_PERSIAN_LORA_V2_ROOT: '/v2' }).load('src/lib/omniVoiceLoraRuntime.ts');
  assert.equal(runtime.resolveOmniVoiceLoraRuntime('fa', 'persian-v1').adapterPath, '/v1/approved-v1/adapter');
  assert.equal(runtime.resolveOmniVoiceLoraRuntime('en', undefined).adapterPath, '/english/approved-v1/adapter');
  for (const pass of [2, 8]) {
    const bound = runtime.resolveOmniVoiceLoraRuntime('fa', `persian-v2-pass-${pass}`);
    assert.equal(bound.adapterPath, `/v2/application-v2/pass-${pass}/adapter`);
    assert.equal(bound.trainingStep, pass === 2 ? 4700 : 18799);
    assert.throws(() => runtime.resolveOmniVoiceLoraRuntime('en', `persian-v2-pass-${pass}`));
  }
});

test('switching v2 checkpoints within one language/root closes the old worker before loading the next', async () => {
  const procs = fakeProcesses();
  const api = fixture({ child_process: procs, fs: { existsSync: () => false } }, { OMNIVOICE_LORA_IDLE_TIMEOUT_MS: '15' }).load('src/lib/omniVoiceLoraWorker.ts');
  const job = { text: 'متن', output: '/tmp/out.wav', reference_audio: '/ref.wav', reference_text: 'مرجع', language: 'fa', seed: 173, num_step: 34, speed: 1 };
  const results = await Promise.all([
    api.runOmniVoiceLoraJob('/v2', 'mps', job, 'persian-v2-pass-2'),
    api.runOmniVoiceLoraJob('/v2', 'mps', job, 'persian-v2-pass-2'),
    api.runOmniVoiceLoraJob('/v2', 'mps', job, 'persian-v2-pass-8'),
  ]);
  assert.equal(results[0].pid, results[1].pid);
  assert.notEqual(results[1].pid, results[2].pid);
  assert.ok(procs.events.indexOf('closed-101') < procs.events.indexOf('start-102'));
  assert.equal(procs.children[1].args.at(-1), 'persian-v2-pass-8');
  await new Promise((resolve) => setTimeout(resolve, 45));
});


test('full Persian model has an isolated package and switches away from LoRA through the same queue', async () => {
  const runtime = fixture({}, { OMNIVOICE_PERSIAN_FULL_ROOT: '/full' }).load('src/lib/omniVoiceLoraRuntime.ts');
  const bound = runtime.resolveOmniVoiceLoraRuntime('fa', 'persian-full-v1');
  assert.equal(bound.root, '/full'); assert.equal(bound.adapterPath, '/full/application-v1/model');
  assert.equal(bound.modelType, 'full-finetune'); assert.equal(bound.trainingStep, 2348);
  assert.throws(() => runtime.resolveOmniVoiceLoraRuntime('en', 'persian-full-v1'));
  const procs = fakeProcesses();
  const api = fixture({ child_process: procs, fs: { existsSync: () => false } }, { OMNIVOICE_LORA_IDLE_TIMEOUT_MS: '15' }).load('src/lib/omniVoiceLoraWorker.ts');
  const job = { text: 'متن', output: '/tmp/out.wav', reference_audio: '/ref.wav', reference_text: 'مرجع', language: 'fa', seed: 173, num_step: 34, speed: 1 };
  const results = await Promise.all([
    api.runOmniVoiceLoraJob('/v2', 'mps', job, 'persian-v2-pass-2'),
    api.runOmniVoiceLoraJob('/full', 'mps', job, 'persian-full-v1'),
    api.runOmniVoiceLoraJob('/full', 'mps', job, 'persian-full-v1'),
  ]);
  assert.notEqual(results[0].pid, results[1].pid); assert.equal(results[1].pid, results[2].pid);
  assert.ok(procs.events.indexOf('closed-101') < procs.events.indexOf('start-102'));
  assert.equal(procs.children[1].args.at(-1), 'persian-full-v1');
  await new Promise(resolve => setTimeout(resolve, 45));
});
