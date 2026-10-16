/* Extension-origin resource ownership. No generated audio is persisted. */
const modelStore = new YTBMModelStore.ModelStore();
const trackStore = new YTBMTrackStore.TrackStore();
const bufferedStore = new YTBMBufferedAudioStore.BufferedAudioStore();
const inferenceHost = new YTBMInferenceHost.InferenceHost();
const sessionDownloads = new YTBMSessionDownloads.SessionDownloads();
trackStore.downloads = bufferedStore.downloads = sessionDownloads;
const downloadTabs = new Set();
const frameEpochs = new Map();
let generation = 0, removal = null;
let lastDownloadError = null, downloadProgress = null;
const boot = Promise.all([modelStore.discardPartial(), sessionDownloads.clearAll()]);
const broadcast = message => chrome.runtime.sendMessage({ target: 'ytbm-stems-background', ...message }).catch(() => {});
function encodeFloats(data) {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength), parts = [];
  for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(parts.join(''));
}
function decodeBytes(encoded) {
  const binary = atob(encoded), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function closeFrame(frame) {
  frameEpochs.set(frame, (frameEpochs.get(frame) || 0) + 1);
  for (const owner of [...inferenceHost.clients]) if (owner.startsWith(frame + ':')) inferenceHost.close(owner);
  trackStore.clear(frame); bufferedStore.clear(frame);
  await sessionDownloads.clearFrame(frame);
}
async function removeResources() {
  if (removal) return removal;
  generation++;
  inferenceHost.clear(); trackStore.clearAll(); bufferedStore.clearAll();
  removal = (async () => {
    await boot;
    await sessionDownloads.clearAll();
    const before = await YTBMResourceStorage.inspect();
    await modelStore.remove();
    await YTBMResourceStorage.removeLegacyStores();
    const after = await YTBMResourceStorage.inspect();
    if (after.opfsBytes || after.indexedDB.length || after.cacheStorage.length) throw new Error('Owned storage remains after removal');
    lastDownloadError = null; downloadProgress = null;
    await broadcast({ kind: 'ytbm-stems-model-removed' });
    return { ok: true, removed: true, verified: true, before, after };
  })();
  try { return await removal; } finally { removal = null; }
}
async function handle(msg) {
  const frame = `${msg.tabId}:${msg.frameId || 0}:${msg.documentId || 'legacy'}`;
  const frameEpoch = frameEpochs.get(frame) || 0;
  await boot;
  const owner = `${frame}:${msg.client || ''}`;
  if (msg.type === 'ytbm-stems-model-remove') return removeResources();
  if (msg.type === 'ytbm-stems-engine-close') { inferenceHost.close(owner); return { ok: true }; }
  if (msg.type === 'ytbm-stems-frame-close') { await closeFrame(frame); return { ok: true }; }
  if (msg.type === 'ytbm-stems-tab-close') {
    for (const key of [...trackStore.entries.keys(), ...bufferedStore.entries.keys()]) if (key.startsWith(msg.tabId + ':')) await closeFrame(key);
    for (const key of [...sessionDownloads.entries.keys()]) if (key.startsWith(msg.tabId + ':')) await sessionDownloads.clear(key);
    for (const key of [...inferenceHost.clients]) if (key.startsWith(msg.tabId + ':')) inferenceHost.close(key);
    downloadTabs.delete(msg.tabId);
    if (!downloadTabs.size) await modelStore.cancel();
    return { ok: true };
  }
  if (msg.type === 'ytbm-stems-track-clear') { trackStore.clear(frame, msg.track); await sessionDownloads.clear(`${frame}/track/${msg.track}`); return { ok: true }; }
  if (msg.type === 'ytbm-stems-buffered-clear') { bufferedStore.clear(frame, msg.track); await sessionDownloads.clear(`${frame}/buffer/${msg.track}`); return { ok: true }; }
  if (removal) throw new Error('Model removal in progress');
  if (msg.type === 'ytbm-stems-storage-inspect') {
    const status = await modelStore.status(), spec = YTBMModelStore.SPEC;
    return { ok: true,
      model: { ...status, path: `${spec.directory}/${spec.filename}`, expectedBytes: spec.bytes, expectedSha256: spec.sha256, verified: !!status.present },
      storage: await YTBMResourceStorage.inspect(), downloading: !!modelStore.job, downloadProgress, lastDownloadError,
      temporaryDownloads: [...sessionDownloads.entries].map(([owner, entry]) => ({ owner, path: entry.path, bytes: entry.bytes, complete: !!entry.complete })),
      preloadedTracks: [...trackStore.entries].map(([owner, entry]) => ({ owner, track: entry.id, status: entry.status,
        encodedBytes: entry.bytes?.byteLength || 0, decodedPCMBytes: entry.audio ? entry.audio.length * entry.audio.numberOfChannels * 4 : 0,
        duration: entry.audio?.duration || entry.expectedDuration || 0 })),
      bufferedAudio: [...bufferedStore.entries].map(([owner, entry]) => ({ owner, ...bufferedStore.info(entry),
        decodedPCMBytes: entry.audio ? entry.audio.length * entry.audio.numberOfChannels * 4 : 0 })),
      inferenceWorkers: inferenceHost.worker ? [{ owners: [...inferenceHost.clients], pendingRequests: inferenceHost.queue.length + !!inferenceHost.active }] : [],
    };
  }
  if (msg.type === 'ytbm-stems-model-status') return { ...await modelStore.status(), downloading: !!modelStore.job, progress: downloadProgress };
  if (msg.type === 'ytbm-stems-download-cancel') { await modelStore.cancel(); return { ok: true }; }
  if (msg.type === 'ytbm-stems-download-start') {
    downloadTabs.add(msg.tabId);
    if (!modelStore.job) {
      lastDownloadError = null; downloadProgress = null;
      modelStore.download(p => { downloadProgress = p; broadcast({ kind: 'ytbm-stems-download-progress', ...p }); })
        .then(status => broadcast({ kind: 'ytbm-stems-download-done', ...status }), error => {
          lastDownloadError = error.message;
          return broadcast({ kind: 'ytbm-stems-download-done', ok: false, cancelled: error.name === 'AbortError', error: error.message });
        }).finally(() => downloadTabs.clear());
    }
    return { ok: true, started: true };
  }
  const epoch = generation;
  if (!(await modelStore.status()).present || generation !== epoch || removal || frameEpoch !== (frameEpochs.get(frame) || 0)) throw new Error('Stems model is not installed or frame is closed');
  if (msg.type === 'ytbm-stems-track-preload') {
    const info = msg.sourceInfo || {};
    return { ok: true, ...trackStore.preload(frame, msg.track, info.sources || [], p => broadcast({
      kind: 'ytbm-stems-track-status', tabId: msg.tabId, track: msg.track, ...p,
    }), info.duration, { videoId: info.videoId || msg.videoId, title: info.title }) };
  }
  if (msg.type === 'ytbm-stems-track-open') return { ok: true, ...await trackStore.open(frame, msg.track) };
  if (msg.type === 'ytbm-stems-buffered-append') {
    const packet = msg.packet;
    if (!packet || typeof packet.dataB64 !== 'string' || packet.dataB64.length > 12 * 1024 * 1024) throw new Error('Invalid audio packet');
    bufferedStore.append(frame, msg.track, { ...packet, bytes: decodeBytes(packet.dataB64) }, info => broadcast({
      kind: 'ytbm-stems-buffered-ready', tabId: msg.tabId, track: msg.track, ...info,
    }));
    return { ok: true };
  }
  if (msg.type === 'ytbm-stems-engine-request') {
    const message = { ...msg.message };
    if (message.type === 'separate-track') message.mix = trackStore.segment(frame, message.track, message.index).mix;
    else if (message.type === 'separate-buffered') message.mix = bufferedStore.segment(frame, message.track, message.stream, message.index).mix;
    else if (message.type === 'separate') message.mix = new Float32Array(decodeBytes(message.mixB64).buffer);
    if (message.type.startsWith('separate')) message.type = 'separate';
    delete message.mixB64;
    const result = await inferenceHost.request(owner, message);
    if (result.data) { result.dataB64 = encodeFloats(result.data); delete result.data; }
    return { ok: true, message: result };
  }
  throw new Error('Unknown stem request');
}
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.target !== 'ytbm-stems-host' || sender.id !== chrome.runtime.id) return false;
  handle(msg).then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});
