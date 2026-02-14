# Release 2.1

## Clean changelog
- Updated versioning to **2.1**.
- Smart looper behavior is now consistent: if at least one loop is actively playing, new loops sync; if all loopers are stopped, new loops record and run in free tempo.
- Fixed free-tempo audio recording length bug when recording a second loop after stopping a first loop.
- MIDI loopers now follow the same smart sync/free behavior as audio loopers.
- Fixed MIDI SHIFT double-tap detection reliability so pause/stop triggers consistently without repeated presses.
- Added MIDI-mappable **Back 5s** and **Forward 5s** transport actions in MIDI Mapping.
- Keyboard cue workflow remains fixed to `1-9` and `0` (10 max), while MIDI keeps numeric cue flow (`1..16`, optional extended mode up to 256).
- Cue counters now reflect real counts and full-state behavior correctly in minimal and advanced UI.

## Technical changelog
- `manifest.json` version changed from `2.1.0` to `2.1`.
- Audio recording finalization now snaps to `baseLoopDuration` only when an active sync anchor exists (`hasActiveSyncLoop()`); otherwise recorded duration is kept as-is and becomes the new base reference.
- Audio recording stop scheduling now quantizes stop only when an active sync anchor exists; otherwise it stops immediately in free mode.
- Added MIDI sync-anchor helpers (`hasActiveMidiSyncLoop`, `getNextMidiLoopAlignedStart`) and updated `playMidiLoop()` to align only when another MIDI looper is actively running.
- SHIFT MIDI tap handling now triggers on clean note-on edges to improve double-tap consistency, while keeping modifier behavior intact.
- Added mapped MIDI transport actions `seekBack5` and `seekForward5` (+ UI rows and fallback migration defaults).
- Preserved low-latency workflow: no buffer-size changes, no timing-engine replacement, and no audio path redesign.

## Short release notes
Version **2.1** focuses on live reliability: smart looping now behaves consistently across audio and MIDI, free-tempo loop recording is stable when all loops are stopped, and cue handling remains fast, numeric, and visually correct without latency regression.
