# 2.4.5 — continuous prepared transitions and processing preferences

Package: **ytbeatmakercues-2.4.5.zip**.

## Speed and tuning during analysis

- Preparation now uses the actual contiguous analysed subsection, instead of
  requiring unanalysed audio before/after the whole nominal four-second tile.
  Missing intervals are never fabricated or filled with original mixed audio.
- Existing 1× stem playback continues while its first changed speed/tuning
  renders. Already-prepared playback retains its committed rate as before.
- New settings commit only when their required lookahead is prepared, including
  tile crossings or wrapped IN/OUT coverage. Previous audio is retired after
  replacement buffers have a real scheduled start, with a short transition.
- This addresses avoidable cuts on already-analysed sections. It does not
  promise instantaneous rendering, artifact-free parameter changes, or audio
  from portions the player/model has not supplied. An initial mute with no
  prepared selected-stem path or a cue into unavailable audio can still wait.

## Automatic processing On / Off

Right-click a stem or the inline stem group's gap for the Stems menu:

- **Automatic processing · On** (default): start on new videos, keep processing
  available windows even while paused, and wait for newly buffered chunks until
  the complete accessible song is separated. A processed prefix is not 100%.
- **Automatic processing · Off**: save this preference across videos/tabs and
  stop background inference without deleting the model or ready stem audio.
  Existing analysed playback, mute/solo, loops and prepared speed controls remain
  usable where their source audio exists.
- **Process this video / Resume processing this video**: manually start/resume
  the current song while leaving the saved automatic preference Off.
- Turning automatic processing back On resumes queued work. Reanalyse song
  still deliberately discards results and starts a fresh run when requested.

Off applies immediately to inference; an already-started source transfer may
finish. Automatic/native-buffer processing cannot force YouTube to supply the
entire song. SABR/player buffer caps, unavailable chunks and worker errors remain
real limits. Capture-only fallback can analyse captured audio, not unheard audio.

## Mini-bar visibility

The Cues icon next to CC remembers your show/hide choice for the current tab's
session. An open mini bar stays open across video changes/reloads; a closed
bar stays closed. A fresh session defaults to closed. Audio and loop settings
are not stopped by this visual switch.

## Verification scope

- **148 automated tests passed**. Regressions cover available-island tile planning, no fabricated
  gaps, retained unity playback, prepared lookahead, source handoffs, capture
  pause anchors, manual/automatic worker readiness and tab visibility persistence.
- Actual Chrome/HT-Demucs/Signalsmith test: only model window 1 of a 30-second
  track was initially analysed. With a vocal mute and an IN/OUT region in that
  window, Speed and Speed HD rate/tuning changes retained the audio path while
  separation continued. The sampled test found no zero-output or waiting-state
  samples during preparation and the observed handoff. This is not a universal click/wobble measurement.
- Real native MSE chunks arrived in two batches while the video stayed paused.
  The separator waited at 51%, accepted the remaining audio, retained its first
  result and reached 100% without another user action.
- Chrome verified Off preserves cached playback, prevents automatic startup on
  the next video, allows a manual run, and resumes the longer original video to
  100% when turned back On. Native Cues visibility was checked across SPA
  navigation, reloads, fullscreen and rebuilt controls.
- Final packaged Chrome checks also passed existing Pitch/Speed/HD frequencies,
  mute/solo/cues, region loops, replaced players, native MSE, reanalysis,
  live YouTube and temporary-source cleanup.

Browser tests are opt-in in `tests/browser-stems-audit.cjs` using
`YTBM_PARTIAL_TRANSITIONS_ONLY=1`, `YTBM_PROCESSING_ONLY=1` or
`YTBM_PLAYER_SWITCH_ONLY=1`. Fixtures/tooling and the model are outside the ZIP.

## Update

Replace files in the existing unpacked extension folder, reload at
`chrome://extensions`, then refresh existing video tabs. Preserve the same
folder/extension identity to retain the installed model/settings. No model is
bundled, and the separation model/download limits are unchanged.
