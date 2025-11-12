class PhaserProc extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.rate = 0.5;
    this.state = [];
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length) {
      return true;
    }

    for (let channel = 0; channel < input.length; channel++) {
      if (!this.state[channel]) {
        this.state[channel] = new Array(8).fill(0);
      }
    }

    const frameLength = input[0].length;
    for (let sample = 0; sample < frameLength; sample++) {
      const frequency = 1000 + 800 * Math.sin(this.phase);
      this.phase += (this.rate / sampleRate) * 2 * Math.PI;
      const omega = 2 * Math.PI * frequency / sampleRate;
      const a = (Math.sin(omega) - 1) / (Math.sin(omega) + 1);

      for (let channel = 0; channel < input.length; channel++) {
        let value = input[channel][sample];
        for (let stage = 0; stage < 4; stage++) {
          const previousInput = value;
          const previousOutput = this.state[channel][stage * 2];
          const y = -a * previousInput + previousOutput;
          this.state[channel][stage * 2] = previousInput;
          this.state[channel][stage * 2 + 1] = y;
          value = y;
        }
        output[channel][sample] = value;
      }
    }

    return true;
  }
}

registerProcessor('phaser-proc', PhaserProc);
