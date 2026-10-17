const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const engineSource = fs.readFileSync(path.join(root, 'node_modules/signalsmith-stretch/SignalsmithStretch.mjs'), 'utf8');
const contentSource = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const configFunction = contentSource.slice(contentSource.indexOf('function getSpeedHDLatencyConfig('), contentSource.indexOf('async function setSpeedHDLatencyProfile('));

async function processor(sampleRate = 48000, profile = 'quality') {
  let Processor;
  let ready;
  const readyPromise = new Promise((resolve) => { ready = resolve; });
  const context = {
    sampleRate, currentTime: 0,
    console, Math, Number, Float32Array, Uint8Array, WebAssembly, atob,
    performance, setTimeout, clearTimeout,
    AudioWorkletProcessor: class {
      constructor() { this.port = { postMessage: (data) => { if (data[0] === 'ready') ready(); } }; }
    },
    registerProcessor(name, implementation) { Processor = implementation; }
  };
  // The distributed module registers its actual WASM-backed AudioWorklet class.
  vm.runInNewContext(engineSource.slice(0, engineSource.lastIndexOf('let _export=')), context);
  const p = new Processor({ numberOfOutputs: 1, outputChannelCount: [2] });
  await readyPromise;
  const config = vm.runInNewContext(configFunction + '\ngetSpeedHDLatencyConfig(' + JSON.stringify(profile) + ')');
  const send = (method, ...args) => p.port.onmessage({ data: [0, method, ...args] });
  send('configure', config);
  p.control = (message) => {
    if (message.reset) send('configure', config);
    if (typeof message.active === 'boolean') p.active = message.active;
    if (Number.isFinite(message.rate)) p.rate = Math.max(0.25, Math.min(4, message.rate));
    if (Number.isFinite(message.tuneSemitones)) p.tuneSemitones = Math.max(-24, Math.min(24, Math.round(message.tuneSemitones)));
    send('schedule', {
      active: true, semitones: p.active ? (p.tuneSemitones || 0) - 12 * Math.log2(p.rate || 1) : 0,
      tonalityHz: sampleRate, formantSemitones: 0, formantCompensation: false
    });
  };
  p.context = context;
  p.frames = 0;
  return p;
}

function render(p, frames, signal, channels = 2) {
  const result = [new Float32Array(frames), new Float32Array(frames)];
  const input = Array.from({ length: channels }, () => new Float32Array(128));
  const output = [new Float32Array(128), new Float32Array(128)];
  for (let offset = 0; offset < frames; offset += 128) {
    for (let c = 0; c < channels; c++) {
      for (let i = 0; i < 128; i++) input[c][i] = signal(offset + i, c);
    }
    p.context.currentTime = p.frames / p.context.sampleRate;
    assert.equal(p.process([input], [output]), true);
    p.frames += 128;
    for (let c = 0; c < 2; c++) result[c].set(output[c].subarray(0, Math.min(128, frames - offset)), offset);
  }
  return result;
}

function frequency(samples, sampleRate) {
  let first = -1;
  let last = 0;
  let count = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1] <= 0 && samples[i] > 0) {
      const crossing = i - 1 - samples[i - 1] / (samples[i] - samples[i - 1]);
      if (first < 0) first = crossing;
      last = crossing;
      count++;
    }
  }
  return (count - 1) * sampleRate / (last - first);
}

function rms(samples) {
  return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
}

function toneAmplitude(samples, hz, sampleRate) {
  let real = 0;
  let imaginary = 0;
  for (let i = 0; i < samples.length; i++) {
    const phase = 2 * Math.PI * hz * i / sampleRate;
    real += samples[i] * Math.cos(phase);
    imaginary += samples[i] * Math.sin(phase);
  }
  return 2 * Math.hypot(real, imaginary) / samples.length;
}

