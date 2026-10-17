# Release 2.4.1

- Remove the duplicate model-install download line, keeping the first progress label.
- Restore compact song-separation percentage beside the inline stem controls and in the menu. Count actual non-overlapping output against the entire song, including partial buffers and out-of-order results.
- Preserve initial audio packets during same-tab navigation, flush pre-attachment headers on media readiness, and retry the MAIN/isolated-world connection if startup is delayed.
- Keep an already-started session on its first metadata event; initialize new video URLs even if their initial metadata event was missed.
- Replace **Stop analysis** with **Reanalyse song**. Clear AI results and start again from available original audio, without redownloading the model or losing selected mute/solo states.
- Set extension/package versions and display name to **2.4.1**.

---

# Release 2.4

## Summary
Release **2.4** adds the optional browser-only Stems pack (Pitch/Speed/Speed HD untouched when not installed), click-free audio looper start/stop, plus reliability fixes for packaged-asset loading.

## Changes
- Wake cached stem playback on cue seek readiness instead of waiting up to 150 ms for the scheduler poll. Keep coverage gating and unavailable-target silent holds.
- Use shared black tooltips across extension controls, compact stem hints and short download percentages. Display the version as **2.4**.
- Stop orphaned stem processing after extension-context invalidation, fence late worklet loads and restore original audio. Verified actual extension Reload followed by tab refresh without invalid-context warnings. Standard release asset: `ytbeatmakercues-2.4.zip`; full-track SABR retrieval remains a documented limitation.
- Browser-only update: preserve stem mute/solo states in Pitch, Speed and Speed HD using rate-aware scheduling and the existing Signalsmith correction for raw stem audio. Add independent-rate cancellation and preview/original double-stretch protection.
- Automatically store retrieved source audio in named temporary OPFS video folders with explicit complete/prefix metadata. Remove temporary source files on video/frame close, resource removal and next host startup after interruption. No native helper/server or experimental SABR package is shipped; complete retrieval of SABR-only songs remains unverified.
- Fix growing native-player buffers being ignored after the first decode; wait for complete model windows and serialize initialization/media packets. Preserve requested stem mutes across cues with a silent wait for unavailable AI sections, rather than leaking original audio then fading. Use a 3 ms path ramp. Enable isolated four-thread WASM fallback where supported.
- New **Stems ▾** button on the minimal bar (before Cues). Without the pack it only offers the one-time model download; the extension otherwise behaves exactly as before.
- After install, a compact row of 4 stem buttons (Vocals/Drums/Bass/Other) sits embedded in the bar. Click = mute, modifier-click = solo, right-click = download stem(s) / uninstall.
- Original-audio bypass with no stem mutes/solos, including immediately after install. No frequency-band substitutes; unavailable AI sections keep original audio during initial analysis and wait silently after split playback has started. Session-only stem cache (cleared on tab close / video change, kept for background tabs).
- Fixed stem-bus teardown muting video audio on FX re-routing; guard against stale AudioContext nodes.
- Packaged sounds now load via the background worker (base64) with direct fetch as fallback — no more "Unsafe attempt to load URL" spam and no alert storms.
- Model downloaded on demand from a pinned public HT-Demucs export into extension-origin OPFS; full byte-count and SHA-256 verification before publication. No bundled development model or model in the ZIP. Uninstall aborts downloads, closes workers across tabs, erases the model folder and verifies absence.
- Extension-owned offscreen workers run actual ONNX inference automatically when a verified model and video are available. Capture mode stops the initial spinner after its first real result and identifies replay-only processed sections. Worker requests time out visibly after 120 seconds; diagnostics include backend selection and per-window inference time.
- Best-effort whole-song audio preload on video launch (64 MB / ten minutes). Automatic conversion prioritizes the current segment and then processes the accessible full song, even while paused. Completed results export whole-song WAVs. Non-downloadable/segmented sources use native buffered audio or automatic capture; raw capture requires 1× and cannot process unheard audio at the live playhead.
- Hide Download until actual model verification confirms absence; restore the installed flag from verified OPFS bytes. Options now links to a storage inspector with extension ID/origin, model SHA verification and live sample-buffer allocations.
- Download the model in resumable 4 MiB ranges to recover from CDN HTTP/2 stream failures; verify the entire SHA-256 before publishing it. Flush partial captured windows on pauses/seeks so short clips and the final tail are analysed.
- Loop playback uses 8 ms start/stop fades. Retiring gains/sources are released even during rapid retriggers. Touch Tap BPM switches to Internal clock, and loop pitch updates both legacy and class playback sources.
- Updated manifest/package versions to **2.4**.

