# Optional YTBM Stems — 2.4.5

Version 2.4.5 keeps audible stems during prepared speed transitions, renders
available analysed subsections, and adds Automatic processing On/Off plus manual
Process/Resume actions. Off preserves ready PCM; On continues as new native
chunks arrive. See `CONTINUITY-2.4.5.md` for current controls and limits.

Version 2.4.2 prepares cached full/native-buffered stems ahead for Speed/HD
playback, with separate stereo analysis per stem and a bounded 96 MiB PCM
cache. Ready audio bypasses the live stretch buffer. A new rate/tuning waits
for preparation while the committed rate continues. Unity/zero tuning uses
direct audio. See `STEMS-2.4.2-EXPORT.md` for timing and fallback limits.

## Installation and removal

The extension package contains the ONNX Runtime Web engine, **no model**.
Click **Stems ▾ → Download stems package** to download the public HT-Demucs
model (165,612,636 bytes). Progress and Cancel are shown during installation.

An extension-owned offscreen document writes the download to a temporary
`.part` file, checks its full SHA-256, then publishes it as
`ytbm-stems/htdemucs-fp16.onnx` in **extension-origin OPFS**. A fresh browser
profile starts without that file. Startup checks actual verified storage,
not just a saved installation flag. There is no bundled/development fallback.
Transfers use 4 MiB byte ranges and resume transient range failures from the
last written byte, avoiding a single long CDN stream. Cancel/removal still
erases the partial file; this is not a promise to resume across browser restarts.

This is private storage belonging to the extension, not the unpacked source
folder. Chrome cannot automatically write downloads into its installed code
directory. All tabs use the same downloaded model. Uninstall cancels and waits
for any download, terminates all inference workers, deletes the entire model
folder, verifies absence, and restores normal playback in every open tab.

## Audio behavior

- Four inline buttons: Vocals / Drums / Bass / Other. Click mutes; modifier-click
  solos. Right-click opens genuine-stem exports, Reanalyse song and Uninstall.
- A compact percentage in the black stem info box measures actual separated audio
  against the whole song. A processed partial player buffer is not 100%.
  Reanalyse song discards AI results and reruns available source audio, keeping
  the installed model, original audio store and selected mute/solo controls.
- With no mutes/solos, the original audio has a unity bypass. With no model,
  the Stems graph is omitted entirely. All four explicitly muted means silence.
- Controls remain loading/disabled until separated audio for the current
  section exists. An already selected control always remains enabled so
  it can be released. Original audio continues during initial analysis.
  Once stem playback is active, an unavailable cue target waits without
  restoring muted vocals. Release all mutes/solos to restore original playback.
  Source switching uses a 3 ms anti-click ramp, not a long fade.
- **With a verified installed model, analysis starts automatically** on video
  load and after model installation. Mute/solo buttons only change playback;
  they are not required to start conversion. A new video starts a new session.
- When a video launches with the model installed, the extension attempts to
  preload its complete encoded audio into per-tab memory. It looks for current
  player audio URLs and already-requested signed audio URLs; no playback seeking
  or rate change is used to fill the cache. Readable byte ranges are assembled
  into a complete file. Available whole audio is decoded and converted automatically.
- When whole audio is available, automatic analysis prioritizes the segment at
  that position, then processes to the end and wraps to the beginning. Work
  continues while playback is paused. Completed whole-song results export the
  entire song as four WAVs, including the correctly trimmed final window.
- Whole-song preloading is **best effort**, bounded to **64 MB encoded audio
  and ten minutes decoded duration**. Some current YouTube streams expose only
  SABR/segmented playback without a directly fetchable full-audio URL; those
   are also observed at the native MediaSource audio buffer. Buffered WebM/MP4
   initialization and media packets are forwarded in order, decoded, and used
   to analyse ahead of playback where possible. Growing prefixes enqueue new
   complete windows without losing prior results; the partial tail waits for
   the real end. Unsupported/gapped sources fall back to automatic capture.
   No frequency-band substitute is used.
