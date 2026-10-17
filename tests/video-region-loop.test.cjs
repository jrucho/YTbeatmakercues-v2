const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { RegionLoop, wrap } = require('../video-region-loop.js');

function fixture() {
  let key = 'youtube:first', now = 0, timerId = 0;
  const video = { duration: 10, currentTime: 0, readyState: 4, paused: true, seeking: false, playbackRate: 1 };
  const saved = {}, timers = new Map(), history = [], seeks = [];
  let loop;
  loop = new RegionLoop({ getVideo: () => video, getVideoId: () => key,
    now: () => now, audioTime: () => now / 1000,
    setInterval: fn => { timers.set(++timerId, fn); return timerId; }, clearInterval: id => timers.delete(id),
    storage: { get: async name => ({ [name]: saved[name] }), set: async value => Object.assign(saved, value) },
    beforeChange: () => history.push(loop.snapshot()),
    seek: target => { seeks.push(target); video.currentTime = target; },
  });
  return { loop, video, history, saved, seeks, timers, setKey: value => key = value,
    advance: ms => now += ms, flush: () => new Promise(resolve => setImmediate(resolve)) };
}

test('IN/OUT validates ordering, activates looping and clear is one undoable edit', async () => {
  const f = fixture();
  f.video.currentTime = 2; f.loop.mark('out'); assert.equal(f.loop.state.out, null);
  assert.match(f.loop.message, /IN first/);
  f.video.currentTime = 1; f.loop.mark('in');
  f.video.currentTime = 1.05; f.loop.mark('out'); assert.equal(f.loop.state.out, null);
  f.video.currentTime = 3; f.loop.mark('out');
  assert.deepEqual(f.loop.state, { in: 1, out: 3, enabled: true });
  assert.equal(f.timers.size, 1); assert.equal(f.seeks.length, 0, 'setting OUT does not start paused playback');
  f.loop.clear(); assert.deepEqual(f.loop.state, { in: null, out: null, enabled: false });
  assert.equal(f.timers.size, 0);
  const before = f.history.length;
  f.loop.restore(f.history.pop());
  assert.deepEqual(f.loop.state, { in: 1, out: 3, enabled: true });
  assert.equal(f.history.length, before - 1, 'restoring history must not push another edit');
  f.loop.erase('in'); assert.deepEqual(f.loop.state, { in: null, out: 3, enabled: false });
  await f.flush(); await f.loop.writes;
  assert.deepEqual(f.saved['ytbm-region-loop:youtube:first'], { in: null, out: 3, enabled: false });
  f.loop.dispose(); assert.equal(f.timers.size, 0);
});

test('native playback repeats at OUT without a model, and paused playback never seeks', () => {
  const f = fixture(); f.loop.change({ in: 1, out: 3, enabled: true });
  f.video.currentTime = 3.01; f.loop.tick(); assert.equal(f.seeks.length, 0);
  f.video.paused = false; f.loop.tick(); assert.deepEqual(f.seeks, [1]);
  f.advance(2000); f.video.currentTime = 2.99; f.loop.tick(); assert.equal(f.seeks.length, 1);
  f.video.currentTime = 3; f.loop.tick(); assert.deepEqual(f.seeks, [1, 1]);
  f.loop.clear(); f.advance(2000); f.video.currentTime = 4; f.loop.tick(); assert.equal(f.seeks.length, 2);
  f.loop.dispose();
});

test('audio clock wraps exact boundaries and retimes without restarting its phase', () => {
  const f = fixture(); f.loop.change({ in: 1, out: 3, enabled: true });
  f.loop.alignAudioClock(10, 1, 1);
  assert.equal(f.loop.positionAt(12), 1);
  assert.equal(f.loop.positionAt(13), 2);
  f.loop.alignAudioClock(11, 0.5, 2);
  assert.equal(f.loop.positionAt(11), 2); assert.equal(f.loop.positionAt(13), 1);
  assert.ok(Math.abs(wrap(7.25, 1, 3) - 1.25) < 1e-9);
  f.loop.dispose();
});

test('manual cue outside the region keeps looping until explicitly cleared', () => {
  const f = fixture(); f.loop.change({ in: 1, out: 3, enabled: true });
  f.loop.alignAudioClock(0, 1, 1);
  const history = f.history.length;
  f.loop.userSeek(7);
  assert.deepEqual(f.loop.state, { in: 1, out: 3, enabled: true });
  assert.equal(f.loop.clock, null); assert.equal(f.history.length, history);
  f.video.currentTime = 7; f.video.paused = false; f.loop.tick();
  assert.deepEqual(f.seeks, [1]);
  f.loop.dispose();
});

