const loaderCache = new WeakMap();

export function createWorkletLoader() {
  const load = async (ctx, modulePath) => {
    if (!ctx?.audioWorklet) {
      throw new Error("AudioWorklet is not supported.");
    }
    let loaded = loaderCache.get(ctx);
    if (!loaded) {
      loaded = new Set();
      loaderCache.set(ctx, loaded);
    }
    if (loaded.has(modulePath)) return;
    const url = chrome.runtime.getURL(modulePath);
    await ctx.audioWorklet.addModule(url);
    loaded.add(modulePath);
  };

  return { load };
}
