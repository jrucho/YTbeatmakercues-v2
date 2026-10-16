const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const TL = require('../addons/stems/stem-timeline.js');
const { TrackStore, fetchTrack, MAX_BYTES } = require('../addons/stems/track-store.js');
globalThis.YTBMStemTimeline = TL;

test('full-track plan covers every sample exactly through the final padded window, starting near the playhead', () => {
  for (const frames of [1, TL.HOP, TL.SEG, TL.SEG + 1, 44100 * 600]) {
    const plan = TL.planTrack(frames, 100);
    assert.equal(new Set(plan.map(s => s.index)).size, plan.length);
    let end = 0;
    for (const segment of plan.slice().sort((a, b) => a.index - b.index)) {
      assert.ok(segment.index * TL.HOP <= end);
      end = segment.index * TL.HOP + segment.validLength;
    }
    assert.equal(end, frames);
    assert.ok(plan.length <= 96);
  }
});

test('capture flushing separates short clips and the final tail without treating padding as song audio', () => {
  const short = new TL.SegmentQueue();
  short.push(new Float32Array(44100 * 2));
  const [window] = short.flush();
  assert.equal(window.validLength, 44100);
  assert.equal(window.mix.length, TL.SEG * 2);
  assert.equal(short.flush().length, 0);
  const exact = new TL.SegmentQueue();
  exact.push(new Float32Array(TL.SEG * 2));
  assert.equal(exact.flush().length, 0, 'already covered overlap is not inferred twice');
  const tail = new TL.SegmentQueue();
  tail.push(new Float32Array((TL.SEG + 1000) * 2));
  assert.equal(tail.flush()[0].validLength, TL.OVERLAP + 1000);
});

test('preload stores encoded audio without decoding or running a model; decoding waits for open', async () => {
  let fetches = 0, decodes = 0;
  const left = new Float32Array(441000).fill(0.2);
  const store = new TrackStore({
    fetcher: async () => { fetches++; return new Response(new Uint8Array([1, 2, 3])); },
    decoder: async () => { decodes++; return { length: left.length, duration: 10, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => left }; },
  });
  assert.equal(store.preload('1:0', 'song', ['https://www.youtube.com/audio.wav']).status, 'loading');
  await store.entries.get('1:0').promise;
  assert.equal(fetches, 1); assert.equal(decodes, 0);
  assert.equal(store.preload('1:0', 'song', []).status, 'ready');
  assert.deepEqual(await store.open('1:0', 'song'), { frames: 441000, duration: 10 });
  await store.open('1:0', 'song');
  assert.equal(decodes, 1);
  const segment = store.segment('1:0', 'song', 1);
  assert.equal(segment.validLength, 441000 - TL.HOP);
  assert.equal(segment.mix[TL.SEG - 1], 0, 'tail is padded, not treated as real audio');
  assert.equal(segment.mix[0], segment.mix[TL.SEG], 'mono is copied to both channels');
  store.clear('1:0', 'previous-song');
  assert.equal(store.entries.size, 1, 'late cleanup cannot erase the replacement song');
  store.clearTab(1); assert.equal(store.entries.size, 0);
});

test('partial audio ranges are assembled contiguously into the complete file', async () => {
  const requests = [];
  const result = await fetchTrack('https://media.googlevideo.com/videoplayback?range=0-1&clen=4', new AbortController().signal, null,
    async (url, options) => {
      requests.push({ url, range: options.headers.Range });
      return requests.length === 1
        ? new Response(new Uint8Array([1, 2]), { status: 206, headers: { 'content-range': 'bytes 0-1/4' } })
        : new Response(new Uint8Array([3, 4]), { status: 206, headers: { 'content-range': 'bytes 2-3/4' } });
    });
  assert.deepEqual([...result], [1, 2, 3, 4]);
  assert.equal(new URL(requests[0].url).searchParams.has('range'), false);
  assert.equal(requests[1].range, 'bytes=2-');
});

test('invalid, incomplete and overlarge audio responses never report full-song readiness', async () => {
  await assert.rejects(fetchTrack('blob:video', new AbortController().signal), /downloadable/);
  await assert.rejects(fetchTrack('https://media.googlevideo.com/a?clen=' + (MAX_BYTES + 1), new AbortController().signal), /too large/);
  await assert.rejects(fetchTrack('https://www.youtube.com/a', new AbortController().signal, null,
    async () => new Response(new Uint8Array([1]), { status: 206, headers: { 'content-range': 'bytes 10-10/12' } })), /non-contiguous/);
  const store = new TrackStore({ fetcher: async () => new Response('', { status: 403 }) });
  store.preload('1:0', 'song', ['https://www.youtube.com/audio']);
  await store.entries.get('1:0').promise;
  assert.equal(store.entries.get('1:0').status, 'unavailable');
  await assert.rejects(store.open('1:0', 'song'), /not available/);
});

