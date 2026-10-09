# 2.3.8 latency and VJ validation guide

Use this guide to choose an HD latency profile and validate multi-tab VJ performance with your clips and hardware.

## Install
1. Turn VJ FX off in the previous build to end its live session before reloading.
2. Extract `ytbeatmakercues-2.3.8.zip` and load that folder in `chrome://extensions` using **Load unpacked**, or update the files in the existing unpacked installation and reload it.
3. The new `power` permission enables session-only display/sleep protection.
4. Refresh **all** participating YouTube tabs so they run the same transport version.

## HD audio latency
Open **Advanced → Speed HD latency**:

| Profile | Analysis window | Engine latency | Use |
|---|---:|---:|---|
| Quality | 160 ms | ~168 ms | Keeps the previous long window; more overlap/CPU |
| Balanced | 96 ms | ~104 ms | Lower delay with some quality tradeoff |
| Live | 64 ms | ~68 ms | Most responsive; more risk of bass/transient artifacts |

These are engine-reported values, not total speaker/device latency. Select profiles before a performance: changing a profile resets its analysis buffer and can briefly interrupt audio. Speed and the separate HD tuning value are retained. Pitch and basic Speed continue to bypass the HD buffer.

Try half-speed, normal speed with nonzero tuning, rapid cues and sidechain retriggers. Compare bass, drums and sustained notes between profiles. Quality is the conservative default; the larger latency reductions require shorter windows.

## Four native VJ feeds
1. Open four regular YouTube video tabs in the same Chrome profile/window. Start each video once while its tab is visible.
2. Enable **VJ FX**, select **4 streams**, and enable **Include streams from other tabs**. VJ controls are shared between YouTube tabs.
3. Open the VJ **monitor** from the tab you want to own the output. Keep that window visible/fullscreen while the source tabs stay behind it.
4. The status line reports native remote-feed counts and decoded FPS. For four inputs including the output tab's local video, expect three native remote feeds. Recorded/24/25 fps source clips can naturally report below 30 fps while the output remains capped at 30 fps.
5. Check that each tile shows changing motion, not just a static frame. Switch cues, change tab order, pause/resume sources, close/reopen a source tab and try VJ mix recording.
6. Test for at least ten minutes with **Solo active tab audio/MIDI** on and the source tabs in the background. Native media delivery is independent of a per-frame JavaScript timer; it is not a global switch that disables every Chrome background policy.
7. If it reports **snapshot fallback**, that input is using bounded image snapshots and may slow in the background. Check the source tab's status/error. Native feeds depend on captureStream/WebRTC availability and normal unprotected video content.

## More feeds and power
After four feeds are stable, try six and eight. The feed transport bounds resolution to the mosaic, but YouTube source decoding, effects and WebRTC encoding still consume resources. Avoid unnecessarily high source quality such as four/eight 4K videos for a 1080p mosaic.

Live VJ requests that participating tabs not be automatically discarded and keeps the display/system awake. Turn **VJ FX off** when finished to restore the original discard settings and release wake protection. This does not override OS thermal throttling or globally turn off Chrome Energy Saver. Keep browser hardware acceleration enabled for the normal performance test.

## Verification performed locally
- Audio checks cover pitch accuracy, stereo phase, HD tuning, profile latency and gain-transition continuity.
- Native Chrome transport checks use four tabs with ordinary and MediaSource-backed video. The source tabs were hidden behind the output; moving-frame hashes, decoded FPS and decoder drop counters were checked.
- A separate monitor-window clock continued the 1080p composition with all four source tabs hidden.
- These isolated tests do not replace validation with your actual YouTube streams, effects, device and performance length.
