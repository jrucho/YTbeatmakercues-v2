class LoopRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.buffers = [];

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data === 'start') {
        this.recording = true;
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
    if (this.recording && input && input.length) {
      const frame = [];
      for (let channel = 0; channel < input.length; channel++) {
        frame[channel] = new Float32Array(input[channel]);
      }
      this.buffers.push(frame);
    }

    return true;
  }
}

registerProcessor('loop-recorder', LoopRecorder);
