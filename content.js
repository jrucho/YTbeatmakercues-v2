import { createStore } from "./src/store/store.js";
import { reducer } from "./src/store/reducer.js";
import { initialState } from "./src/store/initial-state.js";
import { createAppController } from "./src/core/app-controller.js";
import { bootstrapLegacyApp, teardownLegacyApp } from "./src/ui/legacy-app.js";

const store = createStore(reducer, initialState);

const appController = createAppController({
  store,
  bootstrap: (session) => bootstrapLegacyApp(session, store),
  teardown: () => teardownLegacyApp()
});

appController.start();

const globalAbort = new AbortController();
window.addEventListener("beforeunload", () => {
  void appController.stop();
  globalAbort.abort();
}, { signal: globalAbort.signal });