test('half-speed restores simultaneous bass, midrange and treble notes', async () => {
  const p = await processor();
  p.control({ active: true, rate: 0.5 });
  const tones = [82, 440, 1996];
  const output = render(p, 48000 * 3, (i, c) => tones.reduce((sum, hz, t) =>
    sum + 0.2 * Math.sin(2 * Math.PI * hz * 0.5 * i / 48000 + (c ? t * 0.4 : 0)), 0));
  for (const channel of output) {
    const settled = channel.subarray(48000);
    for (const hz of tones) {
      // A long single-frequency DFT can cancel an almost-correct note. Locate
      // its narrowband peak, then independently check pitch error and level.
      const peak = Array.from({ length: 17 }, (_, i) => {
        const frequency = hz - 1 + i * 0.125;
        return { frequency, amplitude: toneAmplitude(settled, frequency, 48000) };
      }).sort((a, b) => b.amplitude - a.amplitude)[0];
      assert.ok(Math.abs(1200 * Math.log2(peak.frequency / hz)) < 8, `polyphonic pitch error at ${hz} Hz`);
      assert.ok(peak.amplitude > 0.15, `lost polyphonic note ${hz} Hz (amplitude ${peak.amplitude})`);
      assert.ok(toneAmplitude(settled, hz * 0.5, 48000) < 0.02, `leaked slowed pitch ${hz * 0.5} Hz`);
    }
  }
});

test('official WASM engine initializes with the quality window and finite latency', async () => {
  const p = await processor();
  assert.equal(p.wasmReady, true);
  const latency = p.inputLatencySeconds + p.outputLatencySeconds;
  assert.ok(latency >= 0.16 && latency <= 0.21, `unexpected latency ${latency}`);
  p.control({ active: true, rate: 0.5 });
  const mono = render(p, 48000, (i) => 0.5 * Math.sin(2 * Math.PI * 110 * i / 48000), 1);
  assert.ok(Math.abs(frequency(mono[0].subarray(24000), 48000) - 220) < 1);
  for (let i = 24000; i < mono[0].length; i++) assert.ok(Math.abs(mono[0][i] - mono[1][i]) < 1e-5);
});

for (const [profile, expected] of [['quality', 168], ['balanced', 104], ['live', 68]]) {
  test(`HD ${profile} profile reports ${expected} ms and preserves half-speed pitch`, async () => {
    const p = await processor(48000, profile);
    assert.ok(Math.abs((p.inputLatencySeconds + p.outputLatencySeconds) * 1000 - expected) < 0.1);
    p.control({ active: true, rate: 0.5, tuneSemitones: 3 });
    const output = render(p, 96000, (i) => 0.5 * Math.sin(2 * Math.PI * 110 * i / 48000));
    assert.ok(Math.abs(frequency(output[0].subarray(48000), 48000) - 220 * 2 ** (3 / 12)) < 1);
  });
}

for (const rate of [0.5, 1, 2]) {
  for (const tuneSemitones of [-5, 3]) {
    test(`HD tuning changes pitch independently at ${rate}x / ${tuneSemitones} st with unchanged engine latency`, async () => {
      const p = await processor();
      const latency = p.inputLatencySeconds + p.outputLatencySeconds;
      p.control({ active: true, rate, tuneSemitones });
      const output = render(p, 96000, (i) => 0.5 * Math.sin(2 * Math.PI * 220 * rate * i / 48000));
      const expected = 220 * 2 ** (tuneSemitones / 12);
      const measured = frequency(output[0].subarray(48000), 48000);
      assert.ok(Math.abs(measured - expected) < 1, `expected ${expected} Hz; got ${measured} Hz`);
      assert.equal(p.inputLatencySeconds + p.outputLatencySeconds, latency);
    });
  }
}

