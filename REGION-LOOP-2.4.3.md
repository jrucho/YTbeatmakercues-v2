# 2.4.3 — IN / OUT video region loop

Package: **ytbeatmakercues-2.4.3.zip**.

## Controls

- **IN** or **I**: mark the current playback position as the start.
- **OUT** or **O**: mark the end and enable repeating. OUT must be at least
  0.10 seconds after IN. Paused playback stays paused until you press Play.
- **↻** or **I + O together**: clear IN and OUT and stop repeating. The symbol is lit while looping
  in red and unlit otherwise. IN is teal and OUT amber when marked; idle buttons use
  the same background and rounded shape as the existing mini-bar controls.
- These controls replace the mini-bar Import button. Import Media and Import
  Audio remain available in Advanced. I and Cmd/Ctrl-I no longer import files.
- IN/OUT markers appear on the timeline, teal/amber instead of the red cues.
  **Drag** a marker to move it; **double-click** to erase that boundary.
- **U** undoes region edits through the extension's shared history.
  **Cmd/Ctrl-U** redoes. Marking, dragging, deleting, clearing and menu edits
  all participate. Each completed drag is one history entry.
- I/O keyboard marking captures the press position. A short chord-detection
  window distinguishes I+O clear from individual marks; releasing a single
  key commits it immediately using that captured position.
- Right-click any region control or marker for exact times in seconds,
  Apply, Pause/Enable loop, Clear and Close.
- Boundaries and enabled state are stored per video in extension storage.
  Changing videos uses that video's own saved region. A cue or scrub does not
  turn the loop off; an outside seek returns to IN once the player is ready.
- The Advanced Speed HD latency dropdown now matches the rounded dark controls,
  with compact Quality/Balanced/Live labels, a consistent chevron, dark options
  and visible hover/focus states. Its profiles and processing settings are unchanged.

## Audio paths

No Stems pack is required. With original audio (including installed stems
with no mute/solo), the native player seeks back to IN at OUT using the cue
transition. Browser decoder/network time can leave an audible gap. Speed HD
on original audio retains its live processing delay when needed.

When a selected stem region is fully separated and its prepared speed is
ready, audio repeats are scheduled on the AudioContext clock. Scheduled buffers
wrap from OUT to IN; picture seeks do not flush the playing stem queue. Mutes,
solos, pitch, prepared Speed and Speed HD tuning remain in effect. A short
boundary fade reduces clicks. The picture can briefly catch up during a seek.

Unanalysed/unprepared regions and capture-only sources use the player-driven
path until ready. This does not promise sample-perfect native video seeking,
artifact-free musical joins, uninterrupted background playback under browser
throttling, or zero browser/device latency. Advertisements suspend region
processing instead of applying song boundaries to the ad.

## Update

Extract the ZIP into the existing unpacked extension folder, reload it at
`chrome://extensions`, and refresh existing video tabs. Keep the same folder
and extension identity to preserve the installed model and settings. No model
is bundled; the separation model/downloader are unchanged.

## Verification

- **136 automated tests passed**, including region bounds, native transport,
  exact audio-clock phase, wrapped PCM reads, cue persistence, single-transaction
  dragging, per-video storage fences, I/O and I+O keys, and undo/redo routing.
- Real Chromium **149.0.7827.55** checked keyboard and pointer controls, matching
  rounded idle styling, centered SVG bounds, active/inactive state, drag-to-move,
  double-click erase, U / Cmd-U, chord-clear, exact-time adjustment, persistence,
  same-tab video identity and native repeats including OUT at the video end.
- Chrome also verified the red active-loop color and rounded dark Advanced
  latency selector, including functional Live (~68 ms) → Quality (~168 ms)
  profile changes.
- Actual HT-Demucs output was looped in Pitch, Speed and Speed HD with a vocal
  mute selected. The audio queue generation stayed unchanged during repeated
  picture seeks. Sampled RMS stayed nonzero on the controlled section; this is
  evidence against decoder-seek silence, not an artifact-free-loop guarantee.
- Live YouTube `jNQXAC9IVRw` also passed audio-clock looping at 1×, half-speed
  Speed and 0.75× Speed HD with +3 st tuning. Existing cue/mute/solo, native MSE,
  first-load, reanalysis, navigation, prepared speed and source cleanup checks passed.
- A separate installed-model UI check passed 144 mute/solo clicks across Pitch,
  Speed and Speed HD, plus nine Advanced/mini-bar switches, without restoring
  the pre-install button. No speculative stem-state fix was applied.

Opt-in browser audit: `tests/browser-stems-audit.cjs` with `YTBM_REGION_ONLY=1`
for region controls/original/stem checks, or release checks plus
`YTBM_REGION_LIVE=1` for live YouTube region loops. Model and test tooling stay
outside the model-free extension ZIP.
