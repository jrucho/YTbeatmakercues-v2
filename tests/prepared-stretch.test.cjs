const test = require('node:test');
const assert = require('node:assert/strict');
const { Cache } = require('../addons/stems/prepared-stretch.js');

test('prepared rendering serializes work, coalesces duplicate requests and respects the PCM budget', async () => {
  const jobs = [];
  const cache = new Cache(args => new Promise(resolve => jobs.push({ args, resolve })), 64);
  cache.setTarget('speed');
  const first = cache.request('a', 'speed', () => 'a');
  assert.equal(cache.request('a', 'speed', () => 'duplicate'), first);
  const second = cache.request('b', 'speed', () => 'b');
  assert.equal(jobs.length, 1);
  jobs[0].resolve({ channels: [new Float32Array(12)] }); await first;
  assert.equal(jobs.length, 2); assert.equal(cache.bytes, 48);
  jobs[1].resolve({ channels: [new Float32Array(12)] }); await second;
  assert.equal(cache.bytes, 48); assert.equal(cache.get('a'), null); assert.ok(cache.get('b'));
});

test('changing target drops obsolete queued work and cannot publish stale in-flight results', async () => {
  let finish;
  const cache = new Cache(() => new Promise(resolve => finish = resolve));
  cache.setTarget('old');
  const active = cache.request('a', 'old', () => ({}));
  const queued = cache.request('b', 'old', () => { throw new Error('Obsolete render was started'); });
  cache.setTarget('new'); assert.equal(await queued, null);
  finish({ channels: [new Float32Array(8)] }); assert.equal(await active, null);
  assert.equal(cache.bytes, 0); assert.equal(cache.entries.size, 0);
  cache.close(); assert.equal(await cache.request('c', 'new', () => ({})), null);
});

test('the committed speed keeps its lookahead while the next speed is being prepared', async () => {
  const jobs = [];
  const cache = new Cache(() => new Promise(resolve => jobs.push(resolve)));
  cache.setTarget('old');
  const current = cache.request('old-current', 'old', () => ({}));
  const next = cache.request('old-next', 'old', () => ({}));
  cache.setTarget('new', 'old');
  const desired = cache.request('new-current', 'new', () => ({}));
  jobs[0]({ channels: [new Float32Array(8)] }); await current;
  assert.ok(cache.get('old-current'));
  jobs[1]({ channels: [new Float32Array(8)] }); await next;
  assert.ok(cache.get('old-next'));
  jobs[2]({ channels: [new Float32Array(8)] }); await desired;
  assert.ok(cache.get('new-current'));
  cache.close(); assert.equal(cache.bytes, 0);
});
