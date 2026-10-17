# Speed stability — 2.4.1

Historical 2.4.1 behavior. Version 2.4.2 restores unity bypass and adds prepared
stem playback; see `STEMS-2.4.2-EXPORT.md` for the current playback paths.

Package: `ytbeatmakercues-2.4.1.zip`.
This revision includes the tested speed-stability changes.

## Changes

- Apply stem rate changes in the same main-thread turn as pitch correction,
  rather than leaving old-rate queued audio until the 150 ms scheduler poll.
- Retime sounding stem buffers in place, preserving their sample position and
  overlap envelopes. Cancel only obsolete future buffers. During fader movement,
  reduce future PCM allocation instead of repeatedly rebuilding 1.5 seconds.
- Gate the processed output on cue seeks and clear spectral history when the
  decoder is ready. Reopen only for fresh audio, with generation fencing for
  rapid retriggers. Pitch mode's direct cues retain their existing timing.
- Keep Speed HD processing enabled at 1×, including zero independent tuning.
  Basic Speed's raw separated-stem correction also stays enabled at 1× and
  while waiting for a selected stem. This avoids repeated dry/delayed blends.

## Timing and limits

The HD window/profile sizes have not increased. Quality/Balanced/Live retain
their approximately 168/104/68 ms engine latency. That latency now remains at
1× in HD mode. After a cue, clearing history requires fresh input to traverse
the existing processor delay: the old note is suppressed rather than replayed.
Basic Speed with original/native audio still uses Chrome pitch preservation;
its internal seek/stretch behavior is not controlled by this spectral reset.
Fast tempo changes, transients and extreme stretching can still produce
spectral artifacts. These checks do not establish artifact-free sound for
every song or device.

## Checks

`npm test`: 121 checks, including in-place rate changes, overlap preservation,
and cancellation of obsolete cue resets. Actual Chrome tests use the real
HT-Demucs output and Signalsmith engine: fader changes from 0.7× through 1× to
1.2× and back retain the active sources with immediate rate updates. In the
controlled cue test, processed output was zero at the warmup sample and
recovered to RMS approximately 0.049–0.056 afterward. Existing pitch, stem,
native MediaSource, reanalysis, navigation, cleanup and live YouTube playback
checks passed. This verifies the transition bugs, not a universal wobble score.

Reload the extension and refresh the video tab after updating.
