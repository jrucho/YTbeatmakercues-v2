class LoopRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.buffers = [];
    this.pendingStartTime = null;
    this.pendingStopTime = null;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data === 'start') {
        this.recording = true;
        this.buffers = [];
        this.pendingStartTime = null;
        this.pendingStopTime = null;
        return;
      }
      if (data === 'stop') {
        this.pendingStartTime = null;
        this.pendingStopTime = null;
        this._flush();
        return;
      }
      if (!data || typeof data !== 'object') return;

      if (data.type === 'start') {
        this.buffers = [];
        this.recording = false;
        this.pendingStopTime = null;
        if (typeof data.atTime === 'number' && isFinite(data.atTime)) {
          this.pendingStartTime = data.atTime;
        } else {
          this.pendingStartTime = null;
          this.recording = true;
        }
      } else if (data.type === 'stop') {
        if (typeof data.atTime === 'number' && isFinite(data.atTime)) {
          this.pendingStopTime = data.atTime;
        } else {
          this.pendingStopTime = null;
          this._flush();
        }
      }
    };
  }

  _captureSlice(input, startFrame, endFrame) {
    if (!input || !input.length) return;
    const from = Math.max(0, startFrame | 0);
    const to = Math.max(from, endFrame | 0);
    if (to <= from) return;
    const frame = [];
    for (let channel = 0; channel < input.length; channel++) {
      frame[channel] = new Float32Array(input[channel].subarray(from, to));
    }
    this.buffers.push(frame);
  }

  _flush() {
    if (this.recording || this.buffers.length) {
      this.recording = false;
      this.port.postMessage(this.buffers);
    }
    this.buffers = [];
  }

  process(inputs) {
    const input = inputs[0];
    const blockFrames = input && input.length && input[0] ? input[0].length : 128;
    const blockStart = currentTime;
    const blockEnd = blockStart + blockFrames / sampleRate;

    if (!this.recording && this.pendingStartTime !== null && this.pendingStartTime < blockEnd) {
      this.recording = true;
    }

    if (this.recording && input && input.length) {
      let startFrame = 0;
      if (this.pendingStartTime !== null) {
        const relStart = (this.pendingStartTime - blockStart) * sampleRate;
        startFrame = Math.max(0, Math.min(blockFrames, Math.floor(relStart)));
      }

      let endFrame = blockFrames;
      let shouldStopAfterBlock = false;
      if (this.pendingStopTime !== null) {
        if (this.pendingStopTime <= blockStart) {
          endFrame = 0;
          shouldStopAfterBlock = true;
        } else if (this.pendingStopTime < blockEnd) {
          const relStop = (this.pendingStopTime - blockStart) * sampleRate;
          endFrame = Math.max(startFrame, Math.min(blockFrames, Math.ceil(relStop)));
          shouldStopAfterBlock = true;
        }
      }

      this._captureSlice(input, startFrame, endFrame);
      this.pendingStartTime = null;

      if (shouldStopAfterBlock) {
        this.pendingStopTime = null;
        this._flush();
      }
    }

    return true;
  }
}

registerProcessor('loop-recorder', LoopRecorder);
