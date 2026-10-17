# 2.4.2 — prepared stem speeds and press-triggered pads

Package: **ytbeatmakercues-2.4.2.zip**.

## Playback

- At **0% / 1× with zero independent tuning**, Speed and Speed HD bypass the
  live stretch processor, including when a stem is muted or soloed.
- With cached full-source/native-buffered stems, other speeds/tunings render
  ahead using the actual Signalsmith engine in an OfflineAudioContext. The
  ready audio plays directly from buffers, bypassing the live HD delay.
- A changed fader/tuning value needs preparation. The previous committed speed
  continues until the current section is ready, then switches with short gain
  fades. Requests for obsolete fader positions are discarded. A cue into an
  unprepared section can still wait; this is not arbitrary zero-latency live
  stretching or a guarantee of artifact-free sound for every recording.
- Four-second tiles include analysis context and overlap. All four stems are
  prepared together, preserving independent mute/solo controls. Preparation is
  serialized, with a 96 MiB LRU PCM cache per video and only one render in flight.
  The current speed's lookahead is retained while preparing its replacement.
- Raw capture-only sources and original/native HD playback still use live
  processing when correction is required. If offline rendering fails, the
  info menu reports the live-stretch fallback and its latency still applies.
- Existing cue decoder time, anti-click shaping and browser/device output
  latency remain. The improvement removes the live stretch buffer from the
  prepared path; it does not remove hardware/browser latency.

## Pads

The old handlers already requested cues on mouse/touch press, but cold audio
priming could wait for a document click on release. Pads now use pointer-down,
resume suspended audio directly in that gesture, and do not replay the cue on
pointer-up/click. Keyboard activation is handled on key-down; assistive clicks
remain supported. Browser gesture policy can still require an initial unlock
on some devices.

## Updating

Replace files in the existing unpacked extension folder, reload the extension
in `chrome://extensions`, and refresh existing video tabs. Preserve the same
extension identity to retain its verified model storage. No model is bundled.
The downloader and separation model remain the same.

## Verification

- **125 automated checks**: press-vs-release activation, unity bypass, genuine
  stem gates, cache limits, retained lookahead, obsolete-render rejection,
  source-change invalidation and existing audio/lifecycle regressions.
- Chrome **149.0.7827.55**, actual HT-Demucs output and Signalsmith WASM:
  a separated 110 Hz bass measured about 109.86 Hz in Speed/HD at 0.5×/1.5×;
  HD +3 st measured about 130.37 Hz. All requested stem mutes stayed selected.
- Prepared/direct cues had nonzero output at the **60 ms observation**, with
  `liveStretchActive: false`. This is a test observation, not an end-to-end
  latency guarantee or a measured onset time for every device.
- A real held mouse press resumed a suspended AudioContext and sought the cue
  before release. Releasing did not create a second seek.
- Rapid fader targets retained the committed playback speed until the latest
  prepared target was ready. Independent stereo rendering was checked with
  quiet bass alongside unrelated louder instruments and transients.
- Real YouTube mute/solo/cues and prepared Speed/HD passed. Native MediaSource,
  reanalysis, same-tab navigation and source-download cleanup were also checked.

Opt-in browser scripts: `tests/browser-stems-audit.cjs` and
`tests/browser-prepared-stretch.cjs`. Tools/model fixtures are external to the
ZIP. The regular regression command is `npm test`.
