const test = require('node:test');
const assert = require('node:assert/strict');
const { Cache, planTile } = require('../addons/stems/prepared-stretch.js');

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

test('partial analysis renders the available subsection rather than requiring an unanalysed tile prefix', () => {
  const segments=new Map([[1,{validLength:343980}]]);
  const plan=planTile({segments,trackFrames:30*44100,index:1,rate:.75,priority:7.4*44100});
  assert.equal(plan.from,310905);assert.equal(plan.coreEnd,8*44100);
  assert.equal(plan.readFrom,310905);assert.ok(plan.readEnd<=310905+343980);
  assert.equal(planTile({segments,trackFrames:30*44100,index:0,rate:.75}),null);
  segments.set(0,{validLength:343980});
  const expanded=planTile({segments,trackFrames:30*44100,index:1,rate:.75,priority:7.4*44100});
  assert.equal(expanded.from,4*44100);assert.ok(expanded.readFrom<expanded.from);
});

test('out-of-order islands never fill an unanalysed gap with synthetic audio', () => {
  const segments=new Map([[2,{validLength:343980}],[0,{validLength:343980}]]);
  assert.equal(planTile({segments,trackFrames:30*44100,index:2,rate:1.5}),null);
  const plan=planTile({segments,trackFrames:30*44100,index:3,rate:1.5,priority:14.5*44100});
  assert.equal(plan.from,2*310905);assert.equal(plan.readFrom,2*310905);
  assert.ok(plan.readEnd<=2*310905+343980);
});
