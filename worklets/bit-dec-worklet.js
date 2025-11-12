class BitDec extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bits = 4;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data && data.bits) {
        this.bits = data.bits;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input) {
      return true;
    }

    const maxChannel = input.length;
    for (let channel = 0; channel < maxChannel; channel++) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];
      const step = 1 / ((1 << this.bits) - 1);

      for (let sample = 0; sample < inputChannel.length; sample++) {
        const value = inputChannel[sample];
        outputChannel[sample] = Math.round(value / step) * step;
      }
    }

    return true;
  }
}

registerProcessor('bit-dec', BitDec);
