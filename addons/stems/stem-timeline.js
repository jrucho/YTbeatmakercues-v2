/* YTBM Stems timeline math — dependency-free pure logic (own implementation).
 * Loaded as a classic script before content.js AND importable into tests.
 * Geometry matches the HT-Demucs ONNX model: 343,980 samples (7.8 s) at
 * 44.1 kHz, consecutive windows every 310,905 samples (0.75 s overlap).
 *
 *   SegmentQueue: slices an interleaved stereo stream into planar
 *     (L plane then R plane) model-sized windows.
 *   StemTimeline: stores separated 4-stem windows per segment index and
 *     reconstructs any span with triangular overlap-add, normalized by
 *     summed weight so joins are exact where neighbors agree.
 *   findCoveredCapture: newest-first anchor walk returning a capture
 *     position fully covered by learned segments (or null).
 *   LinearResampler: fractional-rate sample-rate conversion with carry,
 *     for 48 kHz capture -> 44.1 kHz model input and back for export.
 */
(function (root) {
  const SEG = 343980;
  const OVERLAP = 33075;
  const HOP = SEG - OVERLAP;
  const STEMS = 4;

  function weightAt(i) {
    if (i < OVERLAP) return (i + 1) / OVERLAP;
    if (i >= SEG - OVERLAP) return (SEG - i) / OVERLAP;
    return 1;
  }

  class SegmentQueue {
    constructor(startIndex = 0) {
      this.buf = new Float32Array(0);
      this.bufFrames = 0;
      this.startFrame = startIndex * HOP;
      this.nextIndex = startIndex;
      this.firstIndex = startIndex;
      this.flushed = false;
    }
    get totalFrames() { return this.startFrame + this.bufFrames; }
    push(stereoInterleaved) {
      if (this.flushed) throw new Error("SegmentQueue: push after flush");
      if (!(stereoInterleaved instanceof Float32Array)) throw new Error("SegmentQueue.push: expected Float32Array");
      if (stereoInterleaved.length % 2 !== 0) throw new Error("SegmentQueue.push: interleaved stereo needs even length");
      const addFrames = stereoInterleaved.length / 2;
      const needed = (this.bufFrames + addFrames) * 2;
      if (needed > this.buf.length) {
        const cap = Math.max(this.buf.length * 2, needed, 2 * SEG);
        const grown = new Float32Array(cap);
        grown.set(this.buf.subarray(0, this.bufFrames * 2));
        this.buf = grown;
      }
      this.buf.set(stereoInterleaved, this.bufFrames * 2);
      this.bufFrames += addFrames;
      const out = [];
      while (this.totalFrames >= this.nextIndex * HOP + SEG) {
        out.push(this.emitSegment(this.nextIndex, SEG));
        this.nextIndex += 1;
        const keepFrom = this.nextIndex * HOP;
        const dropFrames = keepFrom - this.startFrame;
        if (dropFrames > 0) {
          this.buf.copyWithin(0, dropFrames * 2, this.bufFrames * 2);
          this.bufFrames -= dropFrames;
          this.startFrame = keepFrom;
        }
      }
      return out;
    }
    emitSegment(index, valid) {
      const mix = new Float32Array(2 * SEG);
      const off = index * HOP - this.startFrame;
      for (let i = 0; i < valid; i += 1) {
        mix[i] = this.buf[(off + i) * 2];
        mix[SEG + i] = this.buf[(off + i) * 2 + 1];
      }
      return { index, mix, validLength: valid };
    }
    flush() {
      if (this.flushed) return [];
      this.flushed = true;
      // Padding finishes short clips and the end of a captured run. A buffer
      // containing only the overlap of an already emitted window adds nothing.
      if (!this.bufFrames || (this.nextIndex > this.firstIndex && this.bufFrames <= OVERLAP)) return [];
      return [this.emitSegment(this.nextIndex, Math.min(SEG, this.bufFrames))];
    }
  }

  class StemTimeline {
    constructor() {
      // index -> { data: Float32Array(STEMS * 2 * SEG), validLength }
      this.segments = new Map();
    }
    addSegment(index, stemsData, validLength = SEG) {
      if (!Number.isInteger(index) || index < 0) throw new Error("StemTimeline.addSegment: bad index " + index);
      if (!(stemsData instanceof Float32Array) || stemsData.length !== STEMS * 2 * SEG) {
        throw new Error("StemTimeline.addSegment: expected Float32Array(" + STEMS * 2 * SEG + ")");
      }
      if (!Number.isInteger(validLength) || validLength <= 0 || validLength > SEG) {
        throw new Error("StemTimeline.addSegment: bad validLength " + validLength);
      }
      this.segments.set(index, { data: stemsData, validLength });
    }
    dropBefore(index) {
      for (const key of [...this.segments.keys()]) {
        if (key < index) this.segments.delete(key);
      }
    }
    coverage(fromSample, toSample) {
      if (toSample <= fromSample) return 1;
      let cursor = fromSample;
      const total = toSample - fromSample;
      let covered = 0;
      const kMin = Math.max(0, Math.ceil((fromSample - SEG + 1) / HOP));
      const kMax = Math.floor((toSample - 1) / HOP);
      for (let k = kMin; k <= kMax; k += 1) {
        const seg = this.segments.get(k);
        if (!seg) continue;
        const s = Math.max(cursor, k * HOP);
        const e = Math.min(toSample, k * HOP + seg.validLength);
        if (e > s) {
          if (s > cursor) break; // gap: later segments cannot fill it
          covered += e - s;
          cursor = e;
          if (cursor >= toSample) break;
        }
      }
      return covered / total;
    }
    // Read stem s (0..3), stereo planar, for [fromSample, toSample).
    // Returns { left, right } Float32Arrays with overlap-add applied.
    readStem(s, fromSample, toSample) {
      const n = Math.max(0, toSample - fromSample);
      const left = new Float32Array(n);
      const right = new Float32Array(n);
      if (n === 0) return { left, right };
      const kMin = Math.max(0, Math.ceil((fromSample - SEG + 1) / HOP));
      const kMax = Math.floor((toSample - 1) / HOP);
      for (let k = kMin; k <= kMax; k += 1) {
        const seg = this.segments.get(k);
        if (!seg) continue;
        const base = (s * 2) * SEG;
        const s0 = Math.max(fromSample, k * HOP);
        const s1 = Math.min(toSample, k * HOP + seg.validLength);
        for (let g = s0; g < s1; g += 1) {
          const i = g - k * HOP;
          const w = weightAt(i);
          const o = g - fromSample;
          left[o] += seg.data[base + i] * w;
          right[o] += seg.data[base + SEG + i] * w;
        }
      }
      // Normalize by summed weight so joins are exact where neighbors agree.
      for (let o = 0; o < n; o += 1) {
        const g = fromSample + o;
        let wsum = 0;
        const kA = Math.max(0, Math.ceil((g - SEG + 1) / HOP));
        const kB = Math.floor(g / HOP);
        for (let k = kA; k <= kB; k += 1) {
          const seg = this.segments.get(k);
          if (!seg) continue;
          const i = g - k * HOP;
          if (i < 0 || i >= seg.validLength) continue;
          wsum += weightAt(i);
        }
        if (wsum > 1e-9) {
          left[o] /= wsum;
          right[o] /= wsum;
        }
      }
      return { left, right };
    }
  }

  // Newest-first anchor walk: same song moment can exist at several capture
  // positions (replays re-capture it); the newest fully-covered mapping wins.
  // anchors: [{ vt, cs, csEnd }] in video-seconds and capture samples.
  function findCoveredCapture(anchors, vt, seconds, sampleRate, timeline) {
    const n = Math.round(seconds * sampleRate);
    for (let i = anchors.length - 1; i >= 0; i -= 1) {
      const a = anchors[i];
      if (vt < a.vt - 0.05) continue;
      const cs = Math.round(a.cs + (vt - a.vt) * sampleRate);
      const limit = a.csEnd != null ? a.csEnd : Infinity;
      if (cs < 0 || cs + n > limit) continue;
      if (timeline.coverage(cs, cs + n) >= 0.999) return cs;
    }
    return null;
  }

  function LinearResampler() {
    return {
      frac: 0,
      // Resample stereo planar input; returns { left, right } at outRate.
      process(interleaved, inRate, outRate) {
        const frames = interleaved.length / 2;
        const step = inRate / outRate;
        const out = [];
        const left = [];
        const right = [];
        let pos = this.frac;
        // Carry model: keep last frame for interpolation across calls.
        if (!this.prev) this.prev = [0, 0];
        const sample = (idx, ch) => {
          if (idx < 0) return this.prev[ch];
          if (idx >= frames) return null;
          return interleaved[idx * 2 + ch];
        };
        while (true) {
          const i0 = Math.floor(pos);
          const f = pos - i0;
          const aL = sample(i0, 0);
          const bL = sample(i0 + 1, 0);
          if (aL === null || bL === null) break;
          const aR = sample(i0, 1);
          const bR = sample(i0 + 1, 1);
          left.push(aL + (bL - aL) * f);
          right.push(aR + (bR - aR) * f);
          pos += step;
        }
        if (frames > 0) {
          this.prev = [interleaved[(frames - 1) * 2], interleaved[(frames - 1) * 2 + 1]];
          this.frac = pos - frames;
        }
        return { left: Float32Array.from(left), right: Float32Array.from(right) };
      },
    };
  }

  function planTrack(frames, currentSeconds = 0) {
    if (!Number.isInteger(frames) || frames < 1 || frames > 44100 * 600) throw new Error('Invalid full-song length');
    const count = Math.max(1, Math.ceil((frames - SEG) / HOP) + 1);
    const first = Math.max(0, Math.min(count - 1, Math.floor((Number(currentSeconds) || 0) * 44100 / HOP)));
    return Array.from({ length: count }, (_, i) => {
      const index = (first + i) % count;
      return { index, validLength: Math.min(SEG, frames - index * HOP) };
    });
  }

  const api = { SEG, OVERLAP, HOP, STEMS, weightAt, SegmentQueue, StemTimeline, findCoveredCapture, LinearResampler, planTrack };
  root.YTBMStemTimeline = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
