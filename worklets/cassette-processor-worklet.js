class CassetteProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false;
    this.bitDepth = 8;
    this.targetSampleRate = 22000;
    this.step = Math.max(1, Math.floor(sampleRate / this.targetSampleRate));
    this.counter = 0;
    this.lastSamples = [];
    this.noiseAmp = 0.0002;
    this.cutoff = 5000;
    this.prevFiltered = [];

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) return;
      if (data.hasOwnProperty('active')) {
        this.active = data.active;
      }
      if (data.hasOwnProperty('bitDepth')) {
        this.bitDepth = data.bitDepth;
      }
      if (data.hasOwnProperty('targetSampleRate')) {
        this.targetSampleRate = data.targetSampleRate;
        this.step = Math.max(1, Math.floor(sampleRate / this.targetSampleRate));
      }
      if (data.hasOwnProperty('cutoff')) {
        this.cutoff = data.cutoff;
      }
      if (data.hasOwnProperty('noiseAmp')) {
        this.noiseAmp = data.noiseAmp;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    if (!this.active) {
      for (let channel = 0; channel < input.length; channel++) {
        output[channel].set(input[channel]);
      }
      return true;
    }

    const quantizationLevels = Math.pow(2, this.bitDepth) - 1;
    const RC = 1 / (2 * Math.PI * this.cutoff);
    const dt = 1 / sampleRate;
    const alpha = dt / (RC + dt);

    for (let channel = 0; channel < input.length; channel++) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];

      if (this.prevFiltered[channel] === undefined) {
        this.prevFiltered[channel] = 0;
      }
      if (this.lastSamples[channel] === undefined) {
        this.lastSamples[channel] = 0;
      }

      for (let i = 0; i < inputChannel.length; i++) {
        let processedSample;
        if ((this.counter + i) % this.step === 0) {
          const noise = (Math.random() * 2 - 1) * this.noiseAmp;
          const sampleVal = inputChannel[i] + noise;
          const quantized = Math.round(sampleVal * quantizationLevels) / quantizationLevels;
          this.lastSamples[channel] = quantized;
          processedSample = quantized;
        } else {
          processedSample = this.lastSamples[channel];
        }

        const previous = this.prevFiltered[channel];
        const filtered = previous + alpha * (processedSample - previous);
        this.prevFiltered[channel] = filtered;
        outputChannel[i] = filtered;
      }
    }

    this.counter += input[0].length;
    return true;
  }
}

registerProcessor('cassette-processor', CassetteProcessor);
