class LoopRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.buffers = [];
    this.skipFrames = 0;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data === 'start') {
        this.recording = true;
        // Strict clean-start capture: no preroll seeding to avoid doubled onsets.
        this.buffers = [];
        // Skip one render quantum after arm to avoid edge-frame glitches from start boundary.
        this.skipFrames = 1;
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

      if (this.recording) {
        if (this.skipFrames > 0) {
          this.skipFrames -= 1;
        } else {
          this.buffers.push(frame);
        }
      }
    }

    return true;
  }
}

registerProcessor('loop-recorder', LoopRecorder);
