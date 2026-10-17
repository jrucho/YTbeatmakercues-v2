/* Early isolated-world endpoint, shared with content.js in the same frame. */
(() => {
  let channel, listener = null, connected = false, videoId = null, cleared = false;
  const active = () => channel.port1.postMessage({ type: 'active', enabled: !!listener, videoId, clear: cleared });
  function connect() {
    if (connected) return;
    channel?.port1.close();
    channel = new MessageChannel();
    channel.port1.onmessage = ({ data }) => {
      if (data?.type === 'connected') { connected = true; clearInterval(retry); active(); return; }
      if (listener && data?.buffer instanceof ArrayBuffer && data.buffer.byteLength <= 8 * 1024 * 1024) listener(data);
    };
    window.postMessage({ type: 'ytbm-buffered-audio-connect' }, location.origin, [channel.port2]);
  }
  // Retry the handshake if MAIN-world startup trails the isolated script.
  const retry = setInterval(connect, 500);
  connect();
  globalThis.YTBMBufferedAudio = {
    clear() { listener = null; cleared = true; active(); },
    subscribe(callback, options = {}) {
      listener = callback; videoId = options.videoId || null; cleared = false;
      active();
      return () => { if (listener === callback) { listener = null; active(); } };
    },
  };
  window.addEventListener('pagehide', () => { clearInterval(retry); channel.port1.close(); });
})();
