export class LooperBank {
  constructor({ count = 4 } = {}) {
    this.loopers = Array.from({ length: count }, (_, index) => ({
      id: index,
      armed: false,
      recording: false,
      length: 0,
      gain: 1,
      pitch: 0
    }));
  }

  setArmed(id, armed) {
    const looper = this.loopers[id];
    if (!looper) return;
    looper.armed = Boolean(armed);
  }

  startRecording(id) {
    const looper = this.loopers[id];
    if (!looper) return;
    looper.recording = true;
  }

  stopRecording(id, length = 0) {
    const looper = this.loopers[id];
    if (!looper) return;
    looper.recording = false;
    looper.length = length;
  }

  clear(id) {
    const looper = this.loopers[id];
    if (!looper) return;
    looper.length = 0;
    looper.recording = false;
  }
}
