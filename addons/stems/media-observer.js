/* Observe the player's original compressed audio before it reaches MSE. This
 * never replaces, detaches or edits a buffer supplied to the native player. */
(() => {
  if (!globalThis.MediaSource || !globalThis.SourceBuffer || globalThis.__ytbmMediaObserver) return;
  globalThis.__ytbmMediaObserver = true;
  const MAX_CACHE = 8 * 1024 * 1024;
  const sources = new WeakMap(), records = new Set();
  let port = null, enabled = false, caching = true, cached = 0, serial = 0, activeVideoId = null;
  const sourceId = () => `${Date.now()}-${++serial}`;
  const videoId = () => {
    const url = new URL(location.href);
    const id = url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1];
    return id ? `youtube:${id}` : location.href;
  };
  function metadata(record) {
    const video = [...document.querySelectorAll('video')].find(v => !v.classList?.contains('ytbm-cue-deck') &&
      !v.classList?.contains('ytbm-native-vj-feed') && (v.currentSrc || v.src) === record.source.url);
    if (!video) return null;
    let start = 0, end = 0, gap = false;
    try {
      if (record.node.buffered.length) {
        start = record.node.buffered.start(0);
        end = record.node.buffered.end(record.node.buffered.length - 1);
        gap = record.node.buffered.length !== 1 || start > 0.1;
      }
    } catch { return null; }
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    let title = '';
    try { title = document.getElementById('movie_player')?.getPlayerResponse?.()?.videoDetails?.title || document.title || ''; } catch {}
    return { videoId: videoId(), title, stream: record.id, mime: record.mime, start, end, duration,
      complete: !!duration && end >= duration - 0.08, gap };
  }
  function send(record, data) {
    const meta = metadata(record);
    // Initialization bytes can arrive before the MediaSource is attached to
    // its video element. Losing those bytes makes every later decode fail.
    if (!meta) {
      if (!data) return;
      if ((record.deferredBytes || 0) + data.byteLength <= MAX_CACHE) {
        record.deferred.push(data); record.deferredBytes = (record.deferredBytes || 0) + data.byteLength;
      } else record.dropped = true;
      return;
    }
    const chunks = [...record.deferred.splice(0), ...(data ? [data] : [])];
    record.deferredBytes = 0;
    for (const chunk of chunks) {
      const packet = { ...meta, sequence: record.sequence++, buffer: chunk.buffer };
      if (enabled && port && (!activeVideoId || meta.videoId === activeVideoId)) port.postMessage(packet, [chunk.buffer]);
      else if (caching && cached + chunk.byteLength <= MAX_CACHE) {
        record.cache.push(packet); cached += chunk.byteLength;
      } else record.dropped = true;
    }
  }
  function flush(record) {
    const current = metadata(record);
    if (!current || (activeVideoId && current.videoId !== activeVideoId)) return;
    if (record.cache.length && record.cache[0].videoId !== current.videoId) {
      for (const packet of record.cache) cached = Math.max(0, cached - packet.buffer.byteLength);
      record.cache = []; record.dropped = true;
    }
    for (const packet of record.cache.splice(0)) {
      cached = Math.max(0, cached - packet.buffer.byteLength);
      port.postMessage({ ...packet, ...current, gap: packet.gap || current.gap || !!record.dropped }, [packet.buffer]);
    }
    send(record); // Flush headers retained before attachment, even without another append.
  }
  for (const type of ['loadedmetadata', 'loadeddata', 'durationchange', 'canplay']) {
    document.addEventListener?.(type, () => {
      if (enabled && port) for (const record of records) flush(record);
    }, true);
  }
  const createURL = URL.createObjectURL;
  URL.createObjectURL = function (object) {
    const url = createURL.call(this, object);
    if (object instanceof MediaSource) {
      let source = sources.get(object);
      if (!source) { source = {}; sources.set(object, source); }
      source.url = url;
    }
    return url;
  };
  const add = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (mime) {
    const node = add.call(this, mime);
    if (/^audio\//i.test(mime)) {
      let source = sources.get(this);
      if (!source) { source = {}; sources.set(this, source); }
      const record = { id: sourceId(), node, source, mime, pending: [], deferred: [], cache: [], sequence: 0 };
      records.add(record);
      this.addEventListener?.('sourceended', () => { try { send(record, new Uint8Array(0)); } catch {} });
      this.addEventListener?.('sourceclose', () => {
        for (const packet of record.cache) cached = Math.max(0, cached - packet.buffer.byteLength);
        record.cache = []; record.pending = []; record.deferred = [];
        records.delete(record);
      }, { once: true });
      node.addEventListener('updateend', () => {
        for (const data of record.pending.splice(0)) { try { send(record, data); } catch {} }
      });
      node.__ytbmAudioRecord = record;
    }
    return node;
  };
  const append = SourceBuffer.prototype.appendBuffer;
  SourceBuffer.prototype.appendBuffer = function (value) {
    const result = append.call(this, value);
    const record = this.__ytbmAudioRecord;
    if (record && (enabled || caching)) {
      try {
        const bytes = ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
        if (bytes.byteLength <= MAX_CACHE) record.pending.push(bytes.slice());
        else record.dropped = true;
      } catch {}
    }
    return result;
  };
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.type !== 'ytbm-buffered-audio-connect' || !event.ports[0]) return;
    port?.close?.();
    port = event.ports[0];
    port.postMessage({ type: 'connected' });
    port.onmessage = ({ data }) => {
      if (data?.type !== 'active') return;
      enabled = !!data.enabled;
      activeVideoId = data.videoId || null;
      // A normal subscription handoff must keep the next video's early headers.
      // Explicit removal still clears owned cached bytes.
      if (!data.clear) caching = true;
      if (data.clear) {
        caching = false;
        for (const record of records) { record.cache = []; record.pending = []; record.deferred = []; record.deferredBytes = 0; }
        cached = 0;
      }
      if (enabled) {
        for (const record of records) flush(record);
      }
    };
  });
  window.addEventListener('pagehide', () => {
    enabled = false; caching = false; cached = 0;
    for (const record of records) { record.cache = []; record.pending = []; record.deferred = []; }
    records.clear(); port?.close(); port = null;
  });
})();
