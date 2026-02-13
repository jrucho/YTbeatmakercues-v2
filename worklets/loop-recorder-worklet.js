class LoopRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.buffers = [];
    this.preRollBuffers = [];
    this.maxPreRollFrames = 4; // ~10ms at 48kHz with 128-sample quantum

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data === 'start') {
        this.recording = true;
        // Keep a tiny preroll so the first transient isn't chopped.
        const seed = this.preRollBuffers.length > 1 ? this.preRollBuffers.slice(0, -1) : [];
        // Drop the most recent preroll frame to avoid doubled attack perception at record onset.
        this.buffers = seed.map(frame => frame.map(ch => new Float32Array(ch)));
      } else if (data === 'stop') {
        this.recording = false;
        this.port.postMessage(this.buffers);
        this.buffers = [];
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      const frame = [];
      for (let channel = 0; channel < input.length; channel++) {
        frame[channel] = new Float32Array(input[channel]);
      }

      this.preRollBuffers.push(frame);
      if (this.preRollBuffers.length > this.maxPreRollFrames) {
        this.preRollBuffers.shift();
      }

      if (this.recording) {
        this.buffers.push(frame);
      }
    }

    return true;
  }
}

registerProcessor('loop-recorder', LoopRecorder);
