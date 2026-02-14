class LoopRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.buffers = [];

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data === 'start') {
        this.recording = true;
        // Strict clean-start capture: no preroll seeding to avoid doubled onsets.
        this.buffers = [];
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
        this.buffers.push(frame);
      }
    }

    return true;
  }
}

registerProcessor('loop-recorder', LoopRecorder);
