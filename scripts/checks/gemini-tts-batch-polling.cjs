/* eslint @typescript-eslint/no-require-imports: "off" -- Offline React effect harness. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../src/components/GeminiBatchJobs.tsx'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function mount(initialJobs, responses = []) {
  const effects = [], listeners = new Map(), timers = new Map();
  let requests = 0, sequence = 0;
  const loadedModule = { exports: {} };
  const context = vm.createContext({
    module: loadedModule, exports: loadedModule.exports,
    require: id => id === 'react' ? { useState: value => [value, () => {}], useEffect: effect => effects.push(effect) } : { jsx: () => null, jsxs: () => null },
    fetch: async () => { requests++; return { ok: true, json: async () => ({ jobs: responses.shift() || [] }) }; },
    window: { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) },
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(source, context);
  loadedModule.exports.default({ initialJobs: initialJobs.map((job, index) => ({ id: String(index), language: 'tr', videoId: 1, completedScenes: 0, totalScenes: 1, ...job })) });
  const cleanup = effects[0]();
  return { requests: () => requests, timers, cleanup, update: () => listeners.get('gemini-batch-updated')(), tick: async () => {
    const [id, timer] = [...timers][0]; timers.delete(id); timer.callback(); await flush();
  } };
}
test('idle initial load and development remount make zero Batch API requests', async () => {
  for (let i = 0; i < 2; i++) {
    const page = mount([]); await flush(); assert.equal(page.requests(), 0); assert.equal(page.timers.size, 0); page.cleanup();
  }
});
test('completed and failed server records do not start polling', async () => {
  const page = mount([{ state: 'completed' }, { state: 'failed' }]); await flush();
  assert.equal(page.requests(), 0); assert.equal(page.timers.size, 0); page.cleanup();
});
test('server-provided pending job resumes polling and completion stops it', async () => {
  const page = mount([{ state: 'waiting' }], [[{ state: 'processing' }], [{ state: 'completed' }]]); await flush();
  assert.equal(page.requests(), 1); assert.equal(page.timers.size, 1); await page.tick();
  assert.equal(page.requests(), 2); assert.equal(page.timers.size, 0); page.cleanup();
});
test('new Batch event wakes idle polling, and failed job stops it', async () => {
  const page = mount([], [[{ state: 'waiting' }], [{ state: 'failed' }]]); await flush();
  assert.equal(page.requests(), 0); page.update(); await flush(); assert.equal(page.requests(), 1);
  await page.tick(); assert.equal(page.requests(), 2); assert.equal(page.timers.size, 0); page.cleanup();
});
