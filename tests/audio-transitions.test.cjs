const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../content.js'), 'utf8');

// Model AudioParam's sample-time linear automation, including interrupted ramps.
// The intrinsic .value is deliberately not the automated value, exercising the
// implementation's envelope tracking fallback as well as cancelAndHoldAtTime.
class GainParam {
  constructor(nativeHold = true) {
    this.value = 1;
    this.events = [{ type: 'set', time: 0, value: 1 }];
    this.calls = [];
    if (!nativeHold) this.cancelAndHoldAtTime = undefined;
  }
  valueAt(time) {
    if (!this.events.length) return this.value;
    let previous = this.events[0];
    for (let i = 1; i < this.events.length; i++) {
      const event = this.events[i];
      if (event.time > time) {
        if (event.type === 'ramp' && event.time > previous.time) {
          const phase = Math.max(0, (time - previous.time) / (event.time - previous.time));
          return previous.value + (event.value - previous.value) * phase;
        }
        return previous.value;
      }
      previous = event;
    }
    return previous.value;
  }
  cancelAndHoldAtTime(time) {
    const value = this.valueAt(time);
    const next = this.events.find((event) => event.time > time);
    this.events = this.events.filter((event) => event.time < time);
    // A finished/constant envelope has no future ramp to truncate. Chrome
    // doesn't necessarily insert a new start event in that case: callers must
    // explicitly anchor a following ramp at the held value and current time.
    if (next?.type === 'ramp') this.events.push({ type: 'ramp', time, value });
    this.calls.push({ type: 'hold', time, value });
  }
  cancelScheduledValues(time) {
    this.events = this.events.filter((event) => event.time < time);
    this.calls.push({ type: 'cancel', time });
  }
  setValueAtTime(value, time) {
    this.events.push({ type: 'set', time, value });
    this.calls.push({ type: 'set', time, value });
  }
  linearRampToValueAtTime(value, time) {
    this.events.push({ type: 'ramp', time, value });
    this.calls.push({ type: 'ramp', time, value });
  }
}

function fixture(nativeHold = true) {
  const env = {
    now: 0, timerId: 0, timers: new Map(), seeks: [], warnings: [],
    cues: { '1': 10, '2': 20, '0': 30 }, midi: [], broadcast: [],
    curve: [{ t: 0, g: 0 }, { t: 0.18, g: 0.35 }, { t: 0.45, g: 0.82 }, { t: 1, g: 1 }],
    freezeAudioClock: false, throwSeek: false
  };
  const listeners = new Map();
  let mediaTime = 0;
  const video = {
    duration: 60, seeking: false, readyState: 4, paused: false,
    get currentTime() { return mediaTime; },
    set currentTime(value) {
      if (env.throwSeek) throw new Error('decoder rejected seek');
      env.seeks.push({ target: value, time: env.now });
      if (value !== mediaTime) { this.seeking = true; this.readyState = 1; }
      mediaTime = value;
    },
    addEventListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
    },
    removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
    emit(name) { for (const handler of [...(listeners.get(name) || [])]) handler(); }
  };
  const cueGain = new GainParam(nativeHold);
  const sidechainGain = new GainParam(nativeHold);
  const context = {
    console: { log() {}, warn: (...args) => env.warnings.push(args) },
    audioContext: { currentTime: 0, state: 'running' },
    videoGain: { gain: cueGain }, sidechainGain: { gain: sidechainGain },
    getVideoElement: () => env.currentVideo,
    setTimeout(handler, delay) {
      const id = ++env.timerId;
      env.timers.set(id, { handler, at: env.now + delay });
      return id;
    },
    clearTimeout(id) { env.timers.delete(id); },
    SIDECHAIN_CURVE_POINTS: 16,
    sidechainEnvelopeDuration: 0.6,
    ensureAudioContext: async () => context.audioContext,
    ensureSidechainDefaults() {}, getActiveSidechainCurve: () => env.curve,
    recordMidiEvent: (...args) => env.midi.push(args),
    pulseSequencerTargetButton() {}, recordSequencerTargetHit() {},
    selectedCueKey: null, clearSuperKnobHistory() {},
    getCueTime: (key) => env.cues[key],
    broadcastCueTriggerToTabs: (key) => env.broadcast.push(key)
  };
  env.currentVideo = video;
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('const CUE_FADE_SECONDS'), source.indexOf('let videoCheckInterval')), context);
  vm.runInContext(source.slice(source.indexOf('function clamp01'), source.indexOf('function getPresetCurve')), context);
  vm.runInContext(source.slice(source.indexOf('const SIDECHAIN_EDGE_SECONDS'), source.indexOf('function setSidechainFollowMode')), context);
  vm.runInContext(source.slice(source.indexOf('function sequencerTriggerCue('), source.indexOf('function isTypingInTextField(')), context);
  env.advance = (ms) => {
    const end = env.now + ms;
    while (true) {
      const next = [...env.timers].filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      env.now = timer.at;
      if (!env.freezeAudioClock && context.audioContext) context.audioContext.currentTime = env.now / 1000;
      env.timers.delete(id);
      timer.handler();
    }
    env.now = end;
    if (!env.freezeAudioClock && context.audioContext) context.audioContext.currentTime = env.now / 1000;
  };
  env.ready = () => { video.seeking = false; video.readyState = 3; video.emit('seeked'); };
  env.listenerCount = () => [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0);
  return { env, c: context, video, cueGain, sidechainGain, listeners };
}