for (const sampleRate of [44100, 48000]) {
  for (const rate of [0.25, 0.5, 0.75, 1.25, 1.5, 2, 4]) {
    test(`restores 220 Hz pitch and stereo phase at ${rate}x / ${sampleRate} Hz`, async () => {
      const p = await processor(sampleRate);
      p.control({ active: true, rate });
      const output = render(p, sampleRate * 2,
        (i, c) => 0.5 * Math.sin(2 * Math.PI * 220 * rate * i / sampleRate) * (c ? -1 : 1));
      const settled = output[0].subarray(sampleRate);
      const measured = frequency(settled, sampleRate);
      assert.ok(Math.abs(measured - 220) < 1, `pitch was ${measured} Hz`);
      assert.ok(Math.abs(rms(settled) - Math.SQRT1_2 * 0.5) < 0.04, 'unexpected amplitude modulation');
      for (let i = sampleRate; i < output[0].length; i++) {
        assert.ok(Number.isFinite(output[0][i]));
        assert.ok(Math.abs(output[0][i] + output[1][i]) < 1e-5, 'stereo phase was altered');
      }
    });
  }
}

test('handles silence, rate changes and reset without stale output or NaNs', async () => {
  const p = await processor();
  p.control({ active: true, rate: 0.5 });
  const signal = (i, c) => 0.4 * Math.sin(i * (c ? 0.03 : 0.05));
  render(p, 48000, signal);
  for (const rate of [4, 0.25, 1, 2, NaN, Infinity]) {
    p.control({ rate });
    const output = render(p, 24064, signal);
    for (const channel of output) {
      for (const value of channel) assert.ok(Number.isFinite(value) && Math.abs(value) < 1);
    }
  }
  p.control({ reset: true, active: true, rate: 0.5 });
  const silence = render(p, 48000, () => 0);
  for (const channel of silence) for (const value of channel) assert.equal(value, 0);
});

