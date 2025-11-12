class StutterProc extends AudioWorkletProcessor {
  constructor() {
    super();
    this.loop = false;
    this.length = 2048;
    this.bufferLength = sampleRate;
    this.buffer = [new Float32Array(this.bufferLength), new Float32Array(this.bufferLength)];
    this.position = 0;

    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.loop !== undefined) {
        this.loop = data.loop;
      }
      if (data.length) {
        this.length = Math.min(this.bufferLength, data.length);
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length) {
      return true;
    }

    for (let sample = 0; sample < input[0].length; sample++) {
      for (let channel = 0; channel < input.length; channel++) {
        if (!this.loop) {
          this.buffer[channel][this.position] = input[channel][sample];
        }
        output[channel][sample] = this.buffer[channel][this.position % this.length];
      }

      this.position = (this.position + 1) % this.bufferLength;
      if (this.loop) {
        this.position %= this.length;
      }
    }

    return true;
  }
}

registerProcessor('stutter-proc', StutterProc);