test('cue uses the existing 2 ms fade and remains muted until decoder readiness', () => {
  const { env, c, video, cueGain } = fixture();
  c.jumpToCue(10);
  assert.equal(cueGain.valueAt(0), 1);
  assert.equal(cueGain.valueAt(0.001), 0.5);
  env.advance(2);
  assert.deepEqual(env.seeks, [{ target: 10, time: 2 }]);
  env.advance(30);
  assert.equal(cueGain.valueAt(0.032), 0, 'must not restore gain while the decoder is still seeking');
  video.emit('canplay');
  assert.equal(cueGain.valueAt(0.032), 0);
  env.ready();
  assert.equal(cueGain.valueAt(0.033), 0.5);
  assert.equal(cueGain.valueAt(0.034), 1);
  assert.equal(env.listenerCount(), 0);
  assert.equal(env.timers.size, 0);
});

for (const nativeHold of [true, false]) {
  test(`rapid cue retriggers hold the current gain and only seek the newest cue (native hold: ${nativeHold})`, () => {
    const { env, c, cueGain } = fixture(nativeHold);
    c.jumpToCue(10);
    env.advance(1);
    const before = cueGain.valueAt(0.001);
    c.jumpToCue(20);
    assert.equal(cueGain.valueAt(0.001), before);
    env.advance(2);
    assert.deepEqual(env.seeks, [{ target: 20, time: 3 }]);
    env.ready();
    env.advance(1);
    const halfway = cueGain.valueAt(env.now / 1000);
    c.jumpToCue(30);
    assert.equal(cueGain.valueAt(env.now / 1000), halfway);
    env.advance(2);
    assert.equal(env.seeks.at(-1).target, 30);
  });
}

test('obsolete seek listeners cannot restore audio during a newer seek', () => {
  const { env, c, cueGain, listeners } = fixture();
  c.jumpToCue(10);
  env.advance(2);
  const obsolete = [...listeners.get('seeked')][0];
  c.jumpToCue(20);
  env.advance(2);
  obsolete();
  assert.equal(cueGain.valueAt(env.now / 1000), 0);
  assert.equal(env.listenerCount(), 5);
  env.ready();
  assert.equal(env.listenerCount(), 0);
});

test('cue timing snapshots target values and preserves local/remote MIDI dispatch', () => {
  const { env, c } = fixture();
  c.sequencerTriggerCue('1');
  env.cues['1'] = 50;
  env.advance(2);
  assert.equal(env.seeks[0].target, 10);
  assert.deepEqual(env.midi, [['cue', '1']]);
  assert.deepEqual(env.broadcast, ['1']);
  c.sequencerTriggerCue('2', { source: 'remote' });
  env.advance(2);
  assert.equal(env.seeks.at(-1).target, 20);
  assert.deepEqual(env.broadcast, ['1'], 'remote cues must not rebroadcast themselves');
});

test('cue waits for the audio clock rather than cutting off an unfinished ramp', () => {
  const { env, c } = fixture();
  c.jumpToCue(10);
  env.freezeAudioClock = true;
  env.advance(3);
  assert.equal(env.seeks.length, 0);
  env.freezeAudioClock = false;
  env.advance(2);
  assert.equal(env.seeks.length, 1);
});

test('failed/stalled seeks recover gain and clean their listeners', () => {
  const failed = fixture();
  failed.env.throwSeek = true;
  failed.c.jumpToCue(10);
  failed.env.advance(4);
  assert.equal(failed.cueGain.valueAt(0.004), 1);
  assert.equal(failed.env.warnings.length, 1);
  assert.equal(failed.env.listenerCount(), 0);
  const stalled = fixture();
  stalled.c.jumpToCue(10);
  stalled.env.advance(2004);
  assert.equal(stalled.cueGain.valueAt(2.004), 1);
  assert.equal(stalled.env.listenerCount(), 0);
  assert.equal(stalled.env.timers.size, 0);
});

