# 2.4.4 — native player Cues switch

Package: **ytbeatmakercues-2.4.4.zip**.

## Controls

- A real **button element** inside YouTube's right-hand player controls toggles
  the mini bar. It sits directly after **CC**, with Settings as a fallback anchor
  if captions controls are absent. This is an extension-added button using the
  native player row, not a floating overlay or an official YouTube feature.
- The icon-only cue-pad symbol uses a 24 px SVG, with a larger play triangle
  inside its first pad. It has no separate square/circle hover background;
  YouTube's existing control-group pill remains the visual surface.
- The tooltip/accessibility label says **Show Cues mini bar** or **Hide Cues mini
  bar**. A small underline indicates the shown state. Enter/Space activate the
  focused native button.
- The mini bar **starts hidden for each video**. Pausing/resuming the same video
  does not reset an explicit show choice. New video navigation hides it again;
  ordinary cue/region URL updates do not.
- Hiding is visual only: playback, stem selections, speed/tuning and region
  loops continue. Associated mini-bar menus close, but analysis is not stopped.
- The button remounts when YouTube rebuilds its controls, including nested CC/
  Settings groups. Fullscreen uses the same player button and moves the mini
  bar into the fullscreen player. Exiting fullscreen moves it back.

## Speed HD and stem-mute investigation

Speed HD speed and independent tuning support stem mute/solo. The tested order
was changing speed/tuning on original playback, then muting vocals: 0.65×/+3 st,
1.5×/−3 st and 1×/+5 st. Actual HT-Demucs/Signalsmith output retained the other
stems on both controlled audio and live YouTube. No persistent all-muted state
was reproduced, so no speculative audio/DSP fix was added.

The first transition to a new prepared speed can deliberately wait silently
while it renders. Observed preparation was roughly 1–3.6 seconds in these
checks, not a universal upper bound. Unanalysed/unbuffered sections can take
longer. Silence that persists after preparation is not expected and needs its
specific video/position/state reproduced. Clearing selected mutes restores the
original path; Reanalyse song remains available in the stem context menu.

## Verification

- **138 automated tests** cover existing audio, loops, controls and the new
  hidden/show visibility state, including preserving audio/loop settings.
- Chromium **149.0.7827.55**: hidden startup, native button placement directly
  beside CC, keyboard activation, same-tab navigation, nested control replacement,
  fullscreen entry/exit, and continued playback while hidden.
- Live YouTube verified the real control row, native control height, no overlap
  with Settings and no extension insertion exceptions. The former `insertBefore`
  container error is addressed by inserting into CC's actual parent group.
- Hover checks assert that both the button and inner icon background stay
  transparent. The icon is centered and its play glyph dimensions are checked.

Opt-in browser audit: `tests/browser-stems-audit.cjs` with
`YTBM_PLAYER_SWITCH_ONLY=1 YTBM_PLAYER_SWITCH_LIVE=1`; the Speed HD investigation
uses `YTBM_HD_MUTE_ONLY=1` or live checks with `YTBM_HD_MUTE_LIVE=1`.

## Update

Replace files in the same unpacked extension folder, reload it at
`chrome://extensions`, then refresh existing video tabs. Keeping the same
folder/identity preserves the installed model. The ZIP contains no model.
