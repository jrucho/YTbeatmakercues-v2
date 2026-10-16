# 2.4

Primary package: **ytbeatmakercues-2.4.zip**.
Chrome version and displayed version name: **2.4**.

## Install/update

Use this ZIP, extract it, and load its folder through `chrome://extensions` →
**Load unpacked**. For an existing installation at the same folder, replace
the files, click **Reload**, and refresh the video tab. Keep only the intended
Beatmaker copy enabled during this test; old unpacked copies have separate
audio graphs and storage identities. Removing/re-adding the extension or moving
its folder can change its identity or discard its model storage.

The ZIP contains **no model**. An existing valid model in the same ID/profile
is detected. Otherwise install it from **Stems → Download stems package**.

## Controls and readiness

- Analysis starts automatically after a verified model and a video are available.
- The four existing inline controls are mute toggles. Shift/Cmd/Ctrl-click solos.
- A loading control becomes available when AI audio for that section exists.
  It cannot claim a mute succeeded while only the original mix is available.
- All four unmuted use original audio. All four muted produce silence.
- Selected mutes remain in force through cues to analysed sections. If a cue
  targets unavailable audio after stem playback has begun, it waits without
  briefly restoring the muted vocal. Clear selected mutes to restore original.
- Separated playback from complete or buffered sources supports **Pitch, Speed
  and Speed HD**, including rate changes and independent HD tuning. Raw live
  capture still requires 1× to collect correctly timed source audio; existing
  buffered/full-source results continue at altered rates.
- Before full-song audio is accessible, only sections actually buffered by the
  native player can be analysed ahead. A full song is not promised before the
  browser has supplied that audio. Unsupported sources keep controls loading
  rather than substituting frequency filters.

## Confirmed fixes

- Wake stem playback immediately when a cue seek becomes ready, removing the
  additional wait of up to 150 ms for the periodic scheduler. Already-separated
  cues need no new inference; unanalysed targets still wait for coverage.
- Use shared black tooltips for extension controls, with compact stem hints and
  download percentages. Host-page tooltips retain their original behavior.
- Extension reload/update invalidates old content scripts. Stem tasks now stop
  once, cancel pending capture setup, and restore original audio without repeated
  worklet warnings. Refresh the video tab to reconnect. This was tested with a
  real `chrome://extensions` Reload while the audio worklet was active.
- Do not erase the native compressed initialization prefix on initial
  missing-model checks: this broke installing the model in an already open tab.
- Reconnect a replaced visible video instead of selecting its hidden cue clone.
- Do not rebuild the FX/output graph on every ordinary stem-control press.
- Process growing buffered prefixes; do not submit an incomplete final window.
- Keep the end of an analysed song on AI audio, instead of falling back for the
  last fixed-size scheduling window.
- Respect native player volume/mute on decoded stem playback.
- Keep the original untouched with no selected mute/solo; use short 3 ms path
  ramps and existing anti-click shaping instead of a long original-to-stem fade.

## Verification on 2026-10-16

Measured real Web Audio output in Chromium **149.0.7827.55**, using the actual
downloaded HT-Demucs model through ONNX Runtime Web, not mocked model output.

| Browser workflow | Result |
|---|---|
| Speech + drums + bass + keyboard, direct audio source | PASS |
| Replace the visible video with a new element, then repeat controls | PASS |
| Native MediaSource/WebM source with no downloadable song URL | PASS |
| Real YouTube `jNQXAC9IVRw`, native buffered audio | PASS |
| Each individual mute, only Other left, all four muted, restored mix | PASS on all sources above |
| Vocal solo and cue jumps while using stems | PASS on all sources above |
| Cached cue readiness with the 150 ms scheduler poll disabled | PASS; actual stem sources queued on seek readiness |
| Black tooltips, compact hints/download percentages, keyboard access | PASS; native host-page titles preserved |

In the controlled direct-source fixture, four cached cues reached readiness in
approximately 10–12 ms from the trigger, with polling disabled. This measures
seek/scheduling readiness, not end-to-end audible latency on every device.

Example measured real-YouTube output RMS over the test section:

| Selection | RMS | Active path |
|---|---:|---|
| Original | 0.11696 | original |
| Vocals muted | 0.02528 | AI |
| Drums muted | 0.06682 | AI |
| Bass muted | 0.08503 | AI |
| Other muted | 0.08958 | AI |
| Only Other audible | 0.02384 | AI |
| Original restored | 0.11696 | original |
| Vocals solo | 0.11044 | AI |

All-muted output was asserted to be zero. RMS differences demonstrate changes
in actual playback, not a general separation-quality rating for every song.
The real YouTube consent dialog was dismissed via its Reject option before
the test; the site deliberately pauses playback while that dialog is open.

The browser test is `tests/browser-stems-audit.cjs` with `YTBM_RELEASE_ONLY=1`,
`YTBM_LIVE_YOUTUBE=1`, and the documented external test-tool/fixture paths.
It is opt-in and is excluded from the extension package. No new application
dependency was added. The ordinary regression command is `npm test`.
The extension-reload regression is `tests/browser-stems-context-reload.cjs`.

## Resource storage

Model: extension-origin OPFS `ytbm-stems/htdemucs-fp16.onnx`, **165612636 bytes**.
Temporary source downloads: `ytbm-stems/videos/<video-id>-<safe-title>-<session>/`
with `video.json` and `source.audio` or `source.audio.part`. A partial native
buffer is explicitly partial; it is never advertised as a complete song.
All per-video source downloads are deleted at session cleanup and stale
temporary downloads are deleted on the next host startup after an interruption.
Separated sample buffers and decoded audio remain in RAM. Only explicit WAV
exports are retained as user-saved audio. Options → **Stems storage and
diagnostics** reports paths, byte counts and the installation identity.

## Browser-only full-track retrieval status

The supplied video `9eoABXv4lGg` is approximately 303.46 seconds and uses SABR.
An embedded `googlevideo` client was evaluated in an isolated temporary test
project. Current protocol/session handling did not reliably retrieve the full
track; responses stalled after prefixes. A local companion/server was declined,
so no native helper, server dependency, experimental protocol client or new
production package was added. The incorporated direct-source downloader remains
best-effort, with native buffered-audio capture as the verified fallback.
This update does not claim guaranteed full-song downloads for SABR-only videos.

Pitch/stretch was measured with the actual separated 110 Hz bass stem in Chrome:
half-speed Pitch ≈55.7 Hz; 1.5× Pitch ≈165.5 Hz; Speed/Speed HD at 0.5× and 1.5×
≈109.9 Hz; half-speed Speed HD with +3 st ≈131.8 Hz. Muted vocals, drums and Other
remained muted in these checks. The existing HD processing latency still applies;
this is not a claim of zero-latency or sample-perfect browser/device output.

This export was tested against the sources above; this is not a claim of
universal codec/DRM/live-stream support.