test('same-position, paused, invalid and source-change cue cases do not leave audio muted', () => {
  const same = fixture();
  same.video.paused = true;
  same.c.jumpToCue(0);
  same.env.advance(4);
  assert.equal(same.cueGain.valueAt(0.004), 1);
  assert.equal(same.video.paused, true);
  assert.equal(same.env.listenerCount(), 0);
  assert.equal(same.c.jumpToCue(NaN), false);
  assert.equal(same.c.jumpToCue(Infinity), false);
  const changed = fixture();
  changed.c.jumpToCue(10);
  changed.env.currentVideo = {};
  changed.env.advance(4);
  assert.equal(changed.env.seeks.length, 0);
  assert.equal(changed.cueGain.valueAt(0.004), 1);
  const uninitialized = fixture();
  uninitialized.c.audioContext = null;
  assert.equal(uninitialized.c.jumpToCue(100), true);
  assert.equal(uninitialized.env.seeks[0].target, 60);
  assert.equal(uninitialized.env.timers.size, 0);
});

for (const nativeHold of [true, false]) {
  test(`sidechain starts smoothly, preserves duration and retriggers without unity jumps (native hold: ${nativeHold})`, async () => {
    const { env, c, sidechainGain } = fixture(nativeHold);
    await c.triggerSidechainEnvelope('drum');
    assert.equal(sidechainGain.valueAt(0), 1);
    assert.ok(Math.abs(sidechainGain.valueAt(0.0015) - 0.5) < 1e-12);
    assert.equal(sidechainGain.valueAt(0.003), 0);
    assert.equal(sidechainGain.events.at(-1).time, 0.6);
    assert.equal(sidechainGain.events.at(-1).value, 1);
    env.advance(60);
    const before = sidechainGain.valueAt(0.06);
    await c.triggerSidechainEnvelope('midi');
    assert.equal(sidechainGain.valueAt(0.06), before);
    assert.equal(sidechainGain.valueAt(0.063), 0);
    assert.ok(Math.abs(sidechainGain.events.at(-1).time - 0.66) < 1e-12);
    assert.equal(env.timers.size, 0, 'sidechain smoothing must not schedule a delayed trigger');
    assert.deepEqual(env.midi.map((event) => event[1].reason), ['drum', 'midi']);
  });
}

test('custom sidechain curves ending at zero release smoothly inside the selected duration', async () => {
  const { env, c, sidechainGain } = fixture();
  env.curve = [{ t: 0, g: 0 }, { t: 1, g: 0 }];
  c.sidechainEnvelopeDuration = 0.2;
  await c.triggerSidechainEnvelope();
  assert.equal(sidechainGain.valueAt(0.197), 0);
  assert.ok(Math.abs(sidechainGain.valueAt(0.1985) - 0.5) < 1e-10);
  assert.equal(sidechainGain.valueAt(0.2), 1);
  const ramps = sidechainGain.events.filter((event) => event.type === 'ramp');
  for (let i = 1; i < ramps.length; i++) {
    assert.ok(ramps[i].time > ramps[i - 1].time);
  }
});

test('cue and sidechain gain envelopes bound sample-to-sample discontinuities without buffering', async () => {
  const { env, c, video, cueGain, sidechainGain } = fixture();
  await c.triggerSidechainEnvelope();
  c.jumpToCue(10);
  const sampleRate = 48000;
  let previous = 0.8;
  let peakStep = 0;
  for (let i = 0; i < sampleRate * 0.05; i++) {
    env.advance(1000 / sampleRate);
    if (env.now >= 20 && video.seeking) env.ready();
    const input = env.seeks.length === 0 ? 0.8 : (video.seeking ? 0 : -0.7);
    const time = env.now / 1000;
    const output = input * cueGain.valueAt(time) * sidechainGain.valueAt(time);
    peakStep = Math.max(peakStep, Math.abs(output - previous));
    previous = output;
  }
  // An un-smoothed +0.8 -> -0.7 splice has a 1.5 sample step. The two gain
  // envelopes start at the trigger time and bring that discontinuity below 1%.
  assert.ok(peakStep < 0.015, `unexpected transition step ${peakStep}`);
  assert.ok(env.seeks[0].time <= 2.001, 'must retain the existing 2 ms seek timing');
});