---

# Release 2.3.8

## Summary
Lower-latency HD profiles and native cross-tab YouTube VJ feeds, targeting four or more inputs with a 1080p/30 output.

## Changes
- Quality uses the same 160 ms analysis window with an 8 ms processing interval, reporting approximately 168 ms engine latency instead of 180 ms, at increased CPU cost.
- Balanced uses a 96 ms window / 8 ms interval (~104 ms); Live uses a 64 ms window / 4 ms interval (~68 ms). These are explicit quality/latency tradeoffs, not lossless replacements.
- Profile changes retain speed/tuning and update the actual latency tooltip; changing profiles resets the analysis buffer and can briefly interrupt playback.
- Native local WebRTC transports video-only captured media tracks to one elected compositor. No external STUN/TURN/relay is used; bitmap snapshots are a bounded fallback only.
- Use the visible monitor window's render clock, cap the stage at 1920×1080 and 30 fps, skip duplicate render work, optimize affine quads, and reuse scratch canvases.
- Negotiate only demanded sources (up to eight) and temporarily support an additional receiver when recording a VJ mix from another tab.
- Add decoded-frame FPS/drop statistics, bounded resolution, stale-session protection, reconnect handling and explicit fallback status.
- Protect active VJ tabs from automatic discarding and request display wake protection only during the live session; restore original discard flags on stop.
- Persist tab registration/protection in chrome.storage.session so service-worker idle restarts retain order and session state.
- Updated manifest/package versions to 2.3.8 and added the power permission for session wake protection.

## Scope and limits
Browser/device latency remains in addition to the reported HD engine delay. Chrome energy/freezing policies cannot be globally disabled by an extension. Codec, network, CPU/GPU and thermal limits can still reduce frame rate; snapshot fallback is not a guarantee of background 30 fps. Keep the output/monitor visible and validate your actual YouTube clips before publication.

---

# Release 2.3.7

## Summary
Release **2.3.7** adds independent semitone tuning to Speed HD and improves cue and sidechain click handling without adding an audio buffer.

## Clean changelog
- Show the tuning control only in Speed HD; arrows change tuning in one-semitone steps from −24 to +24, and clicking the value resets it to zero.
- Keep playback speed, Percent/Semitones fader units, and HD tuning independent.
- Remember HD tuning when switching modes, applying it only in Speed HD.
- Combine tuning and speed-related pitch correction in the existing Signalsmith processor without adding another buffer or changing its analysis configuration.
- Support nonzero HD tuning at normal playback speed, while bypassing HD processing at normal speed with zero tuning.
- Keep Pitch and basic Speed on the direct path, without HD processing latency.
- Include the tuning value in app-state snapshots and apply the actual tuned pitch to the instrument's video-pitch-follow setting.
- Disable tuning arrows if the HD engine is unavailable; the number still allows resetting to zero.
- Unify keyboard, MIDI, pad, sequencer and remote cue playback through a short, interrupt-safe gain envelope.
- Keep the existing 2 ms fade-out, then fade back in when the media seek is ready rather than before the decoder supplies the new audio.
- Cancel obsolete cue callbacks and preserve gain continuity during rapid retriggering. Recover safely from failed seeks and source changes.
- Replace the legacy hidden-deck cue crossfade with the same visible-player seek path; no new audio buffer or additional fixed cue delay is introduced.
- Remove instantaneous sidechain gain resets and retrigger from the current envelope value. Smooth the attack/release edges over up to 3 ms, preserving the curve's overall duration without a new buffer or trigger timer.
- Updated extension and package versions to **2.3.7**.

## Processing latency
Speed HD uses the same approximately 180 ms processing buffer as 2.3.6, including when tuning. Pitch and basic Speed bypass that buffer; normal browser/device latency still applies.
Cue smoothing uses a 2 ms gain fade, matching the previous keyboard fade. Decoder seek time still depends on the media source; it does not add a buffering stage or a longer fixed cue delay.

