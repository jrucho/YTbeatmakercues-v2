import { ActionTypes } from "../store/actions.js";
import { createYouTubeNavigationObserver, extractVideoId } from "./navigation-observer.js";

const createSession = (videoId) => ({
  videoId,
  abort: new AbortController(),
  observers: new Set(),
  disposers: new Set(),
  intervals: new Set(),
  timeouts: new Set(),
  rafs: new Set()
});

export function createAppController({ store, bootstrap, teardown }) {
  let currentSession = null;

  const registerObserver = (observer) => {
    if (!currentSession) return;
    currentSession.observers.add(observer);
  };

  const registerDisposer = (disposer) => {
    if (!currentSession) return;
    currentSession.disposers.add(disposer);
  };

  const registerInterval = (id) => {
    if (!currentSession) return;
    currentSession.intervals.add(id);
  };

  const registerTimeout = (id) => {
    if (!currentSession) return;
    currentSession.timeouts.add(id);
  };

  const registerRaf = (id) => {
    if (!currentSession) return;
    currentSession.rafs.add(id);
  };

  const cleanupSession = async () => {
    if (!currentSession) return;
    currentSession.abort.abort();
    currentSession.observers.forEach((observer) => observer.disconnect());
    currentSession.disposers.forEach((dispose) => dispose());
    currentSession.intervals.forEach((id) => window.clearInterval(id));
    currentSession.timeouts.forEach((id) => window.clearTimeout(id));
    currentSession.rafs.forEach((id) => window.cancelAnimationFrame(id));
    currentSession = null;
  };

  const runTeardown = async () => {
    if (!currentSession) return;
    store.dispatch({ type: ActionTypes.SESSION_TEARDOWN });
    await teardown(currentSession);
    await cleanupSession();
  };

  const runBootstrap = async (videoId) => {
    if (currentSession?.videoId === videoId) return;
    await runTeardown();
    currentSession = createSession(videoId);
    store.dispatch({ type: ActionTypes.SESSION_BOOTSTRAP, payload: { videoId } });
    await bootstrap({
      ...currentSession,
      registerObserver,
      registerDisposer,
      registerInterval,
      registerTimeout,
      registerRaf
    });
  };

  const navObserver = createYouTubeNavigationObserver({
    onVideoChange: (videoId) => runBootstrap(videoId)
  });

  const start = () => {
    const videoId = extractVideoId(window.location.href);
    if (videoId) {
      void runBootstrap(videoId);
    }
    navObserver.start();
  };

  const stop = async () => {
    navObserver.stop();
    await runTeardown();
  };

  return { start, stop, getSession: () => currentSession };
}
