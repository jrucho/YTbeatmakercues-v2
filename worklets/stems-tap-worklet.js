/* YTBM stems tap — AudioWorklet replacement for ScriptProcessor capture.
 * Generic N-input tap: each connected input is batched into 4096-frame
 * interleaved stereo chunks and posted (transferred) to the main thread.
 * Output is silence (single zeroed output); connect through a zero gain to
 * a destination to keep the tap running. Pure passthrough-free: this node
 * never feeds audio downstream, it only observes.
 */
class StemsTapProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.tapId = opts.tapId || 'tap';
    this.batchFrames = opts.batchFrames || 4096;
    this.acc = []; // per-input { left: Float32Array, right: Float32Array, n }
  }

  accFor(index) {
    let a = this.acc[index];
    if (!a) {
      a = {
        left: new Float32Array(this.batchFrames),
        right: new Float32Array(this.batchFrames),
        n: 0,
      };
      this.acc[index] = a;
    }
    return a;
  }

  flush(index) {
    const a = this.acc[index];
    if (!a || a.n === 0) return;
    const n = a.n;
    const interleaved = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      interleaved[i * 2] = a.left[i];
      interleaved[i * 2 + 1] = a.right[i];
    }
    a.n = 0;
    this.port.postMessage(
      { type: 'frames', tap: this.tapId, index, frames: n, startTime: a.startTime, buffer: interleaved.buffer },
      [interleaved.buffer]
    );
  }

  process(inputs) {
    for (let i = 0; i < inputs.length; i++) {
      const channels = inputs[i];
      if (!channels || !channels.length || !channels[0] || !channels[0].length) continue;
      const left = channels[0];
      const right = channels.length > 1 ? channels[1] : channels[0];
      let off = 0;
      while (off < left.length) {
        const a = this.accFor(i);
        if (!a.n) a.startTime = (currentFrame + off) / sampleRate;
        const room = this.batchFrames - a.n;
        const take = Math.min(room, left.length - off);
        for (let n = 0; n < take; n++) {
          a.left[a.n + n] = left[off + n];
          a.right[a.n + n] = right[off + n];
        }
        a.n += take;
        off += take;
        if (a.n >= this.batchFrames) this.flush(i);
      }
    }
    return true;
  }
}

registerProcessor('stems-tap', StemsTapProcessor);
