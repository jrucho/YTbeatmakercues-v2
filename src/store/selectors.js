export const selectSession = (state) => state.session;
export const selectTransport = (state) => state.transport;
export const selectCues = (state) => state.cues;
export const selectLoopers = (state) => state.loopers;
export const selectFx = (state) => state.fx;
export const selectMidi = (state) => state.midi;
export const selectUi = (state) => state.ui;

export const selectProgress = (state) => ({
  playing: state.transport.playing,
  bpm: state.transport.bpm
});
