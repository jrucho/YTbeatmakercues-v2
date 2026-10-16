const byId = id => document.getElementById(id);
byId('extension-id').textContent = chrome.runtime.id;
byId('extension-origin').textContent = chrome.runtime.getURL('');
function bytes(value) { return `${Number(value || 0).toLocaleString()} bytes (${(Number(value || 0) / 1048576).toFixed(2)} MiB)`; }
function row(table, values, header = false) {
  const tr = document.createElement('tr');
  for (const value of values) { const cell = document.createElement(header ? 'th' : 'td'); cell.textContent = value; tr.appendChild(cell); }
  table.appendChild(tr);
}
async function refresh() {
  byId('refresh').disabled = true;
  byId('status').textContent = 'Checking the actual model file and live allocations…';
  try {
    const report = await chrome.runtime.sendMessage({ type: 'ytbm-stems-storage-inspect' });
    if (!report?.ok) throw new Error(report?.error || 'No storage report returned');
    byId('model-path').textContent = report.model.path;
    byId('model-status').className = report.model.present ? 'good' : 'bad';
    byId('model-status').textContent = report.model.present
      ? `Installed and SHA-256 verified — ${bytes(report.model.bytes)}`
      : `No valid installed model — ${report.model.reason || 'missing'}. Observed size: ${bytes(report.model.bytes)}.`;
    byId('report').textContent = JSON.stringify(report, null, 2);
    byId('storage-count').textContent = report.storage
      ? `Owned OPFS files: ${bytes(report.storage.opfsBytes)}. Owned IndexedDB databases: ${report.storage.indexedDB.length}. Owned Cache Storage caches: ${report.storage.cacheStorage.length}. Browser-reported origin usage (also includes metadata/unrelated data): ${bytes(report.storage.browserOriginUsageBytes)}.` : '';
    const allocations = byId('sessions'); allocations.replaceChildren();
    const table = document.createElement('table');
    row(table, ['Tab / owner', 'State', 'Separated stems (RAM)', 'Full-song audio (RAM)'], true);
    const owners = new Set();
    for (const session of report.sessions) {
      const tracks = [...report.preloadedTracks, ...(report.bufferedAudio || [])].filter(t => t.owner.startsWith(session.tabId + ':'));
      for (const track of tracks) owners.add(track.owner);
      row(table, [session.tabId + ' / ' + (session.videoId || 'no video'),
        session.analysisRequested ? `${session.analysisMode}: ${session.learnedSegments} segments processed` : 'Waiting for a video to start automatic analysis',
        `${session.cachedStemSegments} cached segments · ${bytes(session.cachedStemBytes)}`,
        bytes(tracks.reduce((sum, t) => sum + t.encodedBytes + t.decodedPCMBytes, 0))]);
    }
    for (const track of report.preloadedTracks.filter(t => !owners.has(t.owner))) {
      row(table, [track.owner, track.status, 'No responding video-frame report', bytes(track.encodedBytes + track.decodedPCMBytes)]);
    }
    if (!report.sessions.length && !report.preloadedTracks.length) {
      const message = document.createElement('p'); message.textContent = 'No active song/stem allocations reported. Open a video tab and refresh this check.'; allocations.appendChild(message);
    } else allocations.appendChild(table);
    const note = document.createElement('p'); note.className = 'muted';
    note.textContent = 'Byte counts cover audio sample buffers, not total process memory, ONNX weights, WASM/GPU memory, scheduled playback copies or JavaScript overhead.'; allocations.appendChild(note);
    byId('status').textContent = `Checked at ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    byId('status').textContent = `Check failed: ${error.message}`;
  } finally { byId('refresh').disabled = false; }
}
byId('refresh').addEventListener('click', refresh);
byId('remove').addEventListener('click', async () => {
  byId('remove').disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'ytbm-stems-storage-remove' });
    if (!result?.ok || !result.verified) throw new Error(result?.error || 'Removal could not be verified');
    byId('removal-report').hidden = false;
    byId('removal-report').textContent = JSON.stringify({ verified: true, before: result.before, after: result.after }, null, 2);
    await refresh();
  } catch (error) { byId('status').textContent = `Removal failed: ${error.message}`; }
  finally { byId('remove').disabled = false; }
});
refresh();
