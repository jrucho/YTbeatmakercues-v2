export const initialState = {
  session: {
    videoId: null,
    isReady: false,
    errors: []
  },
  transport: {
    bpm: 120,
    quantize: "bar",
    playing: false,
    t0: 0
  },
  cues: [],
  loopers: [],
  fx: {
    cassette: { enabled: false, params: {} },
    reverb: { enabled: false, params: {} },
    sidechain: { enabled: false, params: {} }
  },
  midi: {
    enabled: true,
    inputs: [],
    mappings: {},
    learning: null
  },
  ui: {
    activePanel: "main",
    minimized: false
  }
};