test('timeline dragging previews without altering playback and commits one history entry', () => {
  const f = fixture(); f.loop.change({ in: 1, out: 3, enabled: true });
  const marker = { setPointerCapture() {}, releasePointerCapture() {} };
  const bar = { getBoundingClientRect: () => ({ left: 0, width: 100 }) };
  const event = x => ({ button: 0, pointerId: 7, clientX: x, preventDefault() {}, stopPropagation() {} });
  const count = f.history.length;
  f.loop.startDrag(event(10), 'in', marker, bar);
  f.loop.moveDrag(event(20)); f.loop.moveDrag(event(25));
  assert.equal(f.loop.state.in, 1); assert.equal(f.loop.preview.in, 2.5);
  f.loop.finishDrag(event(25)); assert.equal(f.loop.state.in, 2.5);
  assert.equal(f.history.length, count + 1);
  f.loop.startDrag(event(25), 'in', marker, bar); f.loop.moveDrag(event(99));
  assert.ok(f.loop.preview.in <= 2.9); f.loop.finishDrag(event(99), true);
  assert.equal(f.loop.state.in, 2.5); assert.equal(f.history.length, count + 1);
  f.loop.dispose();
});

test('late storage replies cannot overwrite a user edit or transplant another video region', async () => {
  let key = 'first'; const replies = [];
  const loop = new RegionLoop({ getVideo: () => ({ duration: 10, paused: true }), getVideoId: () => key,
    storage: { get: name => new Promise(resolve => replies.push({ name, resolve })), set: async () => {} },
    setInterval: () => 1, clearInterval() {} });
  await Promise.resolve();
  key = 'second'; loop.sync(); await Promise.resolve();
  replies[1].resolve({ [replies[1].name]: { in: 2, out: 4, enabled: true } });
  await new Promise(resolve => setImmediate(resolve));
  replies[0].resolve({ [replies[0].name]: { in: 6, out: 8, enabled: true } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loop.key, 'second'); assert.equal(loop.state.in, 2);
  loop.dispose();
});

test('I/O mark on key-down, Cmd-I no longer imports, and U / Cmd-U use the shared history', () => {
  const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8'), calls = [];
  const keys = new Proxy({ undo: 'u' }, { get: (o, key) => o[key] || 'unused' });
  const context = { isShiftKeyDown: false, isTypingInTextField: e => !!e.typing,
    getRegionLoopController: () => ({ keyDown: key => calls.push(key === 'i' ? 'in' : 'out') }),
    importMedia: () => { throw new Error('Import shortcut must be retired'); },
    extensionKeys: keys, instrumentPreset: 0, touchPopup: null,
    undoAction: () => calls.push('undo'), redoAction: () => calls.push('redo') };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function onKeyDown('), source.indexOf('function onKeyUp(')), context);
  const key = (name, more = {}) => context.onKeyDown({ key: name, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...more });
  key('i'); key('o'); key('i', { repeat: true }); key('i', { metaKey: true }); key('i', { typing: true });
  key('u'); key('u', { metaKey: true });
  assert.deepEqual(calls, ['in', 'out', 'undo', 'redo']);
});

test('I+O chord clears the region once and single-key marks use their press position', () => {
  const f = fixture(); f.loop.change({ in: 1, out: 3, enabled: true });
  const count=f.history.length;
  f.video.currentTime=2; f.loop.keyDown('i'); f.loop.keyDown('o');
  assert.deepEqual(f.loop.state,{in:null,out:null,enabled:false});
  assert.equal(f.history.length,count+1,'simultaneous keys must clear without first altering IN');
  f.loop.keyDown('i');f.loop.keyUp('i');f.loop.keyUp('o');
  assert.equal(f.history.length,count+1);
  f.loop.restore(f.history.pop());assert.equal(f.loop.state.in,1);assert.equal(f.loop.state.out,3);
  f.video.currentTime=1.5;f.loop.keyDown('i');f.video.currentTime=2;f.loop.keyUp('i');
  assert.equal(f.loop.state.in,1.5,'key-up flush must use the original press timestamp');
  f.loop.dispose();
});