---

# Release 2.3.6

## Summary
Release **2.3.6** adds a three-step Pitch/Speed/Speed HD control on the minimal bar and Signalsmith Stretch pitch-preserving speed processing.

## Clean changelog
- Added a clickable **Pitch → Speed → Speed HD → Pitch** label with keyboard focus and pressed-state feedback. Speed uses browser pitch preservation; Speed HD uses Signalsmith Stretch.
- Added official **Signalsmith Stretch 1.3.2** for Speed HD, a locally bundled MIT-licensed WebAssembly spectral engine.
- Use a 160 ms analysis window, 20 ms processing interval, stereo processing and split computation for quality-focused live pitch correction, including +12 semitone correction at half-speed.
- The Speed HD tooltip reports engine readiness, actual latency, and browser fallback status.
- Routed both cue decks and the video-loop preview through pitch correction; processed video audio also reaches existing effects, stems, and recorder routing.
- Bypass processing at normal speed and fall back to browser pitch preservation if the worklet is unavailable.
- Keep Percent/Semitones selection when switching between Pitch and Speed, including when changing units inside Speed mode.
- Fixed percentage-to-semitone conversion when switching Video/Loop targets.
- Keep instrument pitch unchanged in Speed mode.
- Updated extension version to **2.3.6** in `manifest.json`.

## Processing latency
HQ processing adds approximately 180 ms of audio latency, as reported by the engine. Normal speed uses the direct dry path. Extreme settings can still produce artifacts; perceived quality depends on the source material.

## Local development
Run `npm ci` to restore the pinned Signalsmith distribution, `npm test` for the WASM audio checks, and `bash build_release.sh` to package the extension. The release ZIP includes the engine and its MIT notice; no runtime CDN is used.

---

# Release 2.3.5

## Summary
Release **2.3.5** adds dedicated output routing controls for video/drums stems, a main-output mute option, device-name unlock, and lower-latency input/output handling improvements.

## Clean changelog
- Added dedicated **Video output** and **Drums output** selectors in Advanced view.
- Added **Mute main output** option to the main output selector.
- Added **Unlock device names** button to request mic permission and refresh device labels.
- Improved auxiliary output routing with a low-latency bridge path when `AudioContext.setSinkId` is supported, with `HTMLAudioElement` fallback.
- Improved low-latency defaults for extension input and monitoring input via shared low-latency capture constraints.
- Added active mic device hot-switch behavior so input changes are applied immediately while mic is armed/live.
- Updated extension version to **2.3.5** in `manifest.json`.

---

# Release 2.3.3

## Summary
Release **2.3.3** fixes MIDI cue-note routing so mapped notes (including note 45) reliably trigger their assigned cue slots.

## Clean changelog
- Fixed MIDI cue lookup to return the actual mapped cue storage key instead of derived index values.
- Fixed MIDI cue metadata comparisons to use numeric normalization for note/channel matching, improving compatibility with saved mappings.
- Updated extension version to **2.3.3** in `manifest.json`.

---

# Release 2.3.2

## Summary
Release **2.3.2** focuses on Super Knob reliability and cue-time safety fixes for MIDI workflows.

## Clean changelog
- Fixed Super Knob runtime errors caused by missing handler wiring in MIDI CC paths.
- Fixed non-finite cue-time writes that could later trigger media `currentTime` errors.
- Reworked Super Knob movement to a stable wrapped 0–127 delta path for predictable behavior across controllers.
- Restored Shift-as-clutch behavior for Super Knob: while held, movement is consumed without moving cues so hardware knobs can be re-centered.
- Improved endless/infinite encoder behavior to avoid sudden jumps from beginning to end while scrubbing cues.
- Hardened Super Knob value checks to ignore invalid numeric input safely.
- Updated extension version to **2.3.2** in `manifest.json`.

---

# Release 2.3.1

## Summary
Release **2.3.1** fixes Touch Sequencer popup spacing consistency after reopening, while carrying forward all features from 2.2.

## Clean changelog
- Fixed Touch Sequencer popup control spacing so button/input rows keep consistent vertical alignment after closing and reopening the popup.
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
- Updated extension version to **2.3.1** in `manifest.json`.

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
