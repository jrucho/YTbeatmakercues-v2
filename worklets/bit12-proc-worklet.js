class Bit12Proc extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input) {
      return true;
    }

    const step = 1 / ((1 << 12) - 1);
    for (let channel = 0; channel < input.length; channel++) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];
      for (let sample = 0; sample < inputChannel.length; sample++) {
        outputChannel[sample] = Math.round(inputChannel[sample] / step) * step;
      }
    }

    return true;
  }
}

registerProcessor('bit12-proc', Bit12Proc);
