# Release 2.1

## Clean changelog
- Keyboard cues remain fixed to number keys `1-9` and `0` with a hard 10-cue limit.
- MIDI cue mode now supports numbered cues `1-16` (no `0` cue in MIDI numbering).
- Added **Extended MIDI Cue Mode** toggle in Advanced controls to allow up to 256 MIDI cues.
- Fixed cue numbering/indexing so cue labels now match real order (no off-by-one shift).
- Fixed cue counter display so it updates immediately and reflects active mode correctly.
- Fixed MIDI note handling across channels for cue mapping and mapped controls.
- Improved looper sync behavior when loopers are scheduled to stop.
- Improved MIDI SHIFT double-press reliability for stopping playback behavior.
- Preserved low-latency playback behavior (no timing engine, routing, or buffer-latency changes).

## Technical changelog
- Introduced cue mode state (`keyboard` vs `midi`) plus extended MIDI toggle persistence via `localStorage` key `ytbm_extendedMidiCueMode`.
- Added cue helpers: `getCueModeLimit`, `getCueCountLabel`, `sortCueKeysForDisplay`, `getMidiCueKeyForInput`, `setCueAtKey`, `getCueTime`, and `normalizeCuePoints`.
- Migrated cue storage handling to support structured cue entries with optional MIDI metadata (`note`, `channel`) while remaining backward compatible with numeric cue values.
- Updated random cue generation logic:
  - keyboard path generates exactly 10 cues
  - MIDI path generates exactly 16 cues
- Updated counter rendering in advanced/minimal UI to reflect mode-aware denominator and real-time cue count refresh.
- Updated MIDI note-on/off parsing to channel-agnostic command handling (`command` + `velocity`) and improved shift note release debounce with `lastMidiShiftReleaseTime`.
- Updated MIDI cue assignment to:
  - preserve keyboard mapping constraints
  - assign MIDI cues in strict numeric order (`1..16`, then `1..256` in extended mode)
  - allow same note values from different channels to create distinct cues.
- Added Advanced panel checkbox UI for **Extended MIDI Cue Mode**.
- Adjusted looper sync source selection with `hasActiveSyncLoop()` to prevent sync-to-loop when loop is in scheduled-stop state.

## Short release notes
Version 2.1 is a stability-focused update that keeps the existing low-latency workflow intact while fixing cue indexing, improving real-time cue counters, and expanding MIDI cue handling to 16 (or 256 in extended mode). MIDI channel handling and looper sync edge cases were tightened so live performance behavior is more predictable without adding latency.
