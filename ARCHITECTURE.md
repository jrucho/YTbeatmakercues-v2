# YT Beatmaker Cues Architecture

## Lifecycle flow

- **AppController** owns a single active session.
- `createYouTubeNavigationObserver` watches YouTube SPA navigation (watch + Shorts) and emits `videoId` changes.
- On change, the controller runs `teardown()` for the current session, then `bootstrap(videoId)` for the next session.
- Each session gets an `AbortController` plus registries for observers, timeouts, intervals, and RAF IDs so teardown is deterministic.

## Store design

- A minimal store (`createStore`) exposes `getState()`, `dispatch(action)`, and `subscribe(selector, cb)` with shallow slice comparison.
- `ActionTypes` define typed-ish constants.
- Selectors support high-frequency UI updates without re-rendering heavy state.

## Engine/UI separation

- `/src/engine` contains pure logic primitives (transport clock, looper bank, fx rack, MIDI router).
- `/src/ui` owns DOM rendering, event wiring, and user gesture handling.
- The engine never touches the DOM; the UI never owns timing logic (it consumes engine outputs).

## Teardown guarantees

- All long-lived listeners use `AbortController` signals via tracked listeners.
- Observers, timeouts, intervals, and RAF loops are registered on the session and cleared on teardown.
- UI roots are idempotent via `#ytbm-root` and removed during teardown to avoid double-injection.

## Worklet loading rules

- AudioWorklet modules are loaded through a centralized loader.
- Modules use `chrome.runtime.getURL()` and are declared in `web_accessible_resources`.
- Loader caches per AudioContext and reports failures via the store.