- Capture fallback feeds stereo 44.1 kHz / 7.8-second windows to an
  extension-origin worker, including audio captured while the model initializes.
  Pauses/seeks/end flush the remaining captured samples with padding and keep
  their true valid length, so short clips and the final tail are processed too.
  Processing may be slower than real time; analysed captures can be used on replay.
- Whole-source and native-buffered stem playback follows Pitch, Speed and Speed
  HD at altered rates. Basic Speed uses the existing Signalsmith correction for
  raw stem sources; independent HD tune is retained. The preview/original paths
  are not double-stretched. Raw live capture alone still requires 1× source audio.
- Whole-song loading reports actual completed segments. Capture mode stops its
  initial spinner after the first real result, even when the live playhead is
  ahead of processing. Its status explicitly says to replay processed sections.
  A capture-only pipeline cannot separate unheard audio at the current live
  playhead. A worker request taking over 120 seconds fails visibly instead of
  spinning forever. The Stems menu shows analysis status; no fake loading timers are used.
- Separated song data is memory-only and bounded. Video changes and tab close
  release it; background tabs retain it. Exports reject unanalysed ranges.

## Components and checks

- `model-store.js`: shared install, full checksum verification, cancellation,
  and verified removal.
- `offscreen.html` / `offscreen.js`: extension-origin model and worker ownership.
- `stems-inference-worker.js`: actual HT-Demucs ONNX inference.
- `stem-timeline.js`: segmentation and normalized overlap-add.
- `prepared-stretch.js`: independent stereo offline rendering and bounded,
  serialized lookahead/cache lifecycle.
- `track-source.js`: player-source discovery in the current frame's main world.
- `track-store.js`: bounded whole-audio preloading, deferred decode and cleanup.
- `media-observer.js` / `media-bridge.js`: early native audio-buffer observation
  and isolated-world forwarding, preserving the original player's buffers.
- `buffered-audio.js`: bounded contiguous buffered-audio decoding and segmentation.
- `session-downloads.js`: named temporary per-video OPFS source downloads and
  automatic session/startup cleanup. Full retrieval and buffered prefixes have
  different filenames and completion flags; no video is labelled fully loaded
  simply because its current player buffer has been processed.
- `vendor/`: official ONNX Runtime Web 1.22.0 WebGPU/WASM distribution,
  with upstream MIT license and third-party notices.

Run `npm test` for routing, lifecycle, timeline, cue, sidechain, HD speed and
VJ checks. `bash build_release.sh` builds a fresh allowlisted, model-free ZIP.
See `CONTINUITY-2.4.5.md` in the package root for the latest update and
`STEMS-2.4-EXPORT.md` for the underlying 2.4 export,
measured browser button tests, and installation instructions.

## Where to inspect storage

Open **Extension options → Stems storage and diagnostics**. This read-only page
shows the actual extension ID/origin, verified model size/path, per-video stem
sample-buffer allocations, preloaded audio and inference workers. It does not
start conversion or download the model by itself.

- Persistent model: extension-origin OPFS, `ytbm-stems/htdemucs-fp16.onnx`.
- In-progress download: same folder, `htdemucs-fp16.onnx.part`.
- Stem results: video-frame JavaScript RAM, `stemState.ai.timeline.segments`.
- Temporary source files: OPFS `ytbm-stems/videos/<video-id>-<safe-title>-<session>/`.
- Decoded whole-song audio: offscreen-document RAM, `trackStore.entries`.
- Native-player compressed/decoded audio: offscreen RAM, `bufferedStore.entries`.
- Exported WAVs: Chrome's configured Downloads destination; use
  `chrome://downloads` → Show in Finder for each actual file.

The Download button remains hidden during verification and when a valid model
is present. A check failure offers Retry model check, not a misleading download.
The saved installation flag is repaired from the actual file. Reload/disable
and browser restart should preserve that file for the same ID/profile.
Removing the extension, selecting Uninstall stems, clearing its storage, or
loading a different unpacked-folder ID/profile can leave no model to detect.
Chrome's opaque backing files are not a normal `.onnx` file in the source folder.
