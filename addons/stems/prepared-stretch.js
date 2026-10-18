/* Bounded, ahead-of-playback stretch tiles. No live processor on the ready path. */
(function (root) {
  function planTile({ segments, trackFrames, index, rate, sampleRate = 44100, hop = 310905, priority = 0 }) {
    const size = 4 * sampleRate, nominalStart = index * size;
    const nominalEnd = Math.min(nominalStart + size, trackFrames), ranges = [];
    for (const [key, segment] of [...segments].sort((a, b) => a[0] - b[0])) {
      const from = key * hop, end = Math.min(trackFrames, from + segment.validLength);
      if (!(end > from)) continue;
      const previous = ranges[ranges.length - 1];
      if (previous && from <= previous.end) previous.end = Math.max(previous.end, end);
      else ranges.push({ from, end });
    }
    const candidates = ranges.filter(range => range.from < nominalEnd && range.end > nominalStart);
    const range = candidates.find(range => priority >= range.from && priority < range.end) || candidates[0];
    if (!range) return null;
    const from = Math.max(nominalStart, range.from), coreEnd = Math.min(nominalEnd, range.end);
    if (coreEnd - from < 64) return null;
    const end = Math.min(coreEnd + Math.ceil(0.08 * sampleRate), range.end);
    const pad = Math.ceil(0.4 * sampleRate * Math.max(1, rate));
    return { from, coreEnd, end, readFrom: Math.max(range.from, from - pad), readEnd: Math.min(range.end, end + pad) };
  }
  async function render({ channels, sampleRate, rate, tune, config, offset, frames, moduleURL }) {
    const extra = Math.ceil((config.blockMs + config.intervalMs) * sampleRate / 1000) + 256;
    const context = new OfflineAudioContext(channels.length, Math.ceil(channels[0].length / rate) + extra, sampleRate);
    await context.audioWorklet.addModule(moduleURL);
    const processors = [];
    try {
      const merger = context.createChannelMerger(channels.length);
      merger.connect(context.destination);
      let latency = 0;
      // Each stem is an independent stereo signal, not an eight-channel spatial
      // recording. Separate phase analysis prevents another stem's transients
      // from steering a quiet bass/vocal channel's pitch reconstruction.
      for (let first = 0; first < channels.length; first += 2) {
        const count = Math.min(2, channels.length - first);
        const node = new AudioWorkletNode(context, 'signalsmith-stretch', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [count], channelCount: count, channelCountMode: 'explicit',
        });
        const pending = new Map(); let serial = 0;
        processors.push({ node, pending });
        const wait = id => new Promise((resolve, reject) => {
          const timer = setTimeout(() => { pending.delete(id); reject(new Error('Prepared stretch initialization timed out')); }, 10000);
          pending.set(id, { resolve, reject, timer });
        });
        node.port.onmessage = ({ data }) => {
          const entry = pending.get(data[0]);
          if (entry) { pending.delete(data[0]); clearTimeout(entry.timer); entry.resolve(data[1]); }
        };
        const call = (method, ...args) => {
          const id = serial++, result = wait(id); node.port.postMessage([id, method, ...args]); return result;
        };
        await wait('ready');
        await call('configure', config);
        latency = await call('latency');
        await call('schedule', { active: true, semitones: tune - 12 * Math.log2(rate),
          tonalityHz: sampleRate, formantSemitones: 0, formantCompensation: false });
        const input = context.createBuffer(count, channels[0].length, sampleRate);
        for (let channel = 0; channel < count; channel++) input.copyToChannel(channels[first + channel], channel);
        const source = context.createBufferSource(), splitter = context.createChannelSplitter(count);
        source.buffer = input; source.playbackRate.value = rate;
        source.connect(node); node.connect(splitter);
        for (let channel = 0; channel < count; channel++) splitter.connect(merger, channel, first + channel);
        source.start(0);
      }
      const output = await context.startRendering();
      const start = Math.round(latency * sampleRate + offset / rate);
      const length = Math.round(frames / rate);
      if (start + length > output.length) throw new Error('Prepared stretch output is incomplete');
      return { channels: Array.from({ length: channels.length }, (_, i) => output.getChannelData(i).slice(start, start + length)),
        sampleRate, rate, tune, sourceFrames: frames };
    } finally {
      for (const { node, pending } of processors) {
        for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Prepared stretch closed')); }
        node.disconnect(); node.port.close();
      }
    }
  }

  class Cache {
    constructor(renderer = render, maxBytes = 96 * 1024 * 1024) {
      this.renderer = renderer; this.maxBytes = maxBytes; this.bytes = 0;
      this.entries = new Map(); this.jobs = new Map(); this.queue = []; this.active = false;
      this.target = null; this.closed = false;
    }
    setTarget(target, retained = null) {
      if (this.target === target && this.retained === retained) return;
      this.target = target; this.retained = retained;
      this.queue = this.queue.filter(job => {
        if (job.target === target || job.target === retained) return true;
        this.jobs.delete(job.key); job.resolve(null); return false;
      });
    }
    get(key) {
      const entry = this.entries.get(key);
      if (entry) { this.entries.delete(key); this.entries.set(key, entry); }
      return entry?.value || null;
    }
    request(key, target, load) {
      if (this.closed || (target !== this.target && target !== this.retained)) return Promise.resolve(null);
      const cached = this.get(key); if (cached) return Promise.resolve(cached);
      if (this.jobs.has(key)) return this.jobs.get(key).promise;
      const job = { key, target, load };
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      this.jobs.set(key, job); this.queue.push(job); this.pump(); return job.promise;
    }
    async pump() {
      if (this.active || this.closed) return;
      const job = this.queue.shift(); if (!job) return;
      this.active = true;
      try {
        const args = job.load();
        const value = args ? await this.renderer(args) : null;
        if (!this.closed && (job.target === this.target || job.target === this.retained) && value) {
          const bytes = value.channels.reduce((sum, channel) => sum + channel.byteLength, 0);
          if (bytes <= this.maxBytes) {
            while (this.bytes + bytes > this.maxBytes && this.entries.size) {
              const key = this.entries.keys().next().value;
              this.bytes -= this.entries.get(key).bytes; this.entries.delete(key);
            }
            this.entries.set(job.key, { value, bytes }); this.bytes += bytes;
          }
          job.resolve(value);
        } else job.resolve(null);
      } catch (error) { job.reject(error); }
      finally { this.jobs.delete(job.key); this.active = false; this.pump(); }
    }
    close() {
      this.closed = true; this.entries.clear(); this.bytes = 0;
      for (const job of this.queue.splice(0)) { this.jobs.delete(job.key); job.resolve(null); }
    }
  }
  root.YTBMPreparedStretch = { Cache, render, planTile, TILE_SECONDS: 4, PAD_SECONDS: 0.4 };
  if (typeof module !== 'undefined') module.exports = root.YTBMPreparedStretch;
})(globalThis);
