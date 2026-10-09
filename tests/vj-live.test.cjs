const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function liveFixture() {
  const env = { now: 0, timers: new Map(), tracksStopped: 0, messages: [] };
  const track = { kind: 'video', readyState: 'live', stop() { this.readyState = 'ended'; env.tracksStopped++; } };
  class Stream {
    constructor(tracks) { this.tracks = tracks; }
    getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
    getTracks() { return this.tracks; }
  }
  class Peer {
    constructor(options) { this.options = options; this.connectionState = 'connecting'; this.signalingState = 'stable'; this.parameters = { encodings: [{}] }; }
    addTrack(track) { this.track = track; return { getParameters: () => this.parameters, setParameters: async p => { this.parameters = p; } }; }
    async createOffer() { return { type: 'offer', sdp: 'test' }; }
    async createAnswer() { return { type: 'answer', sdp: 'test' }; }
    async setLocalDescription(description) { this.localDescription = { ...description, toJSON: () => description }; }
    async setRemoteDescription(description) { this.remoteDescription = description; }
    async addIceCandidate(candidate) { this.lastIce = candidate; }
    async getStats() { return new Map([['video', { type: 'inbound-rtp', kind: 'video', framesDecoded: this.decoded || 0, framesDropped: 0, timestamp: env.now }]]); }
    close() { this.connectionState = 'closed'; this.signalingState = 'closed'; }
  }
  const context = {
    module: { exports: {} },
    Date: class extends Date { static now() { return env.now; } },
    BroadcastChannel: class { postMessage(message) { env.messages.push(message); } close() { this.closed = true; } },
    RTCPeerConnection: Peer, MediaStream: Stream,
    setInterval(fn) { env.timers.set(1, fn); return 1; }, clearInterval(id) { env.timers.delete(id); },
    document: {
      body: { appendChild() {} },
      createElement() { return { style: {}, readyState: 4, setAttribute() {}, play: async () => {}, pause() {}, remove() { this.removed = true; } }; }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'vj-live.js'), 'utf8'), context);
  const video = { readyState: 4, currentSrc: 'local', videoWidth: 1920, videoHeight: 1080, paused: false, captureStream: () => new Stream([track]) };
  const options = { id: 'local', getVideo: () => video, getPriority: () => 1, getEpoch: () => 0, getLimits: () => ({ width: 960, height: 540 }) };
  const live = new context.module.exports(options);
  return { env, live, options, video, track };
}

test('native VJ elects one output and prefers the visible monitor over a source tab', async () => {
  const { live, env } = liveFixture();
  live.start();
  assert.equal(live.isReceiver(), true);
  await live.receive({ type: 'hello', from: 'monitor', priority: 2, epoch: 1, ready: false });
  assert.equal(live.receiverId, 'monitor');
  assert.equal(live.isReceiver(), false);
  await live.receive({ type: 'bye', from: 'monitor' });
  assert.equal(live.isReceiver(), true);
  live.stop();
  assert.equal(env.timers.size, 0);
});

test('selected-feed demand is bounded and video-only encoding has local ICE and 30 fps limits', async () => {
  const { live, options, env } = liveFixture();
  options.getPriority = () => 0;
  live.start();
  await live.receive({ type: 'hello', from: 'monitor', priority: 2, epoch: 1, ready: false });
  await live.receive({ type: 'request', from: 'monitor', to: 'local', session: 'session1', limits: { width: 960, height: 540 } });
  const connection = live.connections.get('send:monitor');
  assert.equal(connection.pc.track.kind, 'video');
  assert.equal(connection.pc.options.iceServers.length, 0);
  assert.equal(connection.pc.parameters.encodings[0].maxFramerate, 30);
  assert.equal(connection.pc.parameters.encodings[0].scaleResolutionDownBy, 2);
  assert.ok(env.messages.some(m => m.type === 'offer'));
  assert.ok(env.messages.every(m => !m.frame), 'frame bitmaps must not travel through the signaling channel');
  connection.pc.connectionState = 'connected';
  assert.equal(live.hasNativeSender(), true);
  live.stop();
  assert.equal(env.tracksStopped, 1);
});

test('stale connection callbacks cannot close a newer negotiation session', () => {
  const { live } = liveFixture();
  live.start();
  const old = live.createConnection('receive', 'source', 'old');
  live.closeConnection('receive:source');
  const current = live.createConnection('receive', 'source', 'new');
  live.closeConnection('receive:source', old);
  assert.equal(live.connections.get('receive:source'), current);
  assert.equal(current.pc.connectionState, 'connecting');
  live.stop();
});

