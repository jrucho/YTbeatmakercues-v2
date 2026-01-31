export class FxRack {
  constructor(initial = {}) {
    this.fx = { ...initial };
  }

  toggle(name, enabled) {
    if (!this.fx[name]) {
      this.fx[name] = { enabled: Boolean(enabled), params: {} };
      return;
    }
    this.fx[name].enabled = enabled ?? !this.fx[name].enabled;
  }

  setParam(name, param, value) {
    if (!this.fx[name]) {
      this.fx[name] = { enabled: false, params: {} };
    }
    this.fx[name].params[param] = value;
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.fx));
  }
}
