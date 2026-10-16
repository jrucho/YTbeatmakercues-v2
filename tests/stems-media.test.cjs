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
  const sent = []; const port = { postMessage: data => sent.push(data) };
  connect({ source: window, data: { type: 'ytbm-buffered-audio-connect' }, ports: [port] });
  port.onmessage({ data: { type: 'active', enabled: true } });
  video = { currentSrc: 'blob:audio', duration: 10 };
  buffer.appendBuffer(new Uint8Array([3, 4])); buffer.listeners.updateend();
  assert.equal(sent.length, 2);
  assert.deepEqual([...new Uint8Array(sent[0].buffer)], [1, 2]);
  assert.deepEqual([...new Uint8Array(sent[1].buffer)], [3, 4]);
  assert.deepEqual(sent.map(packet => packet.sequence), [0, 1]);
});
