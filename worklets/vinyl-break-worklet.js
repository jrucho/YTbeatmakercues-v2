class VinylBreakProc extends AudioWorkletProcessor {
  constructor() {
    super();
    this.speed = 1;
    this.length = sampleRate * 2;
    this.buffer = [new Float32Array(this.length), new Float32Array(this.length)];
    this.writeIndex = 0;
    this.readIndex = 0;

    this.port.onmessage = (event) => {
      if (event.data && event.data.speed !== undefined) {
        this.speed = event.data.speed;
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
        this.buffer[channel][this.writeIndex] = input[channel][sample];
        const readInteger = this.readIndex | 0;
        output[channel][sample] = this.buffer[channel][readInteger];
      }

      this.writeIndex = (this.writeIndex + 1) % this.length;
      this.readIndex += this.speed;
      if (this.readIndex >= this.length) {
        this.readIndex -= this.length;
      }
    }

    return true;
  }
}

registerProcessor('vinyl-break', VinylBreakProc);
