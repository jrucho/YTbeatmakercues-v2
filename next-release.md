# Release 2.1.1

## Clean changelog
- Looper actions now execute on press for audio, video, and MIDI loopers.
- Single-press record/play/overdub/stop-record actions now happen immediately on press.
- Double-press stop and hold-to-erase gestures are now press-driven with release cleanup to avoid duplicate execution.
- Triple-press erase gesture remains available with press timing windows.
- Updated versioning to **2.1.1**.
- Smart looper behavior is now consistent: if at least one loop is actively playing, new loops sync; if all loopers are stopped, new loops record and run in free tempo.
- Fixed free-tempo audio recording length bug when recording a second loop after stopping a first loop.
- MIDI loopers now follow the same smart sync/free behavior as audio loopers.
- Fixed MIDI SHIFT double-tap detection reliability so pause/stop triggers consistently without repeated presses.
- Added MIDI-mappable **Back 5s** and **Forward 5s** transport actions in MIDI Mapping.
- 5s skip transport now performs immediate direct seek (single tap) without volume fade.
- Keyboard cue workflow remains fixed to `1-9` and `0` (10 max), while MIDI keeps numeric cue flow (`1..16`, optional extended mode up to 256).
- Cue counters now reflect real counts and full-state behavior correctly in minimal and advanced UI.

## Technical changelog
- Reworked `onLooperButtonMouseDown`/`onLooperButtonMouseUp` and `onMidiLooperButtonMouseDown`/`onMidiLooperButtonMouseUp` to run gesture actions on press and use mouseup/note-off for cleanup only.
- Added hold-erase timers tied to button-down state for audio and MIDI loopers so erase can occur during a held second press without waiting for release.
- Updated video looper handlers so single and double press actions execute on `mousedown`.
- `manifest.json` version changed from `2.1` to `2.1.1`.
- Audio recording finalization now snaps to `baseLoopDuration` only when an active sync anchor exists (`hasActiveSyncLoop()`); otherwise recorded duration is kept as-is and becomes the new base reference.
- Audio recording stop scheduling now quantizes stop only when an active sync anchor exists; otherwise it stops immediately in free mode.
- Added MIDI sync-anchor helpers (`hasActiveMidiSyncLoop`, `getNextMidiLoopAlignedStart`) and updated `playMidiLoop()` to align only when another MIDI looper is actively running.
- SHIFT MIDI tap handling now triggers on clean note-on edges to improve double-tap consistency, while keeping modifier behavior intact.
- Added mapped MIDI transport actions `seekBack5` and `seekForward5` (+ UI rows and fallback migration defaults).
- Preserved low-latency workflow: no buffer-size changes, no timing-engine replacement, and no audio path redesign.

## Short release notes
Version **2.1.1** focuses on looper responsiveness: audio, video, and MIDI looper actions now execute on press with improved press/hold/triple gesture handling for live use.
