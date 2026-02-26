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


---

## 8) New usability indicators

- **FREE/SYNC badge** is shown near the loop mode controls so you can instantly see current timing behavior.
- **Next boundary line** shows estimated time until next quantized bar in SYNC mode.
- In FREE mode it displays `-- (FREE mode)`.
- When double-press STOP is quantized in SYNC, a small toast appears:
  - **"Stop armed for next bar"**

---

## 9) Double-press target mode

A control named **Double Press: Active / All** defines what double-press STOP affects in the current bank:

- **Active**: only the selected slot (A/B/C/D).
- **All**: all currently playing loops/clips in current bank.

Behavior by timing mode:
- **FREE**: stop executes immediately.
- **SYNC**: stop is armed to next bar boundary.

---

## 10) Recommended workflows (shortcuts included)

## Fast Loopstation jam (Audio)
1. Set **Mode: Loopstation**.
2. Choose **FREE** for instant behavior or **SYNC** for bar-tight behavior.
3. Use `R/S/D/F` to select slot A/B/C/D and perform single-press state machine.
4. Use **double press** to STOP (active or all depending on your setting).
5. Use **long press** to ERASE selected slot.

## Tight Clip Launcher performance
1. Set **Mode: Clip Launcher**.
2. Use **SYNC** for musical scene changes.
3. Launch clips with single press.
4. Use **double press** to stop active/all clips at next boundary.
5. Use `Cmd/Ctrl + R/S/D/F` for immediate panic erase per slot.

## MIDI bank performance
1. Toggle to **MIDI Loopers** bank.
2. Keep same FREE/SYNC and Loopstation/Clip semantics.
3. Prefer SYNC for quantized clip switching and stable timing visuals.

## Safety / panic usage
- `Cmd/Ctrl + R/S/D/F`: erase slot A/B/C/D immediately in current bank.
- Use **Double Press: All** when performing live and needing global stop quickly.

