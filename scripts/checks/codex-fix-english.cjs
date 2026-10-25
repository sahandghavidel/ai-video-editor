/* eslint @typescript-eslint/no-require-imports: "off" -- Offline fixtures; never starts real Codex or production Baserow. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const core = require('../codex-fix-english/core.cjs');
const repo = path.resolve(__dirname, '../..');
const schema = [
  { id: 6890, name: 'Sentence', type: 'long_text', read_only: false },
  { id: 6889, name: 'Videos ID', type: 'number', read_only: false },
  { id: 6891, name: 'TTS', type: 'text', read_only: false },
  { id: 7105, name: 'Fixed Sentence', type: 'text', read_only: false },
  { id: 9999, name: 'Modified', type: 'last_modified', read_only: true },
];
const rows = () => [
  { id: 9, order: '1.00000000000000000001', field_6889: '1628', field_6890: 'Learn JavaScript.', field_6891: 'keep-audio', field_7105: 'keep-confirmation' },
  { id: 4, order: '1.00000000000000000002', field_6889: '1628', field_6890: '', field_6891: '', field_7105: '' },
];
const report = changed => ({ videoId: 1628, status: 'completed', verified: true, totalScenes: 2, changed, issues: [] });
test('verification accepts exact hashes, fractional order and silent scenes', () => {
  const before = rows(), after = rows(); after[0].field_6890 = 'Learn "JavaScript".';
  assert.deepEqual(core.verify(before, after, schema, report([{ id: 9, sentenceHash: core.hash(after[0].field_6890) }]), 1628), { reviewedScenes: 2, changedScenes: 1, verified: true, issues: [] });
  assert.equal(core.verify(before, before, schema, report([]), 1628).changedScenes, 0);
});
for (const [name, mutate] of [
  ['other writable field', (a, r) => { a[0].field_6891 = ''; return r; }],
  ['membership', (a, r) => { a.pop(); return r; }],
  ['ownership', (a, r) => { a[0].field_6889 = '1627'; return r; }],
  ['order', (a, r) => { a[0].order = '2'; return r; }],
  ['unreported concurrent edit', (a, r) => { a[0].field_6890 = 'User edit'; return r; }],
  ['incomplete report', (a, r) => ({ ...r, status: 'needs_attention' })],
  ['unverified report', (a, r) => ({ ...r, verified: false })],
  ['fabricated change', (a, r) => ({ ...r, changed: [{ id: 9, sentenceHash: core.hash(a[0].field_6890) }] })],
]) test(`verification blocks ${name}`, () => { const before = rows(), after = rows(); const result = mutate(after, report([])); assert.throws(() => core.verify(before, after, schema, result, 1628)); });
test('video ID and local-origin guards reject invalid inputs', () => {
  for (const id of [0, -1, '1628', 1.2, NaN]) assert.throws(() => core.videoId(id));
  core.assertLocalRequest(new Request('http://localhost:9540/api/codex-fix-english', { headers: { origin: 'http://localhost:9540' } }));
  assert.throws(() => core.assertLocalRequest(new Request('http://localhost:9540/api/codex-fix-english', { headers: { origin: 'https://external.example' } })));
  assert.throws(() => core.assertLocalRequest(new Request('http://remote.example/api/codex-fix-english')));
});
const fakeCodex = `#!/usr/bin/env node
const fs=require('node:fs/promises'),crypto=require('node:crypto');
(async()=>{
 const args=process.argv.slice(2);
 if(args[0]==='login'){console.log('Logged in using ChatGPT');return;}
 await fs.writeFile('received-args.json',JSON.stringify(args));
 const mode=await fs.readFile('fixture-mode','utf8');
 if(mode==='wait'){setInterval(()=>{},1000);return;}
 const base=process.env.BASEROW_API_URL;
 const data=await(await fetch(base+'/database/rows/table/714/?filter__field_6889__equal=1628')).json();
 const changed=[];
 if(mode!=='noop'){
   const text='Learn "JavaScript".';
   await fetch(base+'/database/rows/table/714/batch/',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{id:9,field_6890:text,...(mode==='other-field'?{field_6891:''}:{})}]})});
   changed.push({id:9,sentenceHash:crypto.createHash('sha256').update(mode==='bad-hash'?'wrong':text).digest('hex')});
 }
 if(mode==='partial-failure'){process.exitCode=2;return;}
 const result={videoId:1628,status:'completed',verified:true,totalScenes:data.results.length,changed,issues:[]};
 await fs.writeFile(args[args.indexOf('--output-last-message')+1],JSON.stringify(result));
})().catch(()=>{process.exitCode=1;});
`;
async function fixture(mode, fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-english-check-'));
  let current = rows();
  const requests = [];
  const server = http.createServer(async (req, res) => {
    requests.push(req.method + ' ' + req.url);
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/database/fields/')) return res.end(JSON.stringify(schema));
    if (req.method === 'PATCH') {
      let body = ''; for await (const part of req) body += part;
      const { items } = JSON.parse(body);
      for (const item of items) Object.assign(current.find(r => r.id === item.id), item);
      return res.end(JSON.stringify({ items }));
    }
    res.end(JSON.stringify({ results: current, next: null }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  await fs.symlink(path.join(repo, 'scripts/codex-fix-english'), path.join(root, 'scripts/codex-fix-english'));
  const executable = path.join(root, 'fake-codex');
  await fs.writeFile(executable, fakeCodex, { mode: 0o700 });
  await fs.writeFile(path.join(root, 'fixture-mode'), mode);
  await fs.writeFile(path.join(root, 'skill.md'), 'Fixture only');
  const old = { ...process.env };
  process.env.CODEX_EXECUTABLE = executable;
  process.env.CODEX_FIX_ENGLISH_SKILL_PATH = path.join(root, 'skill.md');
  process.env.CODEX_FIX_ENGLISH_TIMEOUT_MS = mode === 'timeout' ? '1000' : '15000';
  process.env.BASEROW_API_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.BASEROW_TABLE_ID = '714';
  process.env.BASEROW_USE_DATABASE_TOKEN = 'true';
  process.env.BASEROW_TOKEN = 'offline-fixture-token';
  if (mode === 'timeout') await fs.writeFile(path.join(root, 'fixture-mode'), 'wait');
  try { await fn({ root, requests, getRows: () => current }); } finally {
    for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key];
    Object.assign(process.env, old);
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
}
async function waitJob(root, id, condition = j => core.terminal(j.state)) {
  for (let i = 0; i < 120; i++) {
    const job = await core.loadJob(root, id);
    if (condition(job)) return job;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Fixture worker did not finish');
}
for (const mode of ['success', 'noop', 'bad-hash', 'other-field', 'partial-failure', 'timeout']) {
  test(`standalone worker: ${mode}`, async () => fixture(mode, async ({ root, requests, getRows }) => {
    const [started, duplicate] = await Promise.all([core.startJob(root, 1628), core.startJob(root, 1628)]);
    assert.equal(duplicate.id, started.id);
    const job = await waitJob(root, started.id);
    if (['success', 'noop'].includes(mode)) {
      assert.equal(job.state, 'completed', job.error);
      assert.equal(job.result.verified, true);
      assert.equal(job.result.changedScenes, mode === 'success' ? 1 : 0);
      assert.equal(getRows()[0].field_6891, 'keep-audio');
      assert.equal(getRows()[0].field_7105, 'keep-confirmation');
    } else {
      assert.equal(job.state, 'failed');
      assert.ok(job.error);
      assert.equal((await core.startJob(root, 1628)).id, started.id, 'uncertain job cannot be blindly restarted');
    }
    const args = JSON.parse(await fs.readFile(path.join(root, 'received-args.json'), 'utf8'));
    assert.match(args.at(-1), /video 1628/);
    assert.ok(!args.at(-1).includes('Learn JavaScript'), 'no narration passed to Codex');
    assert.equal(requests.filter(r => r.startsWith('PATCH')).length, mode === 'noop' || mode === 'timeout' ? 0 : 1);
  }));
}
test('cancellation blocks completion and retains an acknowledged retry boundary', async () => fixture('wait', async ({ root }) => {
  const started = await core.startJob(root, 1628);
  await waitJob(root, started.id, j => Boolean(j.codexPid));
  await core.cancelJob(root, started.id);
  assert.equal((await waitJob(root, started.id)).state, 'cancelled');
  await core.cancelJob(root, started.id);
  await fs.writeFile(path.join(root, 'fixture-mode'), 'noop');
  const retry = await core.startJob(root, 1628);
  assert.notEqual(retry.id, started.id);
  assert.equal((await waitJob(root, retry.id)).state, 'completed');
}));
test('dead workers become interrupted without restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-interrupt-'));
  try {
    const id = randomUUID();
    await core.saveJob(root, { id, videoId: 1628, state: 'running', phase: 'saving', pid: 99999999 });
    const file = path.join(core.jobDir(root, id), 'job.json');
    const job = JSON.parse(await fs.readFile(file, 'utf8')); job.updatedAt = '2000-01-01T00:00:00Z';
    await fs.writeFile(file, JSON.stringify(job));
    assert.equal((await core.readJob(root, id)).state, 'interrupted');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

const vm = require('node:vm');
const ts = require('typescript');
async function clientHarness(responses) {
  const source = ts.transpileModule(await fs.readFile(path.join(repo, 'src/utils/codexFixEnglishClient.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const loaded = { exports: {} }, calls = [], store = new Map();
  const context = vm.createContext({
    module: loaded, exports: loaded.exports, Event: class {},
    localStorage: { setItem: (k, v) => store.set(k, v) }, window: { dispatchEvent: () => {} },
    setTimeout: callback => { queueMicrotask(callback); },
    fetch: async (url, options) => { calls.push({ url, options }); const item = responses.shift(); if (!item) throw new Error('offline'); return { ok: item.ok !== false, json: async () => item.payload }; },
  });
  vm.runInContext(source, context);
  return { client: loaded.exports, calls };
}
const clientJob = (state, result) => ({ id: 'fixture-job', videoId: 1628, state, phase: state, result });
test('browser sends only video ID and waits for verified completion', async () => {
  const { client, calls } = await clientHarness([
    { payload: { jobId: 'fixture-job', job: clientJob('queued') } },
    { payload: { job: clientJob('running') } },
    { payload: { job: clientJob('completed', { verified: true, changedScenes: 1 }) } },
  ]);
  let nextStep = false;
  await client.runCodexFixEnglish(1628, () => {});
  nextStep = true;
  assert.equal(nextStep, true);
  assert.deepEqual(JSON.parse(calls[0].options.body), { videoId: 1628 });
  assert.equal(calls.length, 3);
});
for (const job of [clientJob('failed'), clientJob('cancelled'), clientJob('interrupted'), clientJob('completed', { verified: false }), { ...clientJob('completed', { verified: true }), videoId: 1627 }]) {
  test(`browser blocks ${job.state}/${job.videoId}/${job.result?.verified}`, async () => {
    const { client } = await clientHarness([{ payload: { jobId: 'fixture-job', job } }]);
    let nextStep = false;
    await assert.rejects(async () => { await client.runCodexFixEnglish(1628, () => {}); nextStep = true; });
    assert.equal(nextStep, false);
  });
}
test('browser stops on repeated status failure without declaring completion', async () => {
  const { client, calls } = await clientHarness([{ payload: { jobId: 'fixture-job', job: clientJob('running') } }]);
  await assert.rejects(() => client.runCodexFixEnglish(1628, () => {}), /background job may still be running/);
  assert.equal(calls.length, 16);
});
test('a leftover completed lock starts a fresh review instead of reusing old approval', async () => fixture('noop', async ({ root }) => {
  const id = randomUUID();
  await core.saveJob(root, { id, videoId: 1628, state: 'completed', phase: 'Saved and verified' });
  await fs.writeFile(path.join(root, '.cache/codex-fix-english/video-1628.lock'), id);
  const job = await core.startJob(root, 1628);
  assert.notEqual(job.id, id);
  assert.equal((await waitJob(root, job.id)).state, 'completed');
}));
