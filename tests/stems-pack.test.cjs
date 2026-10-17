const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { ModelStore } = require('../addons/stems/model-store.js');
const TL = require('../addons/stems/stem-timeline.js');
const { RegionLoop } = require('../video-region-loop.js');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

function graphFixture() {
  class Param {
    constructor(value = 1) { this.value = value; }
    cancelScheduledValues() {}
    setValueAtTime(value) { this.value = value; }
    linearRampToValueAtTime(value) { this.value = value; }
  }
  class Node {
    constructor() { this.gain = new Param(); this.playbackRate = { value: 1 }; this.connections = new Set(); }
    connect(node) { this.connections.add(node); return node; }
    disconnect(node) { if (node) this.connections.delete(node); else this.connections.clear(); }
    start(when) { this.startAt = when; }
    stop() { this.stopped = true; }
  }
  const audioContext = {
    state: 'running', currentTime: 10, sampleRate: 48000,
    createGain: () => new Node(),
    createBiquadFilter() { throw new Error('Frequency filters must never substitute for stems'); },
    createBuffer(channels, frames) { return { getChannelData: () => new Float32Array(frames) }; },
    createBufferSource: () => new Node(),
  };
  const video = { currentTime: 20, playbackRate: 1, paused: false, seeking: false, readyState: 4 };
  const ctx = {
    console, window: {}, chrome: { runtime: { getManifest: () => ({ version: '2.4' }) } },
    sendToBackground: async () => ({ ok: true }),
    location: { href: 'https://www.youtube.com/watch?v=test' },
    audioContext, videoGain: new Node(), stemState: null, stemBusInput: null, stemBusOutput: null,
    stemBranchGains: null, stemBranchFilters: null, stemLiveGains: null, stemAiGains: null, stemBusContext: null,
    stemTap: null, stemWorker: null,
    stemsButtonMin: null, stemsDropdownMin: null, stemsStatusMin: null,
    stemsGridMin: null, loopGainEnvelopes: new WeakMap(),
    getVideoElement: () => video, YTBMStemTimeline: TL,
    Float32Array, Map, URL, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf('const STEM_KEYS ='), source.indexOf('function getPitchSliderTitle')), ctx);
  ctx.ensureStemTap = () => {};
  ctx.getStemState().installed = true;
  ctx.ensureStemBus();
  return { ctx, video, Node };
}

test('default installed graph connects original input to output at unity, without filters', () => {
  const { ctx } = graphFixture();
  assert.ok(ctx.stemBusInput.connections.has(ctx.stemBusInput._direct));
  assert.ok(ctx.stemBusInput._direct.connections.has(ctx.stemBusOutput));
  assert.equal(ctx.stemBusInput._direct.gain.value, 1);
  for (const node of Object.values(ctx.stemAiGains)) assert.equal(node.gain.value, 0);
  ctx.disconnectStemBus(); ctx.ensureStemBus();
  assert.ok(ctx.stemBusInput.connections.has(ctx.stemBusInput._direct), 'FX rerouting preserves internal bypass');
});


test('invalidated extension context stops stems once and restores original audio without another worklet request', async () => {
  const { ctx } = graphFixture(); const st = ctx.getStemState();
  let checks = 0, loads = 0, warnings = 0, terminated = 0;
  ctx.console = { log() {}, warn() { warnings++; } };
  ctx.chrome.runtime.getManifest = () => { checks++; throw new Error('Extension context invalidated.'); };
  ctx.audioContext.audioWorklet = { addModule: async () => loads++ };
  st.analysisRequested = true; st.mutes.vocals = true;
  st.ai = { ready: true, sources: [], worker: { terminate: () => terminated++ } };
  assert.equal(await ctx.ensureStemTapWorklet(), false);
  assert.equal(st.contextInvalidated, true); assert.equal(st.installed, false);
  assert.equal(st.ai, null); assert.equal(terminated, 1);
  assert.equal(ctx.stemBusInput._direct.gain.value, 1);
  for (let i = 0; i < 4; i++) { ctx.requestStemAnalysis(); await ctx.ensureStemTapWorklet(); }
  assert.equal(checks, 1); assert.equal(loads, 0); assert.equal(warnings, 0);
});

test('teardown during asynchronous worklet loading cannot attach an obsolete capture tap', async () => {
  const { ctx } = graphFixture(); const st = ctx.getStemState();
  st.analysisRequested = true;
  let finish, created = 0;
  ctx.chrome.runtime.getURL = path => path;
  ctx.audioContext.audioWorklet = { addModule: () => new Promise(resolve => finish = resolve) };
  ctx.AudioWorkletNode = class { constructor() { created++; throw new Error('Obsolete tap should never be constructed'); } };
  const pending = ctx.ensureStemTapWorklet();
  ctx.teardownStemTap(); finish();
  assert.equal(await pending, false); assert.equal(created, 0);
  assert.equal(st._tapReady, false);
});

test('restoring a verified model repairs the flag and automatically starts analysis', async () => {
  const { ctx } = graphFixture();
  let preloads = 0, initialized = 0, restored = false;
  ctx.getStemState().installed = false;
  ctx.sendToBackground = async () => ({ ok: true, present: true, bytes: 165612636, source: 'opfs' });
  ctx.chrome.storage = { local: { remove: async () => {}, set: async value => restored = value.ytbmStemsPackInstalled } };
  ctx.chrome.runtime.getURL = path => path;
  ctx.preloadStemSong = () => preloads++;
  ctx.applyAllFXRouting = () => {};
  ctx.ensureAudioContext = async () => {};
  ctx.setInterval = () => 1;
  ctx.clearInterval = () => {};
  ctx.createStemEngineClient = () => ({ postMessage: () => initialized++, terminate() {} });
  assert.equal(ctx.ensureStemAI(), null);
  await ctx.reconcileStemInstallation();
  await Promise.resolve();
  assert.equal(ctx.getStemState().analysisRequested, true);
  assert.equal(ctx.getStemState().modelCheckState, 'present');
  assert.equal(restored, true);
  assert.equal(initialized, 1);
  assert.ok(preloads >= 1);
});