test('video change aborts loading, drops song bytes, and rejects late decoding', async () => {
  let finishDecode;
  const store = new TrackStore({ fetcher: async () => new Response(new Uint8Array([1])), decoder: () => new Promise(r => finishDecode = r) });
  store.preload('1:0', 'old', ['https://www.youtube.com/audio']);
  await store.entries.get('1:0').promise;
  const opening = store.open('1:0', 'old');
  await Promise.resolve(); await Promise.resolve();
  store.clear('1:0');
  finishDecode({ length: 44100, duration: 1, sampleRate: 44100 });
  await assert.rejects(opening, /Video changed/);
  assert.equal(store.entries.size, 0);
});

test('short decoded responses cannot be mistaken for complete songs', async () => {
  const store = new TrackStore({ fetcher: async () => new Response(new Uint8Array([1])),
    decoder: async () => ({ sampleRate: 44100, length: 44100 * 10, duration: 10 }) });
  store.preload('1:0', 'song', ['https://www.youtube.com/audio'], () => {}, 180);
  await store.entries.get('1:0').promise;
  await assert.rejects(store.open('1:0', 'song'), /does not match/);
});

test('source discovery uses current audio URLs, excludes old-video resources and never changes playback', () => {
  const context = {
    URL, module: { exports: {} },
    window: { ytInitialPlayerResponse: { videoDetails: { videoId: 'current', lengthSeconds: '120' }, streamingData: { adaptiveFormats: [
      { mimeType: 'video/mp4', url: 'https://video.googlevideo.com/video' },
      { mimeType: 'audio/webm', url: 'https://media.googlevideo.com/audio', bitrate: 128000 },
    ] } } },
    document: { querySelector: () => ({ currentSrc: 'blob:current' }), getElementById: () => null },
    performance: { getEntriesByType: () => [{ startTime: 1, name: 'https://old.googlevideo.com/videoplayback?mime=audio/webm' }] },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../addons/stems/track-source.js'), 'utf8'), context);
  const result = context.module.exports.discover('current', 5);
  assert.deepEqual(Array.from(result.sources), ['https://media.googlevideo.com/audio']);
  assert.equal(result.duration, 120);
  assert.equal(context.module.exports.discover('new-video', 5).sources.length, 0);
});

test('late preload and init requests cannot recreate song data or workers after uninstall', async () => {
  let handler, finishStatus, preloads = 0, cleared = 0;
  let status = () => new Promise(resolve => finishStatus = resolve);
  const context = {
    YTBMModelStore: { ModelStore: class {
      async discardPartial() {}
      status() { return status(); }
      async remove() { return { ok: true, verified: true }; }
    } },
    YTBMTrackStore: { TrackStore: class {
      preload() { preloads++; return { status: 'loading' }; }
      clearAll() { cleared++; }
    } },
    YTBMBufferedAudioStore: { BufferedAudioStore: class {
      constructor() { this.entries = new Map(); }
      clearAll() {}
      clearTab() {}
    } },
    YTBMInferenceHost: { InferenceHost: require('../addons/stems/inference-host.js').InferenceHost },
    YTBMSessionDownloads: { SessionDownloads: class {
      constructor() { this.entries = new Map(); }
      async clearAll() {}
    } },
    YTBMResourceStorage: { inspect: async () => ({ opfsBytes: 0, indexedDB: [], cacheStorage: [] }), removeLegacyStores: async () => {} },
    chrome: { runtime: { id: 'test', onMessage: { addListener: fn => handler = fn }, sendMessage: async () => ({ ok: true }) } },
    Worker: class { constructor() { throw new Error('An uninstalled model must not create a worker'); } },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../addons/stems/offscreen.js'), 'utf8'), context);
  const request = msg => new Promise(resolve => handler({ target: 'ytbm-stems-host', tabId: 1, frameId: 0, ...msg }, { id: 'test' }, resolve));
  const pending = request({ type: 'ytbm-stems-track-preload', track: 'old', sourceInfo: { sources: ['https://www.youtube.com/audio'] } });
  while (!finishStatus) await Promise.resolve();
  assert.equal((await request({ type: 'ytbm-stems-model-remove' })).verified, true);
  finishStatus({ present: true });
  assert.equal((await pending).ok, false);
  assert.equal(preloads, 0); assert.equal(cleared, 1);
  status = async () => ({ present: false });
  const init = await request({ type: 'ytbm-stems-engine-request', message: { type: 'init' } });
  assert.equal(init.ok, false);
  assert.match(init.error, /not installed/);
});
