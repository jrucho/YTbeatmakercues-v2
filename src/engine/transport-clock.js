export class TransportClock {
  constructor({ bpm = 120, quantize = "bar" } = {}) {
    this.bpm = bpm;
    this.quantize = quantize;
    this.playing = false;
    this.t0 = 0;
  }

  setBpm(bpm) {
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    this.bpm = bpm;
  }

  start(atTime = 0) {
    this.playing = true;
    this.t0 = atTime;
  }

  stop() {
    this.playing = false;
  }

  secondsPerBeat() {
    return 60 / this.bpm;
  }

  barDuration(beatsPerBar = 4) {
    return this.secondsPerBeat() * beatsPerBar;
  }

  quantizeTime(time, division = this.quantize, beatsPerBar = 4) {
    if (!Number.isFinite(time)) return 0;
    const beat = this.secondsPerBeat();
    const bar = this.barDuration(beatsPerBar);
    const grid = division === "bar" ? bar : beat;
    return Math.round(time / grid) * grid;
  }
}
