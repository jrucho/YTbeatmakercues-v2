# Looper Behavior Guide (Audio + MIDI)

This extension has two independent concepts:

1. **Bank type**: Audio bank vs MIDI bank (the switch decides which bank your loop button controls).
2. **Timing mode**: **FREE** vs **SYNC** (`4 Loopers Sync` toggle).
3. **Performance mode**: **Loopstation** vs **Clip Launcher**.

---

## 1) FREE vs SYNC

## FREE mode (`4 Loopers Sync: Off`)
- Actions execute immediately.
- Each loop runs independently.
- No global quantization alignment is forced.
- No BPM pulse overlay is shown on loop buttons.

## SYNC mode (`4 Loopers Sync: On`)
- Actions are scheduled to quantized bar boundaries.
- If transport is not running yet, a silent transport anchor is started first, then action is scheduled to next boundary.
- BPM pulse overlay appears on loop buttons in **Loopstation mode**.

---

## 2) Loopstation mode

Single loop button follows state machine:
- **Single press**:
  - Empty slot -> record
  - Recording -> close recording
  - Stopped loop -> resume/play
  - Playing loop -> overdub toggle (Loopstation behavior)
- **Double press**: stop currently playing loops in the current bank (Audio or MIDI).
- **Long press**: erase selected slot immediately.

### Panic erase shortcuts
- `Cmd/Ctrl + R/S/D/F` erase slots A/B/C/D of current bank.

---

## 3) Clip Launcher mode

Clip semantics:
- **Single press**:
  - Empty slot -> record/capture clip
  - Stopped clip -> launch
  - Playing clip -> stop (clip-stop behavior)
- **Double press**: stop all currently playing clips in the current bank.
- **Long press**: erase selected clip immediately.

### Exclusive vs layered
- Clip launcher can run exclusive behavior by default (one clip at a time per bank), with multi-launch overrides.

---

## 4) BPM capture during recording

When a clip is captured, metadata is stored:
- `origBpm`
- `origLengthSeconds`
- `bars`
- `timeSig`

Deterministic formula:
- `origBpm = (60 * beatsPerBar * bars) / durationSeconds`

Bars source:
- Per-clip bars override if provided.
- Otherwise global capture default bars.

---

## 5) Playback pitch/time behavior

## Audio clips
- Audio loops are played at their recorded sound by default.
- No automatic BPM varispeed is applied.
- Pitch changes only when user applies loop pitch mode via the pitch fader.

## MIDI clips
- MIDI timing can be scaled against session BPM (event-time scaling), no pitch artifact because MIDI note pitch is unchanged.

---

## 6) Master BPM expectations

- First recorded audio loop establishes master `baseLoopDuration` / `loopsBPM` when no prior audio loop exists.
- If audio loops still exist (even if stopped), new recordings keep current master BPM context.
- If all loops are erased, next new recording becomes new master again.

---

## 7) Bank switch behavior

- Audio/MIDI bank switch changes **which bank your controls target**.
- It does not replace the underlying transport/scheduler implementation.

