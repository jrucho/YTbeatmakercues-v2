const SHORTS_RE = /\/shorts\/([a-zA-Z0-9_-]+)/;
const EMBED_RE = /\/embed\/([a-zA-Z0-9_-]+)/;

export function extractVideoId(href) {
  try {
    const url = new URL(href);
    if (url.hostname === "youtu.be") {
      return url.pathname.replace("/", "").trim() || null;
    }
    const vParam = url.searchParams.get("v");
    if (vParam) return vParam;
    const shortsMatch = url.pathname.match(SHORTS_RE);
    if (shortsMatch) return shortsMatch[1];
    const embedMatch = url.pathname.match(EMBED_RE);
    if (embedMatch) return embedMatch[1];
  } catch {
    return null;
  }
  return null;
}

export function createYouTubeNavigationObserver({ onVideoChange, throttleMs = 250 }) {
  let lastHref = "";
  let lastVideoId = null;
  let rafId = null;
  let observer = null;
  let intervalId = null;
  let throttled = false;
  let abortController = null;

  const check = () => {
    const href = window.location.href;
    if (href === lastHref && !throttled) return;
    lastHref = href;
    const nextVideoId = extractVideoId(href);
    if (nextVideoId && nextVideoId !== lastVideoId) {
      lastVideoId = nextVideoId;
      onVideoChange(nextVideoId);
    }
  };

  const scheduleCheck = () => {
    if (throttled) return;
    throttled = true;
    rafId = window.requestAnimationFrame(() => {
      throttled = false;
      check();
    });
  };

  const start = () => {
    lastHref = "";
    lastVideoId = extractVideoId(window.location.href);
    if (lastVideoId) {
      onVideoChange(lastVideoId);
    }

    abortController = new AbortController();

    const target = document.querySelector("ytd-app") || document.body;
    observer = new MutationObserver(() => scheduleCheck());
    observer.observe(target, { childList: true, subtree: true });

    intervalId = window.setInterval(() => check(), Math.max(1000, throttleMs));
    window.addEventListener("popstate", scheduleCheck, { signal: abortController.signal });
    window.addEventListener("yt-navigate-finish", scheduleCheck, { signal: abortController.signal });
  };

  const stop = () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (intervalId) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  };

  return { start, stop };
}
