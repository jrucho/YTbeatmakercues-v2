class LoopRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.buffers = [];
    this.startFrame = null;
    this.endFrame = null;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data === 'start') {
        this.recording = true;
        this.buffers = [];
        this.startFrame = null;
        this.endFrame = null;
      } else if (data === 'stop') {
        this.recording = false;
        this.port.postMessage({
          buffers: this.buffers,
          startFrame: this.startFrame,
          endFrame: this.endFrame,
        });
        this.buffers = [];
        this.startFrame = null;
        this.endFrame = null;
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (this.recording && input && input.length && input[0] && input[0].length) {
      if (this.startFrame === null) {
        this.startFrame = currentFrame;
      }
      const frame = [];
      for (let channel = 0; channel < input.length; channel++) {
        frame[channel] = new Float32Array(input[channel]);
      }
      this.buffers.push(frame);
      this.endFrame = currentFrame + input[0].length;
    }

    return true;
  }
}

registerProcessor('loop-recorder', LoopRecorder);
