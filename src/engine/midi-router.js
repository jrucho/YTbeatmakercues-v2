export class MidiRouter {
  constructor() {
    this.mappings = {};
    this.learning = null;
    this.onEvent = null;
  }

  startLearn(target) {
    this.learning = target;
  }

  bind(note, target) {
    if (!target) return;
    this.mappings[note] = target;
    this.learning = null;
  }

  cancelLearn() {
    this.learning = null;
  }

  handleMidiMessage({ note, velocity }) {
    if (this.learning) {
      this.bind(note, this.learning);
      return;
    }
    const target = this.mappings[note];
    if (target && typeof this.onEvent === "function") {
      this.onEvent({ target, note, velocity });
    }
  }
}
