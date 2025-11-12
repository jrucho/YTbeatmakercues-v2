# YouTube Beatmaker Cues - Chrome Extension

You can try out my new website with some of the extension’s features here, before downloading it: https://bit.ly/beatmakercues

> This extension was inspired by the muscle memory workflow of the OP-Z, the versatility of Ableton Live, and the hands-on approach I developed over the years using the SP-404.

![Screenshot 2025-10-24 at 10 05 00](https://github.com/user-attachments/assets/267905da-ff7b-4a51-9591-ad1000a5b8a3)

Mark cue points, loop audio/video, apply live effects, and customize your beatmaking experience on YouTube.

The **YouTube Beatmaker Cues** extension supports precise pitch adjustments, audio and video looping, effects toggling, and intuitive cue management. Use keyboard shortcuts or the detailed Advanced Panel for quick control.

## New in 2.0.1
* Replace inline AudioWorklet definitions with modules loaded via chrome.runtime.getURL
* Add dedicated worklet scripts for cassette, loop recorder, vinyl break, stutter, phaser, and bit reduction processors
* Expose the new worklet files through web_accessible_resources in the manifest to satisfy MV3 CSP

## New in 2.0
* New UI
* Modifier-mute for pads & keys. Hold Shift AND Cmd at the same time (Ctrl on Windows/Linux) and press a sample pad or mapped keyboard key to mute/unmute them

## Key Features

- 🎯 **Cue Points**  
  Set up to 10 visual cue points on any YouTube video. Use keyboard shortcuts or drag & drop markers.

- 🔁 **Audio & Video Loopers**
  Record loops in sync with video or audio. Use `R`, `S`, `D`, or `F` to control
  up to four separate audio loops. The first loop defines the bar length and tempo.
  Additional loops of any bar count launch on the next bar so everything stays aligned.
  Loops keep the exact length you recorded with no trimming. Press the loop key again
  to finish recording on the next bar. Double press a loop key to mute that loop at
  the bar boundary and single press to unmute instantly—just like legato mode. Double
  press twice more to erase it. Loops rejoin mid‑phrase so sync stays tight even when
  loops have different lengths. Exporting downloads each active loop with the rounded
  BPM in the file name. Use `V` for the video looper and double press to erase it.
  Hold Option + **Cmd+R** to erase all loops. Each looper button shows a slim progress
  bar that pulses while recording. Hold the mapped **MIDI Shift** note while pressing
  any loop key to erase that loop instantly. Progress bars speed up or slow down when
  loops are pitched so the visuals stay in sync.

- 🎚️ **Pitch Control**  
  Independent pitch control for video and loop playback. When targeting loops,
  the pitch slider adjusts all four audio loopers together and exported files
  include the modified pitch. If loops are pitched when exporting, each file
  name ends with `-pitched-<BPM>bpm` where `<BPM>` reflects the new tempo.
  Export uses offline rendering for reliability.

- 🎛️ **Live Effects**  
  Toggle EQ (`E`), Compressor (`C`), Reverb (`Q`), and Cassette (`W`) in real time.

- 👁️ **Minimal & Advanced UI**  
  Choose between a clean minimal bar or a full panel with all controls.

- 🥁 **Sample Kits**  
  Manage built-in and imported samples (kick, hihat, snare), randomize or load packs on demand.

- 🎹 **MIDI Support**
  Use your MIDI controller to trigger actions. Custom mappings are available via UI, including key and MIDI assignments for all four loopers.

- ⏯️ **Shift Play/Pause**
  Quick-tap the Shift key (or mapped MIDI Shift note) to play when paused.
  Double-tap Shift while playing to pause the video, and holding Shift still acts as a modifier for other controls.

- 🔄 **Super Knob**
  Select any cue via pad, keyboard, or MIDI note and twist the mapped knob to
  slide its position left or right. Endless encoders currently act like normal
  0–127 knobs for maximum stability. Hold Shift (or a MIDI shift note) to
  reposition, and choose a speed from 1 (default) to 3 in the MIDI mapping
  window. Any CC number can be assigned.

- 👇 **Touch Sequencer**  
  10 pads, 16-step sequencer, tap tempo, and BPM-based triggering.

## Installation

1. Download the latest version of the Extension.
2. Go to `chrome://extensions/` and enable **Developer Mode**.
3. Click **Load unpacked** and select the unzipped folder.
4. Refresh any YouTube tab and click on the extension UI to activate audio.

To create the downloadable archive yourself, run `bash build_release.sh`. The script outputs `ytbeatmakercues-<version>.zip`.

## Keyboard Shortcuts

| Action | Key |
|-------|-----|
| Set/Jump to Cue | Ctrl/Cmd + [1–0] |
| Audio Loopers | R / S / D / F |
| Video Looper | V |
| EQ Toggle | E |
| Compressor Toggle | C |
| Reverb Toggle | Q |
| Cassette Toggle | W |
| Undo / Redo | U / Cmd+U |
| Erase Loop A | Cmd+R |
| Erase Loop B | Cmd+S |
| Erase Loop C | Cmd+D |
| Erase Loop D | Cmd+F |
| Erase All Loops | Cmd+Option+R |
| Erase Video Loop | Cmd+V |
| Export | Ctrl/Cmd + Enter |
| Pitch Down / Up | `,` / `.` |
| Random Cue | `-` |
| Nova Bass | N |
| Blind Mode | B |
| Show Advanced Panel | A |

Press **N** or the advanced panel’s **Instrument** button to show the Nova Bass window. Opening the window activates your last preset if the synth was off; closing it powers the synth down. The minimal bar has its own Instrument button that simply toggles the synth on or off without opening the window. Twelve built-in presets—Resonate, Precision, 808 Boom, Warm Organ, Moog Thump, Soft Pad, String Ensemble, FM Keys, Pluck, Sweep Lead, Bass Cut and Sample Tone—cover a wide range of classic tones and play at **15% volume** by default. You can layer multiple presets together just like sample packs. Compression and limiter sliders make it easy to tame levels.
The popup hides detailed controls until you click **Advanced**, keeping the interface clean.
While the synth is active, the `1–0` keys plus `-` and `=` play a chromatic scale from the chosen octave. The **Scale** dropdown lets you switch to major or minor if desired.
The synth has a pitch fader synced to the video by default. Uncheck **Sync Video** to adjust it independently and use the transpose slider for coarse tuning. A dedicated **Tune** slider lets you shift each preset in 12‑step increments from −24 to +24 semitones, and the value is stored per preset. All parameters are adjusted with labeled sliders so you know exactly what each one does.

Moving any knob instantly updates the current preset. Built‑in presets cannot be deleted but you can save your tweaks as new ones. Each preset stores oscillator type, engine (analog, FM, wavetable or sampler), filter, ADSR, effects and **Mode** (poly, mono or legato). Example wavetables and a sample tone demonstrate these engines.
In mono mode, triggering a new note now cuts the previous one immediately so bass lines stay tight.

Each preset stores oscillator type, engine, filter settings, ADSR envelope and effect parameters (delay, reverb, compression, limiter, volume and LFO). Use **Save** to keep changes, **Delete** to remove custom presets or **Export** to share them. The **Random** button quickly generates a usable sound.

All loop keys and MIDI notes can be reassigned in the Key Mapping and MIDI Mapping windows.
Holding the MIDI Shift note while pressing a loop note erases that loop.

## Touch Sequencer

- Press `T` to open
- Press `S` to start/stop
- Set cue points on pads or trigger them
- Use the 16-step grid to play cues rhythmically
- Tap tempo, erase steps, or close the window anytime

## Compressors

- **Native:** Hard, clear compression.
- **Ultra Tape:** Vintage saturation, SP303-inspired.
- **Bright Open:** Bright and clean compression with analog warmth.

> 🔊 *Tip: Reduce YouTube volume to ~40–50% for best effect with compression modes.*

## Support

💬 DM on Instagram: [@owae.ga](https://instagram.com/owae.ga)  
🎥 Video tutorial: [YouTube](https://youtu.be/1--CEtz9H_0)

📄 Manual [GoogleDoc](https://docs.google.com/document/d/1-36AdsgzwXt7Mt-YsxxTY9NqxipxE-XvGeUNbLmTUCA/mobilebasic?fbclid=PAQ0xDSwK0OPNleHRuA2FlbQIxMAABp8W6y8O5IC8MR0UyQuGRNqEzNzCuUWRdAmEsF2-PToglY4jHIou6FDSq2F2j_aem_v9J-pyC1j4Uvl0vfl8PemA)
---

© 2025 owae.ga — Build beats where you watch them.