test('download stays hidden during checking and on verification failure, and only appears for a missing model', async () => {
  const { ctx } = graphFixture();
  const element = () => ({ style: {}, setAttribute() {}, querySelectorAll: () => [] });
  for (const name of ['stemsButtonMin', 'stemsDropdownMin', 'stemsDownloadBtn', 'stemsGridMin', 'stemsStatusMin']) ctx[name] = element();
  for (const name of ['stemsProgressWrap', 'stemsDownloadAllBtn', 'stemsUninstallBtn']) ctx[name] = null;
  const st = ctx.getStemState(); st.installed = false;
  let resolve;
  ctx.sendToBackground = () => new Promise(r => resolve = r);
  ctx.chrome.storage = { local: { set: async () => {} } };
  ctx.preloadStemSong = ctx.requestStemAnalysis = ctx.applyAllFXRouting = () => {};
  const checking = ctx.reconcileStemInstallation();
  assert.equal(ctx.stemsDownloadBtn.style.display, 'none');
  assert.match(ctx.stemsStatusMin.textContent, /Checking/);
  resolve({ ok: true, present: true, bytes: 165612636, source: 'opfs' });
  await checking;
  assert.equal(ctx.stemsDownloadBtn.style.display, 'none');
  assert.equal(ctx.stemsGridMin.style.display, 'flex');
  st.installed = false; st.modelCheckState = 'error';
  ctx.refreshStemsUI();
  assert.equal(ctx.stemsDownloadBtn.textContent, 'Retry model check');
  st.modelCheckState = 'missing'; ctx.refreshStemsUI();
  assert.equal(ctx.stemsDownloadBtn.textContent, 'Download stems package');
  assert.equal(ctx.stemsDownloadBtn.style.display, 'block');
});

test('missing-model startup keeps the bounded native prefix available for a first install', async () => {
  const { ctx } = graphFixture(); let cleared = 0;
  ctx.getStemState().installed = false;
  ctx.YTBMBufferedAudio = { clear: () => cleared++ };
  ctx.sendToBackground = async () => ({ ok: true, present: false, bytes: 0 });
  ctx.chrome.storage = { local: { remove: async () => {} } };
  await ctx.reconcileStemInstallation();
  assert.equal(ctx.getStemState().modelCheckState, 'missing');
  assert.equal(cleared, 0);
});

test('stem buttons wait for current-section audio and always allow releasing a selected mute', () => {
  const { ctx } = graphFixture(); const st = ctx.getStemState();
  const button = { style: {}, dataset: {}, classList: { toggle() {} }, getAttribute: () => 'vocals', setAttribute() {}, removeAttribute() {} };
  ctx.stemsDropdownMin = { style: {} }; ctx.stemsButtonMin = null;
  ctx.stemsGridMin = { style: {}, querySelectorAll: () => [button] };
  for (const name of ['stemsDownloadBtn','stemsProgressWrap','stemsDownloadAllBtn','stemsUninstallBtn','stemsStatusMin']) ctx[name] = null;
  ctx.stemAiHasCurrentCoverage = () => false;
  ctx.refreshStemsUI(); assert.equal(button.disabled, true);
  st.mutes.vocals = true;
  ctx.refreshStemsUI(); assert.equal(button.disabled, false);
  st.mutes.vocals = false; ctx.stemAiHasCurrentCoverage = () => true;
  ctx.refreshStemsUI(); assert.equal(button.disabled, false);
});

test('model installation shows only the first download line', () => {
  const { ctx } = graphFixture();
  const element = () => ({ style: {}, classList: { toggle() {} }, setAttribute() {} });
  ctx.stemsDropdownMin = element();
  ctx.stemsStatusMin = element();
  ctx.stemsProgressWrap = element(); ctx.stemsProgressBar = element(); ctx.stemsProgressLabel = element();
  for (const name of ['stemsDownloadBtn', 'stemsDownloadAllBtn', 'stemsUninstallBtn']) ctx[name] = null;
  const st = ctx.getStemState(); st.installed = false; st.downloading = true; st.downloadProgress = 0.42;
  ctx.refreshStemsUI();
  assert.equal(ctx.stemsProgressLabel.textContent, 'Downloading… 42%');
  assert.equal(ctx.stemsProgressWrap.style.display, 'block');
  assert.equal(ctx.stemsStatusMin.style.display, 'none');
  assert.equal(ctx.stemsStatusMin.textContent, '');
});


test('separation percentage counts unique output against the whole song, not the loaded prefix', () => {
  const { ctx, video } = graphFixture();
  const st = ctx.getStemState(); st.analysisRequested = true;
  video.duration = 30;
  st.ai = { ready: true, mode: 'buffered', songDuration: 30, trackDuration: 15, trackFrames: 15 * TL.SR,
    learnedSegs: 2, trackTotal: 2, timeline: new TL.StemTimeline() };
  st.ai.timeline.addSegment(0, new Float32Array(TL.SEG * 8));
  st.ai.timeline.addSegment(1, new Float32Array(TL.SEG * 8));
  assert.equal(ctx.stemAiSeparationProgress(), Math.floor((TL.HOP + TL.SEG) / (30 * 44100) * 100));
  assert.match(ctx.stemAiStatusText(), /% separated · 15s loaded/);
  assert.doesNotMatch(ctx.stemAiStatusText(), /100%|Stems ready/);
  // A non-contiguous window must count, but overlap with an existing one must not.
  st.ai.timeline.addSegment(3, new Float32Array(TL.SEG * 8), 1000);
  assert.equal(ctx.stemAiSeparationProgress(), Math.floor((TL.HOP + TL.SEG + 1000) / (30 * 44100) * 100));
});

