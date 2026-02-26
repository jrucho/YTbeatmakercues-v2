# Release 2.2

## Summary
Release **2.2** introduces a full VJ (video jockey) module integrated with the looper workflow, plus UI/layout cleanup and safer device-selection defaults for Advanced panel users.

## Clean changelog
- Added a new VJ Module window with realtime visual processing and live controls.
- Added a dedicated VJ canvas pipeline (source -> effects -> output -> preview) with render loop and monitor stream support.
- Added up to 8-stream composition with per-stream blend modes and per-stream FX profile support.
- Added per-stream 4-corner pin mapping with drag editing and double-click corner reset.
- Added VJ monitor popup window output with fullscreen-friendly controls.
- Added audio-reactive modulation helpers driven by analyser band data.
- Added MIDI-note handling for VJ FX controls and VJ text sequence toggling.
- Added Cmd/Ctrl+Y shortcut and top-level VJ button integration for quick access.
- Updated looper video capture routing so VJ output can be used as the visual source when VJ mode is enabled.
- Fixed VJ-to-video-looper capture routing so video looper records the processed VJ output even when FX are enabled and/or the VJ panel is closed.
- Reorganized Advanced panel layout under a cleaner **Packs (Advanced)** grouping.
- Fixed output/input/monitor dropdowns so they default to visible fallback choices when saved device IDs are missing.
- Updated extension version to **2.2** in `manifest.json`.

## Detailed: How the new VJ Module works

### 1) Activation and lifecycle
- Open the VJ panel from the VJ button in the main controls or with **Cmd/Ctrl+Y**.
- The module keeps a local `vjControls` state object for all FX, mapping, stream and MIDI settings.
- VJ settings are persisted in localStorage and restored on load.
- Enabling VJ starts a render loop (`requestAnimationFrame`) and a fallback interval pump so output remains alive in throttled/occluded contexts.

### 2) Video pipeline architecture
- **Source stage:** each frame is captured from available video sources into a source canvas.
- **FX stage:** effects are applied in order (color, blur, glitch, strobe, scanlines, trail, pixelate, kaleido, vignette, text overlay, etc.).
- **Composition stage:** stream outputs are combined with configurable blend modes and optional shared/per-stream FX racks.
- **Output stage:** final frame is drawn into output canvas (used for monitor and looper capture integration).
- **Preview stage:** output is mirrored into the VJ preview canvas with pin overlays/edit handles.

### 3) Stream mapping and geometry
- Supports multiple concurrent streams (up to 8).
- Each stream can be mapped to an editable quad (4-corner transform behavior).
- Corners can be dragged in the preview; double-click on a corner resets it.
- Aspect-ratio preservation can be toggled so visuals can be letterboxed or stretched intentionally.

### 4) FX control model
- FX definitions are centralized and include default/min/max values.
- Each stream can either use shared global FX values or an independent per-stream profile.
- Reactive mode allows selected FX parameters to follow analyser bands (low/mid/high/full).
- Effect blend/composition modes can be selected to alter how FX layers combine.

### 5) Monitor and routing behavior
- A monitor popup window is created via `window.open` and receives the output canvas stream.
- The popup supports quick fullscreen control and keeps the visual output isolated from the main page UI.
- When VJ is enabled, looper video capture can consume this monitor/output stream so recorded visual loops reflect VJ processing.

### 6) MIDI and performance workflow
- MIDI note mappings can target VJ FX parameters.
- Incoming MIDI note-on values can scale FX parameters by velocity.
- Dedicated MIDI mapping is included for toggling text sequence behavior.
- This allows live performance control without needing mouse interaction.

### 7) Stability and UX notes
- Defaults are normalized on load to avoid malformed saved-state issues.
- Renderer start/stop is explicit to avoid background resource churn when panel is hidden.
- Device dropdown fallback logic avoids blank labels in Advanced panel when hardware IDs change.

## Technical highlights
- New VJ rendering/control utilities added in `content.js` (controls state, defaults, persistence, render pipeline, monitor popup, MIDI handlers).
- Advanced panel structure updated so packs-related controls are grouped together.
- Device-select population logic now validates saved IDs against enumerated options before applying selection.

## Suggested QA checklist for release
- Open Advanced panel and confirm output/input/monitor selects show visible defaults immediately.
- Open VJ panel and verify preview updates while YouTube video is playing.
- Drag pin corners and confirm mapped geometry updates in preview/output.
- Open monitor window and verify fullscreen toggle works.
- Trigger mapped MIDI notes and confirm FX values change.
- Confirm Cmd/Ctrl+Y toggles VJ panel reliably.
