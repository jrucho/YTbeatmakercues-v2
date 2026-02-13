# Release Notes (2.1.0)

## What is new (simple summary)
- **Audio looper record starts instantly** when you press record (no delayed feel).
- **MIDI input selector** in Advanced panel:
  - Default is **Auto (All devices)**
  - Optional: lock control to one specific MIDI device.
- **Optional multi-channel MIDI cue mode** in Advanced panel (`MIDI Ch Cues`):
  - Off by default
  - When On, channel 2+ can create extra cue banks beyond the base 16 cues.
- **Cue counter now updates in real time** with the true number of cues (example: `23/23`).
- **Cue cap added: 256 max cues** total.

## Behavior details
- MIDI Random Cues still fills the first base 16 cues.
- Extra cues above 16 are still available through manual MIDI cue marking (when multi-channel mode is enabled).
- Keyboard cue workflow stays limited to the standard 10-key cue set.

## Why this release
This version focuses on faster recording response and clearer MIDI control for live performance, while keeping the existing workflow familiar by default.
