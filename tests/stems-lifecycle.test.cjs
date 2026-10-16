const test = require('node:test');
const assert = require('node:assert/strict');
const { InferenceHost } = require('../addons/stems/inference-host.js');
const ownership = require('../addons/stems/resource-storage.js');

function hostFixture() {
  const workers = [];
  const host = new InferenceHost(() => {
    const worker = { messages: [], postMessage(msg) { this.messages.push(msg); }, terminate() { this.closed = true; } };
    workers.push(worker); return worker;
  });
  return { host, workers, receive: data => workers.at(-1).onmessage({ data }) };
}
test('tabs share one model and serialize inference; closing one preserves the other', async () => {
  const { host, workers, receive } = hostFixture();
  const a = host.request('tab1', { type: 'init' }), b = host.request('tab2', { type: 'init' });
  assert.equal(workers.length, 1);
  receive({ type: 'ready', ep: 'wasm' }); await Promise.all([a, b]);
  const x = host.request('tab1', { type: 'separate', id: 1, mix: new Float32Array(2) });
  const y = host.request('tab2', { type: 'separate', id: 1, mix: new Float32Array(2) });
  assert.equal(workers[0].messages.length, 2);
  const activeId = workers[0].messages.at(-1).id;
  host.close('tab1'); assert.match((await x).error, /cancelled/);
  receive({ type: 'stems', id: activeId, data: new Float32Array(2) });
  assert.equal(workers[0].messages.length, 3);
  receive({ type: 'stems', id: workers[0].messages.at(-1).id, data: new Float32Array(2) });
  assert.equal((await y).id, 1);
  assert.ok(!workers[0].closed);
  host.close('tab2'); assert.equal(workers[0].closed, true);
});
test('removal during initialization or queued work resolves every request and allows reinitialization', async () => {
  const { host, workers, receive } = hostFixture();
  const first = host.request('tab1', { type: 'init' }); host.clear();
  assert.equal((await first).type, 'error'); assert.equal(workers[0].closed, true);
  const next = host.request('tab1', { type: 'init' }); receive({ type: 'ready' }); await next;
  const a = host.request('tab1', { type: 'separate', id: 1, mix: new Float32Array(2) });
  const b = host.request('tab1', { type: 'separate', id: 2, mix: new Float32Array(2) });
  host.clear(); assert.equal((await a).type, 'error'); assert.equal((await b).type, 'error');
  assert.equal(host.queue.length, 0); assert.equal(host.worker, null); assert.equal(host.clients.size, 0);
});
test('feature ownership does not include saved audio or unrelated models/databases', () => {
  for (const name of ['ytbm-stems', 'ytbm-stems-segments', 'ytbm-stems/models']) assert.equal(ownership.owned(name), true);
  for (const name of ['ytbm-user-audio', 'ytbm-instruments', 'youtube', 'stems', 'ytbm-stemsOtherApp']) assert.equal(ownership.owned(name), false);
});
