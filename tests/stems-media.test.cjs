const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('media observer retains initialization bytes arriving before the video is attached', () => {
  let connect, video = null;
  class SourceBuffer {
    constructor() { this.listeners = {}; this.buffered = { length: 1, start: () => 0, end: () => 10 }; }
    appendBuffer() {}
    addEventListener(type, listener) { this.listeners[type] = listener; }
  }
  class MediaSource { addSourceBuffer() { return new SourceBuffer(); } }
  class TestURL extends URL { static createObjectURL() { return 'blob:audio'; } }
  const window = { addEventListener(type, listener) { if (type === 'message') connect = listener; } };
  const context = { MediaSource, SourceBuffer, URL: TestURL, window,
    location: { href: 'https://www.youtube.com/watch?v=test' },
    document: { querySelectorAll: () => video ? [video] : [] }, Uint8Array, ArrayBuffer };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../addons/stems/media-observer.js'), 'utf8'), context);
  const source = new MediaSource(); TestURL.createObjectURL(source);
  const buffer = source.addSourceBuffer('audio/webm');
  buffer.appendBuffer(new Uint8Array([1, 2])); buffer.listeners.updateend();
  const sent = []; const port = { postMessage: data => { if (data.buffer) sent.push(data); } };
  connect({ source: window, data: { type: 'ytbm-buffered-audio-connect' }, ports: [port] });
  port.onmessage({ data: { type: 'active', enabled: true } });
  video = { currentSrc: 'blob:audio', duration: 10 };
  buffer.appendBuffer(new Uint8Array([3, 4])); buffer.listeners.updateend();
  assert.equal(sent.length, 2);
  assert.deepEqual([...new Uint8Array(sent[0].buffer)], [1, 2]);
  assert.deepEqual([...new Uint8Array(sent[1].buffer)], [3, 4]);
  assert.deepEqual(sent.map(packet => packet.sequence), [0, 1]);
});

function observerFixture() {
  let connect, video = null, serial = 0;
  const events = {};
  class SourceBuffer {
    constructor() { this.listeners = {}; this.buffered = { length: 1, start: () => 0, end: () => 10 }; }
    appendBuffer() {}
    addEventListener(type, listener) { this.listeners[type] = listener; }
  }
  class MediaSource { addSourceBuffer() { return new SourceBuffer(); } }
  class TestURL extends URL { static createObjectURL() { return `blob:audio-${++serial}`; } }
  const window = { addEventListener(type, listener) { if (type === 'message') connect = listener; } };
  const location = { href: 'https://www.youtube.com/watch?v=first' };
  const context = { MediaSource, SourceBuffer, URL: TestURL, window, location,
    document: { querySelectorAll: () => video ? [video] : [], addEventListener: (type, fn) => events[type] = fn }, Uint8Array, ArrayBuffer };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../addons/stems/media-observer.js'), 'utf8'), context);
  const sent = []; const port = { postMessage: packet => { if (packet.buffer) sent.push(packet); } };
  connect({ source: window, data: { type: 'ytbm-buffered-audio-connect' }, ports: [port] });
  return { sent, port, events, location, source() {
    const source = new MediaSource(), url = TestURL.createObjectURL(source), buffer = source.addSourceBuffer('audio/webm');
    return { attach() { video = { currentSrc: url, duration: 10 }; }, append(bytes) {
      buffer.appendBuffer(new Uint8Array(bytes)); buffer.listeners.updateend();
    } };
  } };
}

test('a quiet source flushes pre-attachment headers on metadata readiness without another append', () => {
  const f = observerFixture(), source = f.source();
  source.append([1, 2, 3]);
  f.port.onmessage({ data: { type: 'active', enabled: true, videoId: 'youtube:first' } });
  assert.equal(f.sent.length, 0);
  source.attach(); f.events.loadedmetadata();
  assert.equal(f.sent.length, 1);
  assert.deepEqual([...new Uint8Array(f.sent[0].buffer)], [1, 2, 3]);
  assert.equal(f.sent[0].sequence, 0);
  f.events.canplay(); assert.equal(f.sent.length, 1, 'readiness events do not duplicate audio');
});

test('same-tab navigation retains the next song header until its subscription is ready', () => {
  const f = observerFixture(), first = f.source();
  first.attach();
  f.port.onmessage({ data: { type: 'active', enabled: true, videoId: 'youtube:first' } });
  first.append([1]); assert.equal(f.sent.length, 1);
  f.location.href = 'https://www.youtube.com/watch?v=second';
  const second = f.source(); second.attach(); second.append([2, 3]);
  assert.equal(f.sent.length, 1, 'new song must not be consumed by the old subscriber');
  f.port.onmessage({ data: { type: 'active', enabled: false, videoId: 'youtube:first' } });
  f.port.onmessage({ data: { type: 'active', enabled: true, videoId: 'youtube:second' } });
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[1].sequence, 0);
  assert.equal(f.sent[1].videoId, 'youtube:second');
  assert.deepEqual([...new Uint8Array(f.sent[1].buffer)], [2, 3]);
});

test('isolated bridge retries a missed initial handshake and preserves the current subscription', () => {
  let retry, cleared = false;
  const channels = [], window = { postMessage() {}, addEventListener() {} };
  class MessageChannel {
    constructor() {
      this.sent = []; this.port1 = { close() {}, postMessage: data => this.sent.push(data) }; this.port2 = {};
      channels.push(this);
    }
  }
  const context = { MessageChannel, window, location: { origin: 'https://www.youtube.com' },
    setInterval: fn => { retry = fn; return 1; }, clearInterval: () => cleared = true, ArrayBuffer };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../addons/stems/media-bridge.js'), 'utf8'), context);
  let received = 0;
  context.YTBMBufferedAudio.subscribe(() => received++, { videoId: 'youtube:second' });
  retry(); assert.equal(channels.length, 2);
  channels[1].port1.onmessage({ data: { type: 'connected' } });
  assert.equal(cleared, true);
  assert.equal(channels[1].sent.at(-1).enabled, true);
  assert.equal(channels[1].sent.at(-1).videoId, 'youtube:second');
  channels[1].port1.onmessage({ data: { buffer: new ArrayBuffer(4) } });
  assert.equal(received, 1);
});