test('reanalyse drops AI results and starts fresh without clearing the original song or subscription', async () => {
  const { ctx } = graphFixture();
  const st = ctx.ensureStemSession(); st.analysisRequested = true;
  st.bufferedId = 'retained-buffer';
  st.bufferedInfo = { track: st.bufferedId, stream: 'retained-stream', frames: TL.SEG, duration: 7.8, complete: true };
  st.preloadId = 'retained-track'; st.preloadStatus = 'unavailable'; st.preloadAttempts = 6;
  const info = st.bufferedInfo;
  let unsubscribed = 0, terminated = 0, initialized = 0;
  st._bufferedUnsub = () => unsubscribed++;
  st.mutes.vocals = true;
  const oldAI = st.ai = { ready: true, hasPlayedSplit: true, sources: [], timeline: new TL.StemTimeline(), worker: { terminate: () => terminated++ } };
  oldAI.timeline.addSegment(0, new Float32Array(TL.SEG * 8));
  ctx.ensureAudioContext = async () => ctx.audioContext;
  ctx.applyAllFXRouting = ctx.preloadStemSong = () => {};
  ctx.setInterval = () => 1;
  ctx.createStemEngineClient = () => ({ postMessage: () => initialized++, terminate() {} });
  ctx.chrome.runtime.getURL = p => p;
  ctx.restartStemAnalysis();
  await Promise.resolve(); await Promise.resolve();
  assert.notEqual(st.ai, oldAI);
  assert.equal(st.ai.timeline.segments.size, 0);
  assert.equal(st.ai.mode, 'buffered');
  assert.equal(st.ai.requestedAt, 0);
  assert.equal(st.bufferedInfo, info);
  assert.equal(st.bufferedId, 'retained-buffer'); assert.equal(st.preloadId, 'retained-track');
  assert.equal(st.preloadAttempts, 0);
  assert.equal(st.mutes.vocals, true); assert.equal(st.seekHold, true);
  assert.equal(unsubscribed, 0); assert.equal(terminated, 1); assert.equal(initialized, 1);
});

test('late first metadata does not reset an already started song session', () => {
  const { ctx } = graphFixture();
  const st = ctx.ensureStemSession(); st.analysisRequested = true;
  let resets = 0;
  ctx.clearStemSession = () => resets++;
  ctx.cancelCueSeek = ctx.rampCueGain = ctx.ensureMinimalToggleButton = ctx.updatePitch = () => {};
  ctx.videoSpeedStretchNode = null;
  vm.runInContext(source.slice(source.indexOf('function onNewVideoLoaded()'), source.indexOf('// Finally, start it once')), ctx);
  ctx.onNewVideoLoaded();
  assert.equal(resets, 0);
  ctx.location.href = 'https://www.youtube.com/watch?v=next';
  ctx.onNewVideoLoaded(); assert.equal(resets, 1);
});

test('captured stems clear the spinner even when the live playhead is ahead of processed audio', () => {
  const { ctx } = graphFixture(); const st = ctx.getStemState(); st.analysisRequested = true;
  st.ai = { ready: true, mode: 'capture', learnedSegs: 0, inFlight: true };
  assert.equal(ctx.stemAnalysisIsWorking(), true);
  st.ai.learnedSegs = 1;
  assert.equal(ctx.stemAnalysisIsWorking(), false);
  assert.match(ctx.stemAiStatusText(), /replay an analysed section/);
  st.ai = { ready: true, mode: 'capture', learnedSegs: 0, captureActive: false, inFlight: false, pauseReason: 'paused' };
  assert.equal(ctx.stemAnalysisIsWorking(), false);
});

test('buffered song audio opens the buffered engine and pumps stream-indexed jobs', async () => {
  const { ctx, video } = graphFixture();
  const st = ctx.getStemState();
  st.analysisRequested = true;
  st.analysisStartTime = 0;
  st.bufferedId = 'buf1';
  st.bufferedInfo = { track: 'buf1', stream: 's1', frames: TL.SEG + 10, duration: 8 };
  const posted = [];
  const ai = st.ai = {
    ready: true, mode: 'capture', epoch: 0, sources: [], pending: new Map(),
    timeline: new TL.StemTimeline(), pendingQueue: [], nextId: 1, inFlight: false,
    worker: { postMessage: (msg) => posted.push(msg) },
  };
  let pumped = 0;
  const origPump = ctx.stemAiPump;
  await ctx.stemMaybeOpenBuffered(ai);
  assert.equal(ai.mode, 'buffered');
  assert.equal(ai.stream, 's1');
  assert.equal(ai.pendingQueue.length, 0, 'only the complete window is submitted; unfinished tail waits');
  assert.equal(ai.captureActive, false);
  video.currentTime = 0;
  ctx.stemAiPump();
  const job = posted.find((m) => m.type === 'separate-buffered');
  assert.ok(job, 'buffered mode requests stream-indexed separation');
  assert.equal(job.stream, 's1');
  assert.equal(job.track, 'buf1');
  assert.equal(ai.track, 'buf1');
  assert.equal(typeof origPump, 'function');
  void pumped;
});

test('buffered stream changes reopen analysis instead of failing silently', async () => {
  const { ctx } = graphFixture();
  const st = ctx.getStemState();
  st.analysisRequested = true;
  st.bufferedId = 'buf1';
  const ai = st.ai = {
    ready: true, mode: 'buffered', stream: 's1', epoch: 1, sources: [], pending: new Map(),
    timeline: new TL.StemTimeline(), pendingQueue: [], trackTotal: 2, learnedSegs: 2,
  };
  let closed = 0;
  ai.preparedCache = { close: () => closed++ }; ai.preparedApplied = { rate: 0.5 };
  st.bufferedInfo = { track: 'buf1', stream: 's2', frames: TL.SEG + 10, duration: 8 };
  await ctx.stemMaybeOpenBuffered(ai);
  assert.equal(ai.stream, 's2');
  assert.equal(ai.learnedSegs, 0, 'stale separated sections are dropped on source change');
  assert.equal(closed, 1); assert.equal(ai.preparedCache, null); assert.equal(ai.preparedApplied, null);
});