function controls() {
  const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  const messages = [];
  const video = { _mediaSource: {} };
  const deckB = { _mediaSource: {} };
  const preview = { _mediaSource: {} };
  const makeNode = () => ({ port: { postMessage: (message) => messages.push(message) } });
  const makeElement = () => ({
    children: [], listeners: {}, hidden: false, disabled: false,
    setAttribute(name, value) { this[name] = value; },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    append(...children) { this.children.push(...children); },
    click() { if (!this.disabled) this.listeners.click?.(); }
  });
  const context = {
    console,
    pitchPercentage: 0, pitchSemitone: 0, pitchSemitoneMode: false,
    speedOnlyMode: false, speedHDMode: false, speedHDTuneSemitone: 0,
    speedHDTuneControl: null, speedHDTuneValue: null, speedHDTuneDownButton: null, speedHDTuneUpButton: null,
    pitchTarget: 'video', videoPitchPercentage: 0, loopPitchPercentage: 25,
    pitchSliderElement: {}, minimalPitchSlider: {},
    minimalPitchModeButton: { setAttribute(name, value) { this[name] = value; } },
    advancedPitchLabel: {}, minimalPitchLabel: {}, pitchModeButton: {}, pitchTargetButton: {},
    videoPreviewElement: preview, deckA: video, deckB,
    videoSpeedStretchNode: makeNode(), previewSpeedStretchNode: makeNode(),
    speedStretchStatus: 'hq',
    document: { createElement: makeElement },
    getVideoElement: () => video,
    loopSources: [{ playbackRate: { value: 1 } }], audioLoopRates: [1],
    window: {}, applyInstrumentPitchSync() {}, ensureAudioContext: async () => {},
    messages
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function syncSpeedPlayback()'), source.indexOf('// simple IR for reverb')), context);
  vm.runInContext(source.slice(source.indexOf('const PITCH_PERCENT_MIN ='), source.indexOf('function applyInstrumentPitchSync()')), context);
  return context;
}

test('loop pitch updates live rates and restores base rates when returning to video target', () => {
  const c = controls();
  const changes = [];
  c.audioContext = { currentTime: 5 };
  c.audioLoopRates = [0.5];
  c.loopSources = [{ playbackRate: { setTargetAtTime: (...args) => changes.push(args) } }];
  let classUpdates = 0;
  c.loopers = { audio: [{ applyTempoChange: () => classUpdates++ }] };
  c.pitchTarget = 'loop';
  c.updatePitch(100);
  assert.equal(changes.at(-1)[0], 1);
  assert.equal(changes.at(-1)[1], 5);
  c.pitchTarget = 'video';
  c.updatePitch(50);
  assert.equal(changes.at(-1)[0], 0.5);
  assert.equal(classUpdates, 2);
});

test('basic Speed compensates raw AI playback without double-stretching the preview or original', () => {
  const c = controls();
  c.stemState = { ai: { pathMix: 'ai' } };
  c.speedOnlyMode = true; c.speedHDMode = false;
  c.pitchPercentage = -50;
  c.syncSpeedPlayback();
  assert.equal(c.messages.at(-2).active, true, 'raw stem sources use the HQ correction at half speed');
  assert.equal(c.messages.at(-2).rate, 0.5);
  assert.equal(c.messages.at(-1).active, false, 'loop preview remains on browser pitch preservation');
  assert.equal(c.deckA.preservesPitch, false);
  assert.equal(c.videoPreviewElement.preservesPitch, true);
  c.stemState.ai.pathMix = 'live'; c.syncSpeedPlayback();
  assert.equal(c.messages.at(-2).active, false);
  assert.equal(c.deckA.preservesPitch, true);
});

test('Pitch / Speed / Speed HD cycles preserve units, range and rate and select exactly one stretch engine', () => {
  const c = controls();
  c.togglePitchMode(true);
  c.updatePitch(7);
  const rate = 2 ** (7 / 12);
  for (let i = 0; i < 6; i++) {
    c.toggleSpeedOnlyMode();
    assert.equal(c.pitchSemitoneMode, true);
    assert.equal(c.pitchSemitone, 7);
    assert.equal(c.minimalPitchSlider.value, 7);
    assert.equal(c.minimalPitchSlider.min, -24);
    assert.equal(c.minimalPitchSlider.max, 24);
    assert.equal(c.deckA.playbackRate, rate);
    assert.equal(c.deckB.playbackRate, rate);
    assert.equal(c.videoPreviewElement.playbackRate, rate);
    const mode = i % 3;
    assert.equal(c.minimalPitchModeButton.textContent, ['Speed', 'Speed HD', 'Pitch'][mode]);
    assert.equal(c.speedOnlyMode, mode !== 2);
    assert.equal(c.speedHDMode, mode === 1);
    assert.equal(c.messages.at(-1).active, mode === 1, 'only HD should enable the spectral engine');
    for (const video of [c.deckA, c.deckB, c.videoPreviewElement]) {
      assert.equal(video.preservesPitch, mode === 0, 'only basic Speed should enable browser stretching');
    }
  }
});

test('units can change inside Speed without disabling speed mode', () => {
  const c = controls();
  c.updatePitch(50);
  c.toggleSpeedOnlyMode();
  c.togglePitchMode(true);
  assert.equal(c.speedOnlyMode, true);
  assert.equal(c.pitchSemitoneMode, true);
  assert.equal(c.deckA.playbackRate, 1.5);
  assert.equal(c.getGlobalPitchSemitone(), 0);
  c.updatePitch(12);
  assert.equal(c.deckA.playbackRate, 2);
  c.togglePitchMode(false);
  assert.equal(c.speedOnlyMode, true);
  assert.equal(c.pitchPercentage, 100);
  assert.equal(c.minimalPitchModeButton.textContent, 'Speed');
  c.toggleSpeedOnlyMode();
  assert.equal(c.minimalPitchModeButton.textContent, 'Speed HD');
  c.togglePitchMode(true);
  assert.equal(c.speedHDMode, true);
  assert.equal(c.deckA.playbackRate, 2);
  c.updatePitch(0);
  assert.equal(c.messages.at(-1).active, false, 'unity should bypass buffered processing');
});

test('HD tune arrows change one semitone and reset without altering fader units or speed', () => {
  const c = controls();
  c.buildSpeedHDTuneControl();
  c.updatePitch(-50);
  c.togglePitchMode(true);
  c.toggleSpeedOnlyMode();
  c.toggleSpeedOnlyMode();
  assert.equal(c.speedHDTuneControl.hidden, false);
  assert.equal(c.speedHDTuneValue.textContent, '0');
  c.speedHDTuneUpButton.click();
  c.speedHDTuneUpButton.click();
  assert.equal(c.speedHDTuneSemitone, 2);
  assert.equal(c.speedHDTuneValue.textContent, '+2');
  assert.equal(c.pitchSemitoneMode, true);
  assert.equal(c.pitchSemitone, -12);
  assert.equal(c.minimalPitchSlider.value, -12);
  assert.equal(c.deckA.playbackRate, 0.5);
  assert.equal(c.deckB.playbackRate, 0.5);
  assert.equal(c.videoPreviewElement.playbackRate, 0.5);
  assert.equal(c.messages.at(-1).tuneSemitones, 2);
  assert.equal(c.getGlobalPitchSemitone(), 2);
  c.speedHDTuneDownButton.click();
  assert.equal(c.speedHDTuneSemitone, 1);
  c.speedHDTuneValue.click();
  assert.equal(c.speedHDTuneSemitone, 0);
  assert.equal(c.speedHDTuneValue.textContent, '0');
  assert.equal(c.deckA.playbackRate, 0.5);
});

test('tuning is remembered but hidden and bypassed in Pitch and basic Speed', () => {
  const c = controls();
  c.buildSpeedHDTuneControl();
  c.updatePitch(-50);
  c.toggleSpeedOnlyMode();
  c.toggleSpeedOnlyMode();
  c.updateSpeedHDTune(3);
  c.toggleSpeedOnlyMode();
  assert.equal(c.speedHDTuneControl.hidden, true);
  assert.equal(c.speedHDTuneSemitone, 3);
  assert.equal(c.messages.at(-1).active, false);
  assert.equal(c.messages.at(-1).tuneSemitones, 0);
  assert.equal(c.deckA.preservesPitch, false);
  assert.equal(c.getGlobalPitchSemitone(), -12);
  c.toggleSpeedOnlyMode();
  assert.equal(c.speedHDTuneControl.hidden, true);
  assert.equal(c.deckA.preservesPitch, true);
  assert.equal(c.messages.at(-1).active, false);
  assert.equal(c.getGlobalPitchSemitone(), 0);
  c.updateSpeedHDTune(12);
  assert.equal(c.speedHDTuneSemitone, 3, 'tuning must not change outside HD mode');
  c.toggleSpeedOnlyMode();
  assert.equal(c.speedHDTuneControl.hidden, false);
  assert.equal(c.speedHDTuneValue.textContent, '+3');
  assert.equal(c.messages.at(-1).tuneSemitones, 3);
  assert.equal(c.deckA.playbackRate, 0.5);
});

test('HD tuning at normal speed stays active and speed reset does not reset tuning', () => {
  const c = controls();
  c.toggleSpeedOnlyMode();
  c.toggleSpeedOnlyMode();
  c.updateSpeedHDTune(3);
  assert.equal(c.deckA.playbackRate, 1);
  assert.equal(c.messages.at(-1).active, true);
  c.updatePitch(-50);
  c.updatePitch(0);
  assert.equal(c.speedHDTuneSemitone, 3);
  assert.equal(c.messages.at(-1).active, true);
  c.updateSpeedHDTune(0);
  assert.equal(c.messages.at(-1).active, false, 'normal speed and zero tuning should bypass HD buffering');
});

test('HD tuning clamps at 24 semitones and disables arrows when the engine is unavailable', () => {
  const c = controls();
  c.buildSpeedHDTuneControl();
  c.toggleSpeedOnlyMode();
  c.toggleSpeedOnlyMode();
  c.updateSpeedHDTune(100);
  assert.equal(c.speedHDTuneSemitone, 24);
  assert.equal(c.speedHDTuneUpButton.disabled, true);
  c.updateSpeedHDTune(-100);
  assert.equal(c.speedHDTuneSemitone, -24);
  assert.equal(c.speedHDTuneDownButton.disabled, true);
  c.updateSpeedHDTune(NaN);
  assert.equal(c.speedHDTuneSemitone, -24);
  c.speedStretchStatus = 'browser';
  c.videoSpeedStretchNode = null;
  c.refreshPitchUI();
  assert.equal(c.speedHDTuneUpButton.disabled, true);
  assert.equal(c.speedHDTuneDownButton.disabled, true);
  assert.equal(c.getGlobalPitchSemitone(), 0);
  c.speedHDTuneValue.click();
  assert.equal(c.speedHDTuneSemitone, 0);
});

test('target changes restore video semitone value and browser fallback avoids double stretching', () => {
  const c = controls();
  c.togglePitchMode(true);
  c.updatePitch(7);
  c.toggleSpeedOnlyMode();
  c.toggleSpeedOnlyMode();
  c.togglePitchTarget();
  assert.equal(c.speedOnlyMode, false);
  assert.equal(c.speedHDMode, false);
  assert.equal(c.deckA.playbackRate, 1);
  assert.equal(c.loopSources[0].playbackRate.value, 1.25);
  c.toggleSpeedOnlyMode();
  c.toggleSpeedOnlyMode();
  assert.equal(c.pitchTarget, 'video');
  assert.ok(Math.abs(c.pitchSemitone - 7) < 1e-10);
  assert.equal(c.pitchSemitoneMode, true);
  c.videoSpeedStretchNode = null;
  c.previewSpeedStretchNode = null;
  c.syncSpeedPlayback();
  assert.equal(c.deckA.preservesPitch, true);
  assert.equal(c.deckB.preservesPitch, true);
  assert.equal(c.videoPreviewElement.preservesPitch, true);
  c.toggleSpeedOnlyMode();
  assert.equal(c.deckA.preservesPitch, false);
});

test('adapter configures HQ processing, bypasses dry audio and applies octave correction at half speed', async () => {
  const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  let workletNode;
  class Gain {
    constructor() {
      this.connections = [];
      this.gain = {
        value: 1, cancelAndHoldAtTime() {},
        setValueAtTime(value) { this.value = value; },
        linearRampToValueAtTime(value) { this.value = value; }
      };
    }
    connect(node) { this.connections.push(node); return node; }
    disconnect() { this.connections = []; }
  }
  class WorkletNode extends Gain {
    constructor(ctx, name, options) {
      super();
      workletNode = this;
      this.name = name;
      this.options = options;
      this.messages = [];
      this.port = {
        close() {},
        postMessage: (data) => {
          this.messages.push(data);
          if (data[1] === 'configure') this.config = data[2];
          queueMicrotask(() => this.port.onmessage?.({ data: [data[0], data[1] === 'latency' ? (this.config.blockMs + this.config.intervalMs) / 1000 : undefined] }));
        }
      };
      queueMicrotask(() => this.port.onmessage?.({ data: ['ready', {}] }));
    }
  }
  const context = { console, setTimeout, clearTimeout, AudioWorkletNode: WorkletNode };
  vm.createContext(context);
  vm.runInContext(configFunction, context);
  vm.runInContext(source.slice(source.indexOf('async function createHighQualitySpeedNode('), source.indexOf('function syncSpeedPlayback()')), context);
  const node = await context.createHighQualitySpeedNode({ currentTime: 2, sampleRate: 48000, createGain: () => new Gain() });
  assert.equal(workletNode.name, 'signalsmith-stretch');
  assert.equal(workletNode.options.channelCount, 2);
  assert.equal(node.latencySeconds, 0.168);
  const configure = workletNode.messages.find((m) => m[1] === 'configure')[2];
  assert.equal(configure.blockMs, 160);
  assert.equal(configure.splitComputation, true);
  const dry = node.input.connections.find((n) => n !== workletNode);
  const wet = workletNode.connections[0];
  assert.equal(dry.gain.value, 1);
  assert.equal(wet.gain.value, 0);
  node.port.postMessage({ active: true, rate: 0.5 });
  assert.equal(dry.gain.value, 0);
  assert.equal(wet.gain.value, 1);
  assert.equal(workletNode.messages.at(-1)[2].semitones, 12);
  assert.equal(workletNode.messages.at(-1)[2].tonalityHz, 48000);
  node.port.postMessage({ active: true, rate: 0.5, tuneSemitones: 3 });
  assert.equal(workletNode.messages.at(-1)[2].semitones, 15);
  assert.equal(workletNode.messages.filter((m) => m[1] === 'configure').length, 1, 'tuning must not reconfigure or add buffering');
  assert.equal(node.latencySeconds, 0.168);
  const count = workletNode.messages.length;
  node.port.postMessage({ active: true, rate: 0.5, tuneSemitones: 3 });
  assert.equal(workletNode.messages.length, count, 'unchanged controls should not reschedule processing');
  node.port.postMessage({ active: false, rate: 1 });
  assert.equal(dry.gain.value, 1);
  assert.equal(wet.gain.value, 0);
  await node.setProfile('live');
  assert.equal(node.latencySeconds, 0.068);
  assert.equal(workletNode.messages.filter((m) => m[1] === 'configure').at(-1)[2].blockMs, 64);
  node.dispose();
  assert.equal(node.input.connections.length, 0);
  assert.equal(workletNode.connections.length, 0);
});

test('three-step label is stable and HD engine readiness/fallback is reported in the tooltip', () => {
  const c = controls();
  c.updatePitch(-50);
  c.toggleSpeedOnlyMode();
  assert.equal(c.minimalPitchModeButton.textContent, 'Speed');
  assert.equal(c.deckA.preservesPitch, true);
  assert.equal(c.messages.at(-1).active, false);
  c.toggleSpeedOnlyMode();
  assert.equal(c.minimalPitchModeButton.textContent, 'Speed HD');
  assert.equal(c.minimalPitchModeButton['data-engine'], 'hq');
  assert.equal(c.deckA.preservesPitch, false);
  assert.equal(c.messages.at(-1).active, true);
  c.speedStretchStatus = 'loading';
  c.refreshPitchUI();
  assert.equal(c.minimalPitchModeButton.textContent, 'Speed HD');
  assert.match(c.minimalPitchModeButton.title, /loading/);
  c.speedStretchStatus = 'browser';
  c.refreshPitchUI();
  assert.equal(c.minimalPitchModeButton.textContent, 'Speed HD');
  assert.equal(c.minimalPitchModeButton['data-engine'], 'browser');
  assert.match(c.minimalPitchModeButton.title, /fallback/);
  c.toggleSpeedOnlyMode();
  assert.equal(c.minimalPitchModeButton.textContent, 'Pitch');
  assert.equal(c.messages.at(-1).active, false);
  assert.equal(c.deckA.preservesPitch, false);
});

test('release exposes the worklet and declares version 2.4.1', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, '2.4.1');
  assert.ok(manifest.content_scripts.some((entry) => entry.js[0] === 'vj-live.js'));
  assert.ok(manifest.permissions.includes('power'));
  assert.ok(manifest.web_accessible_resources.some((entry) => entry.resources.includes('worklets/speed-stretch-worklet.js')));
  assert.ok(manifest.web_accessible_resources.some((entry) => entry.resources.includes('node_modules/signalsmith-stretch/SignalsmithStretch.mjs')));
});
