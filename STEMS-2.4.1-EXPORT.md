# 2.4.1

Package: **ytbeatmakercues-2.4.1.zip**. Chrome version/display name: **2.4.1**.

## Changes

- Keep just one model-install download line, above Cancel.
- Show the percentage of the song separated in the black stem info box.
  The menu also reports progress and loaded audio duration. Actual output
  windows count once, including overlap and out-of-order results. Processing
  all of a partial player buffer does not count as separating the whole song.
- Preserve early compressed audio during same-tab video changes, flush headers
  on media readiness even if no later packet arrives, and retry the initial
  MAIN/isolated-world connection when script startup order differs.
- Do not reset an already-started song session on its first metadata event.
  URL changes also start the next session if its metadata event was missed.
- Replace **Stop analysis** in the right-click menu with **Reanalyse song**.
  It clears previous AI results and starts again from the available original
  song audio. The installed model and current source audio are reused. Selected
  mutes/solos remain selected, with a silent wait if their new results are pending.

## Install/update

Extract the ZIP. For an existing unpacked installation, replace files in the
same folder, click **Reload** in `chrome://extensions`, then refresh existing
video tabs once to load the updated extension scripts. Subsequently opened
video links should initialize automatically. Keeping the same extension
identity preserves its verified model storage.

## Limits

Full-song retrieval remains best effort. The separator cannot process sections
the browser has not supplied. **Reanalyse song** repeats analysis of available
audio; it does not bypass SABR retrieval limits. Raw capture-only sources still
require playback at 1× and can analyse only audio that has been captured.
Pitch/Speed/Speed HD and the existing model/downloader remain supported as in
2.4. See `STEMS-2.4-EXPORT.md` for the underlying audio/storage design.

## Verification

- **120 automated tests passed**, including early-header retention, delayed
  bridge startup, first metadata, overlap-correct progress and fresh reanalysis.
- Chromium **149.0.7827.55**: fresh installation through the real UI, one
  download line, and working mute/solo/cues in the same document without refresh.
- Native MediaSource/WebM fixture: delayed first metadata, full reanalysis through
  the right-click menu, then two same-document video changes. All stem controls
  and cues passed after each, using actual HT-Demucs output.
- Actual live YouTube playback: individual mutes, solo, all-muted silence,
  original restoration, cue jumps and Pitch/Speed/Speed HD passed.
- Temporary source files were reclaimed when video sessions closed. Actual
  Chrome extension reload restored original audio with no invalid-context
  warnings or exceptions, followed by a valid refreshed content script.

Browser audits are opt-in: `tests/browser-stems-audit.cjs` (release checks and
`YTBM_UI_INSTALL=1 YTBM_STARTUP_ONLY=1` for fresh UI startup) and
`tests/browser-stems-context-reload.cjs`. Test tools and model fixtures are
external to the release ZIP. The ZIP contains no model.