test('growing buffered audio adds new full windows and final tail without erasing ready stems', async () => {
  const { ctx, video } = graphFixture();
  video.currentTime = 0;
  const st = ctx.getStemState(); st.analysisRequested = true; st.bufferedId = 'buffer';
  const jobs = [];
  st.bufferedInfo = { track: 'buffer', stream: 'stream', frames: TL.SEG + 10, complete: false };
  const ai = st.ai = { ready: true, epoch: 0, sources: [], pending: new Map(), nextId: 1,
    pendingQueue: [], worker: { postMessage: msg => jobs.push(msg) }, timeline: new TL.StemTimeline() };
  await ctx.stemMaybeOpenBuffered(ai);
  assert.deepEqual(jobs.map(job => job.index), [0]);
  ctx.stemAiOnWorkerMessage({ type: 'stems', id: jobs[0].id, data: new Float32Array(TL.SEG * 8) });
  st.bufferedInfo = { ...st.bufferedInfo, frames: TL.HOP + TL.SEG + 10 };
  await ctx.stemMaybeOpenBuffered(ai);
  assert.deepEqual(jobs.map(job => job.index), [0, 1]);
  assert.equal(ai.timeline.segments.has(0), true);
  await ctx.stemMaybeOpenBuffered(ai);
  assert.equal(jobs.length, 2, 'duplicate updates do not enqueue the same window');
  ctx.stemAiOnWorkerMessage({ type: 'stems', id: jobs[1].id, data: new Float32Array(TL.SEG * 8) });
  st.bufferedInfo = { ...st.bufferedInfo, complete: true };
  await ctx.stemMaybeOpenBuffered(ai);
  assert.deepEqual(jobs.map(job => job.index), [0, 1, 2]);
  assert.equal(ai.timeline.segments.size, 2);
});

test('single-stem mutes switch to genuine AI audio only when the current section is covered', () => {
  const { ctx, video } = graphFixture();
  const st = ctx.getStemState();
  st.mutes.vocals = true;
  video.currentTime = 20;
  st.ai = { ready: true, mode: 'buffered', pathMix: 'live', sources: [], generation: 0,
    timeline: new TL.StemTimeline(), trackAnchor: { vt: 0, cs: 0, csEnd: TL.SEG * 2 } };
  ctx.updateStemBusTopology();
  assert.equal(ctx.stemBusInput._direct.gain.value, 1, 'initial pending mute must not silence every instrument');
  assert.equal(st.ai.pathMix, 'live');
  const data = new Float32Array(TL.SEG * 8).fill(0.25);
  st.ai.timeline.addSegment(0, data);
  st.ai.timeline.addSegment(1, data);
  st.ai.sources = [{ startAt: 9.9, generation: 0 }];
  ctx.updateStemBusTopology();
  assert.equal(ctx.stemBusInput._direct.gain.value, 0, 'covered sections leave the bypass path');
  assert.equal(ctx.stemAiGains.vocals.gain.value, 1);
  assert.equal(ctx.stemBranchGains.vocals.gain.value, 0);
  assert.equal(ctx.stemBranchGains.drums.gain.value, 1);
});

test('first stem press starts exactly once at the current moment; a new video returns to idle', async () => {
  const { ctx, video } = graphFixture();
  let initializations = 0, terminated = 0;
  ctx.chrome.runtime.getURL = path => path;
  ctx.ensureAudioContext = async () => ctx.audioContext;
  ctx.applyAllFXRouting = () => {};
  ctx.preloadStemSong = () => {};
  ctx.setInterval = () => 1;
  ctx.clearInterval = () => {};
  ctx.createStemEngineClient = () => ({ postMessage: () => initializations++, terminate: () => terminated++ });
  ctx.toggleStemMute('vocals', false);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(ctx.getStemState().analysisRequested, true);
  assert.equal(ctx.getStemState().analysisStartTime, 20);
  assert.equal(initializations, 1);
  assert.equal(ctx.getStemState().ai.captureActive, true, 'capture starts while the model is still initializing');
  video.currentTime = 25;
  ctx.toggleStemMute('vocals', false);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(initializations, 1);
  assert.equal(ctx.getStemState().analysisStartTime, 20);
  ctx.location.href = 'https://www.youtube.com/watch?v=another-song';
  ctx.ensureStemSession();
  assert.equal(ctx.getStemState().analysisRequested, false);
  assert.equal(ctx.getStemState().ai, null);
  assert.equal(ctx.getStemState().mutes.vocals, false);
  assert.equal(terminated, 1);
});

test('whole-song mode prioritizes the first press, preserves tail length and exports every frame', async () => {
  const { ctx, video } = graphFixture();
  const st = ctx.getStemState();
  st.analysisRequested = true; st.preloadStatus = 'ready'; st.preloadId = 'song';
  const ai = st.ai = {
    ready: false, requestedAt: 8.5, epoch: 0, sources: [], pending: new Map(),
    timeline: new TL.StemTimeline(), pendingQueue: [],
  };
  ctx.sendToBackground = async () => ({ ok: true, frames: 441000, duration: 10 });
  await ctx.stemMaybeOpenTrack(ai);
  assert.equal(ai.mode, 'track');
  assert.deepEqual(Array.from(ai.pendingQueue, x => x.index), [1, 0]);
  assert.equal(ai.pendingQueue[0].validLength, 441000 - TL.HOP);
  assert.equal(ai.captureActive, false);
  ai.ready = true;
  for (const segment of ai.pendingQueue) ai.timeline.addSegment(segment.index, new Float32Array(TL.SEG * 8).fill(0.1), segment.validLength);
  video.currentTime = 8.5;
  const slice = ctx.getStemAISlice('vocals', 30);
  assert.equal(slice.left.length, 441000, 'completed track export includes audio before the first press and after the playhead');
  assert.equal(slice.sampleRate, 44100);
  assert.ok(Math.abs(slice.left[440999] - 0.1) < 1e-6);
});