test('native VJ removes stalled streams and their hidden video elements, but keeps deliberately paused feeds', async () => {
  const { env, live } = liveFixture();
  live.start();
  live.peers.set('source', { paused: false });
  const connection = live.createConnection('receive', 'source', 'session');
  connection.pc.ontrack({ track: { kind: 'video' } });
  const feed = live.videos.get('source');
  connection.pc.connectionState = 'connected';
  env.now = 9000;
  await live.collectStats();
  assert.equal(live.videos.size, 0);
  assert.equal(feed.video.removed, true);
  live.peers.set('source', { paused: true });
  const paused = live.createConnection('receive', 'source', 'paused');
  paused.pc.ontrack({ track: { kind: 'video' } });
  paused.pc.connectionState = 'connected';
  env.now += 9000;
  await live.collectStats();
  assert.equal(live.videos.size, 1);
  live.stop();
});

test('only demanded feeds are negotiated; record-only receivers can join without taking over the monitor', async () => {
  const { live, options, env } = liveFixture();
  options.getSources = () => ['local', 'wanted'];
  live.start();
  await live.receive({ type: 'hello', from: 'unwanted', priority: 0, ready: true });
  assert.equal(live.connections.has('receive:unwanted'), false);
  await live.receive({ type: 'hello', from: 'wanted', priority: 0, ready: true });
  assert.equal(live.connections.has('receive:wanted'), true);
  await live.receive({ type: 'hello', from: 'monitor', priority: 2, epoch: 1, ready: false });
  options.getRecording = () => true;
  live.tick();
  assert.equal(live.receiverId, 'monitor');
  assert.equal(live.connections.has('receive:wanted'), true);
  assert.ok(env.messages.some(m => m.type === 'hello' && m.recording));
  live.stop();
});

function workerFixture(state = {}) {
  const updates = [], power = [];
  const tabs = [
    { id: 1, index: 0, windowId: 10, url: 'https://www.youtube.com/watch?v=one', autoDiscardable: true },
    { id: 2, index: 1, windowId: 10, url: 'https://www.youtube.com/watch?v=two', autoDiscardable: false }
  ];
  const event = () => ({ addListener(fn) { this.handler = fn; } });
  const chrome = {
    storage: { session: { get: async () => structuredClone(state), set: async value => Object.assign(state, structuredClone(value)) } },
    power: { requestKeepAwake: kind => power.push(kind), releaseKeepAwake: () => power.push('released') },
    runtime: { onMessage: event() },
    tabs: {
      get: async id => tabs.find(t => t.id === id), query: async () => tabs,
      update: async (id, change) => { updates.push({ id, ...change }); Object.assign(tabs.find(t => t.id === id), change); },
      sendMessage: async () => {},
      onMoved: event(), onAttached: event(), onDetached: event(), onRemoved: event(), onUpdated: event()
    }
  };
  const context = { chrome, URL, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context);
  const message = (msg, tab = tabs[0], frameId = 0) => new Promise(resolve => chrome.runtime.onMessage.handler(msg, { tab, frameId }, resolve));
  return { state, updates, power, tabs, context, message };
}

test('VJ performance protection restores each tab’s original discard setting and releases sleep protection', async () => {
  const f = workerFixture();
  await f.message({ type: 'ytbm-vj-performance', active: true });
  await f.message({ type: 'ytbm-vj-performance', active: true }, f.tabs[1]);
  assert.ok(f.power.includes('display'));
  assert.equal(f.tabs[0].autoDiscardable, false);
  await f.message({ type: 'ytbm-vj-performance', active: false });
  assert.equal(f.tabs[0].autoDiscardable, true);
  await f.message({ type: 'ytbm-vj-performance', active: false }, f.tabs[1]);
  assert.equal(f.tabs[1].autoDiscardable, false);
  assert.equal(f.power.at(-1), 'released');
});

test('tab registration/order survives service-worker restart and ignores nested YouTube frame duplicates', async () => {
  const state = {};
  const first = workerFixture(state);
  await first.message({ type: 'ytbm-register-tab', ytbmTabId: 'one' });
  await first.message({ type: 'ytbm-register-tab', ytbmTabId: 'two' }, first.tabs[1]);
  const nested = await first.message({ type: 'ytbm-register-tab', ytbmTabId: 'iframe' }, first.tabs[0], 3);
  assert.equal(nested.ok, false);
  const restarted = workerFixture(state);
  const order = await restarted.message({ type: 'ytbm-get-tab-order' });
  assert.deepEqual(Array.from(order.order), ['one', 'two']);
  assert.equal(restarted.context.isVideoTabUrl('https://notyoutube.com.evil.example'), false);
});
