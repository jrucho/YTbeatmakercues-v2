/* Early isolated-world endpoint, shared with content.js in the same frame. */
(() => {
  const channel = new MessageChannel();
  let listener = null;
  channel.port1.onmessage = ({ data }) => {
    if (listener && data?.buffer instanceof ArrayBuffer && data.buffer.byteLength <= 8 * 1024 * 1024) listener(data);
  };
  globalThis.YTBMBufferedAudio = {
    clear() { listener = null; channel.port1.postMessage({ type: 'active', enabled: false, clear: true }); },
    subscribe(callback) {
      listener = callback;
      channel.port1.postMessage({ type: 'active', enabled: true });
      return () => { if (listener === callback) { listener = null; channel.port1.postMessage({ type: 'active', enabled: false, clear: true }); } };
    },
  };
  // Both document_start scripts run before the queued message is dispatched.
  window.postMessage({ type: 'ytbm-buffered-audio-connect' }, location.origin, [channel.port2]);
})();