test('pending or failed AI keeps original sound; all-unmuted always restores original', () => {
  const { ctx } = graphFixture();
  const st = ctx.getStemState();
  st.mutes.vocals = true;
  ctx.updateStemBusTopology();
  assert.equal(ctx.stemBusInput._direct.gain.value, 1);
  st.ai = { ready: true, pathMix: 'live', sources: [{ startAt: 10, generation: 0 }], generation: 0 };
  ctx.updateStemBusTopology();
  assert.equal(ctx.stemBusInput._direct.gain.value, 0);
  assert.equal(ctx.stemAiGains.vocals.gain.value, 1);
  assert.equal(ctx.stemBranchGains.vocals.gain.value, 0);
  st.ai.failed = 'device lost';
  ctx.updateStemBusTopology();
  assert.equal(ctx.stemBusInput._direct.gain.value, 0, 'an established mute is not undone by an engine failure');
  st.ai.failed = null;
  st.mutes.vocals = false;
  ctx.updateStemBusTopology();
  assert.equal(ctx.stemBusInput._direct.gain.value, 1);
  assert.equal(ctx.stemAiGains.drums.gain.value, 0);
  for (const key of Object.keys(st.solos)) st.solos[key] = true;
  ctx.updateStemBusTopology();
  assert.equal(ctx.stemBusInput._direct.gain.value, 1, 'four audible solos also use original audio');
});

test('a single bad segment is skipped without killing separation; repeated failures fail loudly', () => {
  const { ctx } = graphFixture();
  const st = ctx.getStemState();
  let terminated = 0;
  st.ai = { ready: true, mode: 'capture', pending: new Map([[7, { index: 0, epoch: 0 }]]),
    pendingQueue: [], inFlight: true, epoch: 0, worker: { terminate: () => terminated++ }, timer: null };
  ctx.stemAiOnWorkerMessage({ type: 'error', id: 7, error: 'Buffered segment is not ready' });
  assert.equal(st.ai.failed, undefined, 'one bad window must not fail the engine');
  assert.equal(st.ai.inFlight, false);
  assert.equal(terminated, 0, 'worker stays alive after a single bad window');
  for (let i = 0; i < 4; i++) {
    st.ai.pending.set(10 + i, { index: i, epoch: 0 });
    st.ai.inFlight = true;
    ctx.stemAiOnWorkerMessage({ type: 'error', id: 10 + i, error: 'Buffered segment is not ready' });
  }
  assert.match(st.ai.failed, /repeatedly/, 'persistent failures still fail visibly');
  assert.equal(terminated, 1);
});

test('explicitly muting all four is silent, even before inference is ready', () => {
  const { ctx } = graphFixture();
  const st = ctx.getStemState();
  for (const key of Object.keys(st.mutes)) st.mutes[key] = true;
  ctx.updateStemBusTopology();
  assert.equal(ctx.stemBusInput._direct.gain.value, 0);
  for (const gain of Object.values(ctx.stemBranchGains)) assert.equal(gain.gain.value, 0);
});

test('cached stem playback respects the native player volume and mute', () => {
  const { ctx, video } = graphFixture(); const st = ctx.getStemState();
  st.mutes.vocals = true; st.ai = { ready: true, mode: 'buffered' };
  video.volume = 0.25; ctx.stemAiSetPath('ai');
  assert.equal(ctx.stemAiGains.drums.gain.value, 0.25);
  video.muted = true; ctx.stemAiSetPath('ai');
  assert.equal(ctx.stemAiGains.drums.gain.value, 0);
  video.muted = false; video.volume = 0.75; ctx.stemAiSetPath('ai');
  assert.equal(ctx.stemAiGains.drums.gain.value, 0.75);
});

test('the final covered fraction of a song remains on stem playback', () => {
  const { ctx, video } = graphFixture(); const st = ctx.getStemState();
  st.analysisRequested = true; st.mutes.vocals = true;
  video.duration = 7.8; video.currentTime = 7.6;
  st.ai = { ready: true, mode: 'track', sources: [], generation: 0, schedHorizon: 0,
    timeline: new TL.StemTimeline(), trackAnchor: { vt: 0, cs: 0, csEnd: TL.SEG } };
  st.ai.timeline.addSegment(0, new Float32Array(TL.SEG * 8).fill(0.1));
  ctx.updateStemGains(); ctx.stemAiTick();
  assert.equal(st.ai.pathMix, 'ai');
  assert.ok(st.ai.sources[0].duration < 0.21);
  assert.equal(ctx.stemBusInput._direct.gain.value, 0);
});

test('full-source stems follow pitched rates and changing rate cancels obsolete scheduled audio', () => {
  const { ctx, video } = graphFixture(); const st = ctx.getStemState();
  st.analysisRequested = true; st.mutes.vocals = true; video.currentTime = 1; video.playbackRate = 0.5;
  const ai = st.ai = { ready: true, mode: 'track', sources: [], generation: 0, schedHorizon: 0,
    timeline: new TL.StemTimeline(), trackAnchor: { vt: 0, cs: 0, csEnd: TL.SEG } };
  ai.timeline.addSegment(0, new Float32Array(TL.SEG * 8).fill(0.1));
  ctx.updateStemGains(); ctx.stemAiTick();
  assert.equal(ai.pathMix, 'ai'); assert.equal(ai.sources[0].nodes[0].playbackRate.value, 0.5);
  const previous = ai.sources.flatMap(chunk => chunk.nodes);
  video.playbackRate = 1.5; ctx.stemAiTick();
  assert.ok(previous.every(node => node.stopped));
  assert.equal(ai.pathMix, 'ai');
  assert.equal(ai.sources[0].nodes[0].playbackRate.value, 1.5);
  assert.ok(ai.sources[0].duration < 0.42);
  assert.equal(st.mutes.vocals, true);
});

