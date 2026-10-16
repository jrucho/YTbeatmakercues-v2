/* Compressed whole-track preloading is independent of model initialization. */
(function (root) {
  const MAX_BYTES = 64 * 1024 * 1024;
  const MAX_SECONDS = 600;
  function mediaURL(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('No downloadable audio source');
    const google = /(^|\.)googlevideo\.com$/.test(url.hostname);
    if (!google && !['www.youtube.com', 'www.youtube-nocookie.com', 'samplette.io'].includes(url.hostname)) {
      throw new Error('Audio source is not accessible to this extension');
    }
    if (url.searchParams.has('sq') || url.searchParams.get('live') === '1') throw new Error('Live segments cannot be preloaded as a song');
    if (google && !(url.searchParams.get('sparams') || '').split(',').includes('range')) url.searchParams.delete('range');
    return url;
  }
  async function fetchTrack(source, signal, progress, fetcher = (...args) => fetch(...args)) {
    const url = mediaURL(source);
    const hinted = Number(url.searchParams.get('clen')) || 0;
    if (hinted > MAX_BYTES) throw new Error('Track is too large for whole-song preloading');
    const chunks = [];
    let received = 0, total = hinted;
    for (let request = 0; request < 256; request++) {
      const requestURL = new URL(url);
      if (received && /(^|\.)googlevideo\.com$/.test(url.hostname)) requestURL.searchParams.set('range', `${received}-`);
      const response = await fetcher(requestURL.href, { signal, cache: 'no-store', headers: { Range: `bytes=${received}-` } });
      if (!response.ok || !response.body) throw new Error('Full audio download unavailable');
      if (/^(?:text\/)|json/i.test(response.headers.get('content-type') || '')) {
        await response.body.cancel().catch(() => {});
        throw new Error('The audio server did not return media');
      }
      const range = (response.headers.get('content-range') || '').match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if (range) {
        if (Number(range[1]) !== received) throw new Error('Audio server returned a non-contiguous range');
        total = Number(range[3]);
      } else if (received) throw new Error('Audio server did not support remaining ranges');
      else total = total || Number(response.headers.get('content-length')) || 0;
      if (total > MAX_BYTES) {
        await response.body.cancel().catch(() => {});
        throw new Error('Track is too large for whole-song preloading');
      }
      const before = received;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (signal.aborted) throw new DOMException('Track loading cancelled', 'AbortError');
          if (done) break;
          received += value.byteLength;
          if (received > MAX_BYTES || (total && received > total)) throw new Error('Unexpected audio download size');
          chunks.push(value);
          progress?.({ received, total });
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      if (received === before) throw new Error('Empty audio range');
      if (!total || received === total) {
        const bytes = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return bytes;
      }
      if (range && Number(range[2]) + 1 !== received) throw new Error('Incomplete audio range');
    }
    throw new Error('Audio download has too many incomplete ranges');
  }
  class TrackStore {
    constructor(options = {}) {
      this.entries = new Map();
      this.fetcher = options.fetcher;
      this.decoder = options.decoder || (bytes => new OfflineAudioContext(2, 1, 44100).decodeAudioData(bytes.buffer));
    }
    info(entry) {
      return { status: entry.status, bytes: entry.received || 0, total: entry.total || 0, duration: entry.audio?.duration || 0,
        error: entry.status === 'unavailable' ? entry.error || null : null };
    }
    preload(key, id, sources, notify = () => {}, expectedDuration = 0, metadata = {}) {
      const existing = this.entries.get(key);
      if (existing?.id === id && ['loading', 'ready'].includes(existing.status)) return this.info(existing);
      this.clear(key);
      const entry = { id, expectedDuration, metadata, status: sources.length ? 'loading' : 'unavailable', abort: new AbortController(), received: 0, total: 0 };
      this.entries.set(key, entry);
      if (!sources.length) return this.info(entry);
      entry.promise = (async () => {
        const timeout = setTimeout(() => entry.abort.abort(), 60000);
        try {
          for (const source of sources) {
            try {
              entry.bytes = await fetchTrack(source, entry.abort.signal, p => {
                Object.assign(entry, p);
                if (this.entries.get(key) === entry && Date.now() - (entry.postedAt || 0) > 400) {
                  entry.postedAt = Date.now();
                  notify(this.info(entry));
                }
              }, this.fetcher);
              if (this.entries.get(key) !== entry || entry.abort.signal.aborted) throw new DOMException('Video session closed', 'AbortError');
              if (this.downloads) entry.downloadPath = await this.downloads.save(`${key}/track/${id}`,
                { ...metadata, complete: true, decoded: false, expectedDuration }, entry.bytes);
              if (this.entries.get(key) !== entry || entry.abort.signal.aborted) {
                await this.downloads?.clear(`${key}/track/${id}`);
                throw new DOMException('Video session closed', 'AbortError');
              }
              entry.status = 'ready';
              return;
            } catch (error) {
              if (entry.abort.signal.aborted) throw error;
              entry.error = error.message;
            }
          }
          entry.status = 'unavailable';
        } catch { entry.status = 'unavailable'; }
        finally {
          clearTimeout(timeout);
          if (entry.status === 'unavailable') await this.downloads?.clear(`${key}/track/${id}`);
          if (this.entries.get(key) === entry) notify(this.info(entry));
        }
      })();
      return this.info(entry);
    }
    async open(key, id) {
      const entry = this.entries.get(key);
      if (!entry || entry.id !== id) throw new Error('Whole-song audio is not available');
      if (entry.promise) await entry.promise;
      if (this.entries.get(key) !== entry || entry.status !== 'ready') throw new Error('Whole-song audio is not available');
      if (!entry.decoding) entry.decoding = (async () => {
        const audio = await this.decoder(entry.bytes);
        if (this.entries.get(key) !== entry) throw new Error('Video changed during audio decoding');
        if (audio.sampleRate !== 44100 || !audio.length || !Number.isFinite(audio.duration) || audio.duration > MAX_SECONDS) {
          throw new Error('Whole-song audio exceeds the supported ten-minute limit');
        }
        if (entry.expectedDuration && Math.abs(audio.duration - entry.expectedDuration) > Math.max(1.5, entry.expectedDuration * 0.005)) {
          throw new Error('Audio source does not match the current song duration');
        }
        entry.audio = audio; entry.bytes = null;
        return audio;
      })().catch(async error => {
        entry.audio = null; entry.bytes = null; entry.status = 'unavailable';
        await this.downloads?.clear(`${key}/track/${id}`);
        throw error;
      });
      const audio = await entry.decoding;
      return { frames: audio.length, duration: audio.duration };
    }
    segment(key, id, index) {
      const entry = this.entries.get(key);
      if (entry?.id !== id || !entry.audio) throw new Error('Whole-song audio is not decoded');
      const { SEG, HOP } = root.YTBMStemTimeline;
      const from = index * HOP;
      if (!Number.isInteger(index) || index < 0 || from >= entry.audio.length) throw new Error('Invalid song segment');
      const validLength = Math.min(SEG, entry.audio.length - from);
      const mix = new Float32Array(2 * SEG);
      const left = entry.audio.getChannelData(0);
      const right = entry.audio.getChannelData(Math.min(1, entry.audio.numberOfChannels - 1));
      mix.set(left.subarray(from, from + validLength));
      mix.set(right.subarray(from, from + validLength), SEG);
      return { mix, validLength };
    }
    clear(key, id) {
      if (id && this.entries.get(key)?.id !== id) return;
      this.entries.get(key)?.abort.abort();
      this.entries.delete(key);
    }
    clearTab(tabId) { for (const key of [...this.entries.keys()]) if (key.startsWith(tabId + ':')) this.clear(key); }
    clearAll() { for (const key of [...this.entries.keys()]) this.clear(key); }
  }
  root.YTBMTrackStore = { TrackStore, fetchTrack, mediaURL, MAX_BYTES, MAX_SECONDS };
  if (typeof module !== 'undefined') module.exports = root.YTBMTrackStore;
})(globalThis);
