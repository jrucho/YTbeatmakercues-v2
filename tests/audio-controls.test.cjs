const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../content.js'), 'utf8');

test('Touch Tap BPM accepts first click, takes over MIDI clock, suppresses synthetic clicks and resets stale taps', () => {
  let now = 100;
  const handlers = {};
  const button = { style: {}, addEventListener: (type, handler) => handlers[type] = handler };
  const c = {
    performance: { now: () => now }, tapTimes: [], tapBpmBtn: button,
    sequencerClockSource: 'midi_clock', sequencerBPM: 100,
    localStorage: { setItem() {} }, teardownAbletonLinkSession() {},
    setTimeout() {}, refreshSequencerControls() {},
    clock: { bpm: 100, setBpm(bpm) { this.bpm = bpm; } },
  };
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('  function applySequencerBpm('), source.indexOf('  function toggleStep(')), c);
  vm.runInContext(source.slice(source.indexOf('    const onTapBpm ='), source.indexOf('    controlRow.appendChild(tapBpmBtn)')), c);
  handlers.click();
  assert.equal(c.tapTimes.length, 1, 'first click within 600 ms of page load is accepted');
  assert.equal(c.sequencerClockSource, 'internal');
  now = 600; handlers.click();
  assert.equal(c.clock.bpm, 120);
  now = 1100; handlers.touchstart({ preventDefault() {} });
  now = 1150; handlers.click();
  assert.equal(c.tapTimes.length, 3, 'emulated click did not add an extra tap');
  now = 5000; handlers.click();
  assert.equal(c.tapTimes.length, 1);
  now = 5600; handlers.click();
  assert.equal(c.clock.bpm, 100);
});

function loopFixture() {
  let id = 0;
  const timers = new Map();
  const node = () => ({
    gain: { value: 1, cancelScheduledValues() {}, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; } },
    playbackRate: { setValueAtTime() {} },
    connect() { return this; }, disconnect() { this.disconnected = true; },
    start() {}, stop() { this.stopped = true; },
  });
  const c = {
    audioContext: { currentTime: 0, createGain: node, createBufferSource: node },
    loopSources: [], loopGainNodes: [], loopPlaying: [], loopStartOffsets: [],
    loopSource: null, masterLoopIndex: null, MAX_AUDIO_LOOPS: 2,
    midiLoopPlaying: [], pendingStopTimeouts: [], loopers: { audio: [] },
    clock: { stop() {} },
    setTimeout(fn) { timers.set(++id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('const LOOP_FADE_SECONDS'), source.indexOf('function playLoop(')), c);
  vm.runInContext(source.slice(source.indexOf('function stopAllLoopSources('), source.indexOf('function toggleOverdub(')), c);
  return { c, node, timers };
}

test('rapid loop stop/retrigger releases both retiring sources and gains', () => {
  const { c, node, timers } = loopFixture();
  const first = node(), firstGain = node(), second = node(), secondGain = node();
  c.loopSources[0] = first; c.loopGainNodes[0] = firstGain; c.loopPlaying[0] = true;
  c.stopLoopSource(0);
  c.loopSources[0] = second; c.loopGainNodes[0] = secondGain; c.loopPlaying[0] = true;
  c.stopLoopSource(0);
  for (const callback of timers.values()) callback();
  assert.ok(first.stopped && first.disconnected && firstGain.disconnected);
  assert.ok(second.stopped && second.disconnected && secondGain.disconnected);
});

test('class looper retrigger uses independent gain for retiring and new sources', async () => {
  const { c, timers } = loopFixture();
  Object.assign(c, {
    Looper: class { constructor() {} _updateState() {} },
    ensureAudioContext: async () => {}, loopAudioGain: {}, audioLoopRates: [1], pitchTarget: 'video',
  });
  vm.runInContext(source.slice(source.indexOf('  class AudioLooper extends Looper'), source.indexOf('  // MIDI LOOPER')) + '\nglobalThis.TestLooper = AudioLooper;', c);
  const looper = new c.TestLooper(); looper.buffer = {};
  looper._startPlayback(0); await Promise.resolve();
  const first = looper.sourceNode, firstGain = looper.gainNode;
  looper._startPlayback(0); await Promise.resolve();
  assert.notEqual(looper.gainNode, firstGain);
  const second = looper.sourceNode;
  for (const callback of timers.values()) callback();
  assert.ok(first.stopped && firstGain.disconnected);
  assert.ok(!second.stopped);
});