test('fader changes retime active stem sources without restarting their waveform or crossfade', () => {
  const { ctx, video } = graphFixture(); const st = ctx.getStemState();
  st.analysisRequested = true; st.mutes.vocals = true; video.currentTime = 1;
  const ai = st.ai = { ready: true, mode: 'track', sources: [], generation: 0, schedHorizon: 0,
    timeline: new TL.StemTimeline(), trackAnchor: { vt: 0, cs: 0, csEnd: TL.SEG } };
  ai.timeline.addSegment(0, new Float32Array(TL.SEG * 8).fill(0.1));
  ctx.stemAiTick();
  const active = ai.sources[0], future = ai.sources.slice(1);
  ctx.audioContext.currentTime += 0.1; video.currentTime += 0.1;
  for (const rate of [0.5, 1.5, 1, 0.75]) {
    const before = active.mediaAtClock + (ctx.audioContext.currentTime - active.rateAtClock) * active.rate;
    video.playbackRate = rate; ctx.stemAiTick();
    assert.ok(ai.sources.includes(active), 'retain the currently sounding buffer');
    assert.ok(active.nodes.every(n => !n.stopped && n.playbackRate.value === rate));
    assert.ok(Math.abs(active.mediaAtClock - before) < 1e-9, 'rate change must preserve the source sample position');
    assert.equal(ai.pathMix, 'ai');
    const next = ai.sources.find(s => s.startAt > ctx.audioContext.currentTime);
    if (next) {
      assert.ok(Math.abs(next.mediaStart - active.mediaFadeOut) < 1e-6, 'new buffers join at the existing overlap');
      assert.ok(Math.abs(next.mediaFadeInEnd - next.mediaStart - (active.mediaEnd - active.mediaFadeOut)) < 1e-6,
        'crossfade must cover the same source samples after retiming');
    }
    assert.ok(ai.sources.length <= 2, 'dragging must not repeatedly allocate a full 1.5-second future queue');
  }
  assert.ok(future.every(s => s.nodes.every(n => n.stopped)), 'only obsolete future buffers are cancelled');
});

test('audibility guard joins adjacent chunks instead of pulsing back to original at each boundary', () => {
  const { ctx } = graphFixture();
  ctx.getStemState().ai = {
    ready: true, generation: 2,
    sources: [{ startAt: 9.65, generation: 2 }, { startAt: 10.05, generation: 2 }],
  };
  assert.equal(ctx.stemAiAudibleNow(), true, 'combined sources cover the current clock and lookahead');
  ctx.getStemState().ai.sources[1].startAt = 10.3;
  assert.equal(ctx.stemAiAudibleNow(), false, 'a real gap must still fall back');
});

test('raw loop buffers wrap OUT to IN instead of leaking samples outside the selected region', () => {
  const { ctx } = graphFixture();
  const data = new Float32Array(TL.SEG * 8);
  for (let i = 0; i < TL.SEG; i++) data[i] = data[TL.SEG + i] = i / 44100;
  ctx.getStemState().ai = { timeline: new TL.StemTimeline() };
  ctx.getStemState().ai.timeline.addSegment(0, data);
  const result = ctx.stemReadRegion(0, 1.9, 8820, { in: 1, out: 2 });
  assert.ok(Math.abs(result.left[0] - 1.9) < 1e-5);
  assert.equal(result.left[4410], 0, 'loop boundary has a short click-suppression fade');
  assert.ok(Math.abs(result.left[4410 + 150] - (1 + 150 / 44100)) < 1e-5);
  assert.ok(result.left.every(x => x >= 0 && x < 2));
});

test('prepared loop buffers wrap their rendered sample positions at the selected speed', () => {
  const { ctx } = graphFixture();
  const channel = Float32Array.from({ length: 8 * 44100 }, (_, i) => i / 44100 * 0.5);
  const tile = { from: 0, coreEnd: 4, end: 4, channels: [channel] };
  ctx.YTBMPreparedStretch = { TILE_SECONDS: 4 };
  ctx.getStemState().ai = { preparedKeys: new Map([['speed/0', 'tile']]), preparedCache: { get: () => tile } };
  const result = ctx.stemReadPreparedRegion(0, 1.9, 17640, { rate: 0.5, tag: 'speed' }, { in: 1, out: 2 });
  assert.ok(Math.abs(result[0] - 1.9) < 1e-5);
  assert.ok(Math.abs(result[8820]) < 1e-6, 'prepared loop boundary is faded rather than spliced');
  assert.ok(Math.abs(result[8820 + 150] - (1 + 75 / 44100)) < 1e-5);
  assert.ok(result.every(x => x >= 0 && x < 2));
});

test('stem loop scheduling survives a visual seek at OUT without resetting the audio generation', () => {
  const { ctx, video } = graphFixture(), st = ctx.getStemState();
  st.analysisRequested = true; st.mutes.vocals = true; video.currentTime = 1.8; video.duration = 7.8;
  ctx.videoSpeedStretchNode = null;
  const ai = st.ai = { ready: true, mode: 'track', sources: [], generation: 0, schedHorizon: 0,
    timeline: new TL.StemTimeline(), trackAnchor: { vt: 0, cs: 0, csEnd: TL.SEG } };
  ai.timeline.addSegment(0, new Float32Array(TL.SEG * 8).fill(0.1));
  const loop = ctx.regionLoopController = new RegionLoop({ getVideo: () => video, getVideoId: () => 'test',
    setInterval: () => 1, clearInterval() {}, seek() {}, audioTime: () => ctx.audioContext.currentTime });
  loop.change({ in: 1, out: 2, enabled: true });
  ctx.stemAiTick();
  assert.ok(loop.clock); assert.equal(ai.pathMix, 'ai');
  assert.ok(ai.sources.some(s => s.mediaStart < 1.01), 'the next loop head must already be queued');
  const generation = ai.generation;
  ctx.audioContext.currentTime = 10.25; video.currentTime = 1.01; video.seeking = true;
  ctx.stemAiTick();
  assert.equal(ai.generation, generation); assert.equal(ai.pathMix, 'ai');
  assert.ok(ai.sources.every(s => s.region?.in === 1 && s.region?.out === 2));
  loop.dispose();
});

test('live tick with buffered coverage schedules AI audio and gates the muted stem', () => {
  const { ctx, video } = graphFixture();
  const st = ctx.getStemState();
  st.analysisRequested = true;
  st.mutes.vocals = true;
  ctx.updateStemGains();
  video.currentTime = 1.0;
  const data = new Float32Array(TL.SEG * 8).fill(0.5);
  const ai = st.ai = {
    ready: true, mode: 'buffered', pathMix: 'live', sources: [], generation: 0, epoch: 0,
    pending: new Map(), pendingQueue: [], nextId: 1, inFlight: false, worker: null,
    anchor: null, history: [], captureSamples: 0, captureActive: false,
    schedHorizon: 0, lastVt: null, lastClock: 10, pauseReason: null,
    learnedSegs: 2, rsCarry: { frac: 0, prevL: 0, prevR: 0 },
    timeline: new TL.StemTimeline(), trackAnchor: { vt: 0, cs: 0, csEnd: TL.SEG * 2 },
    trackFrames: TL.SEG * 2, trackTotal: 2, requestId: 0,
  };
  ai.timeline.addSegment(0, data);
  ai.timeline.addSegment(1, data);
  ctx.stemAiTick();
  ctx.audioContext.currentTime = 10.2;
  video.currentTime = 1.2;
  ctx.stemAiTick();
  assert.equal(st.ai.pathMix, 'ai', 'tick must leave the bypass path when genuine coverage exists');
  assert.equal(ctx.stemBusInput._direct.gain.value, 0);
  assert.equal(ctx.stemAiGains.vocals.gain.value, 1);
  assert.equal(ctx.stemBranchGains.vocals.gain.value, 0, 'muted stem stays gated on the AI path');
  assert.equal(ctx.stemBranchGains.drums.gain.value, 1);
  assert.ok(st.ai.sources.length > 0, 'scheduler must queue audible AI chunks');
});

test('solo/mute rules run the implementation, including muted solos', () => {
  const { ctx } = graphFixture();
  const st = ctx.getStemState();
  st.solos.drums = true;
  assert.equal(ctx.isStemAudible('drums'), true);
  assert.equal(ctx.isStemAudible('vocals'), false);
  st.mutes.drums = true;
  assert.equal(ctx.isStemAudible('drums'), false);
});

test('scheduler selects the covered historic anchor and stops every scheduled source', () => {
  const { ctx, Node } = graphFixture();
  const ai = ctx.getStemState().ai = {
    anchor: { vt: 20, cs: TL.HOP * 2 }, history: [{ vt: 20, cs: 0, csEnd: TL.SEG }],
    sources: [], schedHorizon: 0, generation: 0,
    timeline: new TL.StemTimeline(),
  };
  const data = new Float32Array(TL.SEG * 8).fill(0.25);
  ai.timeline.addSegment(0, data);
  ctx.stemAiSchedule(20);
  assert.ok(ai.sources.length > 0, 'uses historical coverage rather than uncovered current anchor');
  const sources = ai.sources.flatMap(chunk => chunk.nodes);
  ctx.stemAiStopFuture();
  assert.ok(sources.every(node => node.stopped));
  assert.equal(ai.sources.length, 0);
});

test('seeks discard unfinished capture windows; video changes reject late old inference', () => {
  const { ctx } = graphFixture();
  const ai = ctx.getStemState().ai = {
    queue: new TL.SegmentQueue(), captureSamples: 10000, anchor: { vt: 0, cs: 0 }, history: [],
    sources: [], timeline: new TL.StemTimeline(), pendingQueue: [],
    pending: new Map([[1, { index: 0, epoch: 0 }]]), inFlight: true, epoch: 0, learnedSegs: 0,
  };
  ctx.stemAiBreakRun();
  assert.equal(ai.queue.startFrame, TL.HOP);
  assert.equal(ai.queue.bufFrames, 0);
  ctx.stemAiTeardown(false);
  ctx.stemAiOnWorkerMessage({ type: 'stems', id: 1, data: new Float32Array(TL.SEG * 8) });
  assert.equal(ai.timeline.segments.size, 0);
  assert.equal(ai.inFlight, false);
});

test('exports refuse unanalysed audio rather than exporting frequency bands', () => {
  const { ctx } = graphFixture();
  let downloads = 0;
  ctx.downloadBlob = () => downloads++;
  assert.equal(ctx.exportStem('vocals', 30), false);
  assert.equal(downloads, 0);
});

function storageFixture() {
  const notFound = () => new DOMException('Not found', 'NotFoundError');
  const directories = new Map();
  function directory() {
    const files = new Map();
    return {
      files,
      async getFileHandle(name, options) {
        if (!files.has(name)) { if (!options?.create) throw notFound(); files.set(name, new File([], name)); }
        return {
          async getFile() { return files.get(name); },
          async createWritable() {
            const parts = [];
            return {
              async write(value) { parts.push(value); },
              async close() { files.set(name, new File(parts, name)); },
              async abort() {},
            };
          },
        };
      },
      async removeEntry(name) { if (!files.delete(name)) throw notFound(); },
    };
  }
  const root = {
    async getDirectoryHandle(name, options) {
      if (!directories.has(name)) { if (!options?.create) throw notFound(); directories.set(name, directory()); }
      return directories.get(name);
    },
    async removeEntry(name) { if (!directories.delete(name)) throw notFound(); },
  };
  return { storage: { getDirectory: async () => root }, directories };
}
async function storeFixture(fetcher) {
  const fixture = storageFixture();
  const bytes = new Uint8Array([12, 34, 56, 78]);
  const hash = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const store = new ModelStore(fixture.storage, { bytes: 4, sha256: hash, directory: 'ytbm-stems', filename: 'model.onnx', url: 'https://model.test/model' }, fetcher || (async () => new Response(bytes)));
  return { ...fixture, store, bytes };
}

test('fresh install downloads full verified bytes into extension storage; uninstall erases folder', async () => {
  const { store, directories } = await storeFixture();
  assert.equal((await store.status()).present, false);
  assert.equal((await store.download()).present, true);
  const files = directories.get('ytbm-stems').files;
  assert.equal(files.get('model.onnx').size, 4);
  assert.equal(files.has('model.onnx.part'), false);
  assert.deepEqual(await store.remove(), { ok: true, removed: true, verified: true });
  assert.equal(directories.size, 0);
  assert.equal((await store.status()).present, false);
});

test('same-sized corrupt downloads fail SHA-256 and leave no model or partial file', async () => {
  const { store, directories } = await storeFixture(async () => new Response(new Uint8Array([0, 0, 0, 0])));
  await assert.rejects(store.download(), /checksum/);
  assert.equal((await store.status()).present, false);
  assert.equal(directories.get('ytbm-stems').files.size, 0);
});

test('a new storage manager re-detects the verified file without a flag or another network download', async () => {
  const { store } = await storeFixture();
  await store.download();
  const restored = new ModelStore(store.storage, store.spec, () => { throw new Error('Existing model must not download again'); });
  assert.equal((await restored.status()).present, true);
  assert.equal((await restored.download()).present, true);
});

test('model download resumes a broken response after the last written byte and verifies the whole file', async () => {
  const ranges = [];
  const { store } = await storeFixture(async (url, options) => {
    ranges.push(options.headers.Range);
    if (ranges.length === 1) {
      let reads = 0;
      return new Response(new ReadableStream({ pull(controller) {
        if (reads++ === 0) controller.enqueue(new Uint8Array([12, 34]));
        else controller.error(new TypeError('network error'));
      } }), { status: 206, headers: { 'content-range': 'bytes 0-3/4' } });
    }
    return new Response(new Uint8Array([56, 78]), { status: 206, headers: { 'content-range': 'bytes 2-3/4' } });
  });
  assert.equal((await store.download()).present, true);
  assert.deepEqual(ranges, ['bytes=0-3', 'bytes=2-3']);
});

test('one global download is shared by simultaneous installs', async () => {
  let calls = 0;
  const { store } = await storeFixture(async () => { calls++; return new Response(new Uint8Array([12, 34, 56, 78])); });
  const a = store.download(); const b = store.download();
  assert.equal(a, b);
  await Promise.all([a, b]);
  assert.equal(calls, 1);
});

test('uninstall aborts an active download, waits for cleanup, then verifies deletion', async () => {
  let started;
  const ready = new Promise(resolve => started = resolve);
  const { store, directories } = await storeFixture((url, { signal }) => new Promise((resolve, reject) => {
    started(); signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
  }));
  const download = store.download(); download.catch(() => {});
  await ready;
  assert.equal((await store.remove()).verified, true);
  await assert.rejects(download, { name: 'AbortError' });
  assert.equal(directories.size, 0);
});

test('storage permission errors are reported, never falsely confirmed erased', async () => {
  const store = new ModelStore({ getDirectory: async () => { throw new DOMException('Denied', 'NotAllowedError'); } });
  await assert.rejects(store.remove(), /Denied/);
  await assert.rejects(store.status(), /Denied/);
});

test('timeline planar input, overlapping reconstruction, and seek queue offsets', () => {
  const queue = new TL.SegmentQueue(2);
  const input = new Float32Array(TL.SEG * 2);
  for (let i = 0; i < TL.SEG; i++) { input[i * 2] = 0.25; input[i * 2 + 1] = -0.5; }
  const [segment] = queue.push(input);
  assert.equal(segment.index, 2);
  assert.equal(segment.mix[10], 0.25);
  assert.equal(segment.mix[TL.SEG + 10], -0.5);
  const timeline = new TL.StemTimeline();
  timeline.addSegment(0, new Float32Array(TL.SEG * 8).fill(0.25));
  timeline.addSegment(1, new Float32Array(TL.SEG * 8).fill(0.25));
  const span = timeline.readStem(0, TL.HOP - 100, TL.SEG + 100);
  assert.ok(span.left.every(x => Math.abs(x - 0.25) < 1e-6), 'overlap does not sum twice');
});

test('manifest loads same-origin offscreen engine and local runtime without shipping model', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  assert.ok(manifest.permissions.includes('offscreen'));
  assert.equal(fs.existsSync(path.join(root, 'addons/stems/model/htdemucs_fp16weights.onnx')), false);
  assert.ok(fs.existsSync(path.join(root, 'addons/stems/vendor/ort-wasm-simd-threaded.jsep.wasm')));
  const worker = fs.readFileSync(path.join(root, 'addons/stems/stems-inference-worker.js'), 'utf8');
  assert.ok(!worker.includes('model/htdemucs_fp16weights.onnx'));
  assert.ok(!worker.includes('downloadModel('));
});
