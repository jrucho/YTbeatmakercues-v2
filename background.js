const ytbmByChromeTabId = new Map();
const chromeTabByYtbmId = new Map();
const vjProtectedTabs = new Map();
if (typeof importScripts === 'function') importScripts('addons/stems/track-source.js');
let stateWrites = Promise.resolve();
const stateReady = (async () => {
  try {
    const state = (await chrome.storage.session.get('ytbm_liveSession')).ytbm_liveSession;
    for (const [id, ytbm] of state?.tabs || []) setMapping(ytbm, { id });
    for (const [id, original] of state?.protectedTabs || []) vjProtectedTabs.set(id, original);
    updateVJPower();
  } catch {}
})();

function persistSession() {
  const state = { tabs: [...ytbmByChromeTabId], protectedTabs: [...vjProtectedTabs] };
  stateWrites = stateWrites.catch(() => {}).then(() => chrome.storage.session.set({ ytbm_liveSession: state }));
  return stateWrites;
}

function updateVJPower() {
  if (!chrome.power) return;
  if (vjProtectedTabs.size) chrome.power.requestKeepAwake('display');
  else chrome.power.releaseKeepAwake();
}

async function setVJProtection(tabId, active) {
  if (active) {
    if (!vjProtectedTabs.has(tabId)) {
      const tab = await chrome.tabs.get(tabId);
      vjProtectedTabs.set(tabId, tab.autoDiscardable !== false);
      await chrome.tabs.update(tabId, { autoDiscardable: false });
    }
  } else if (vjProtectedTabs.has(tabId)) {
    const original = vjProtectedTabs.get(tabId);
    vjProtectedTabs.delete(tabId);
    try { await chrome.tabs.update(tabId, { autoDiscardable: original }); } catch {}
  }
  updateVJPower();
  await persistSession();
}


function isVideoTabUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    const h = (u.hostname || '').toLowerCase();
    return ['youtube.com', 'youtube-nocookie.com', 'samplette.io'].some((domain) => h === domain || h.endsWith('.' + domain));
  } catch {
    return false;
  }
}

function setMapping(ytbmTabId, tab) {
  if (!ytbmTabId || !tab || typeof tab.id !== 'number') return;
  const prevChromeTabId = chromeTabByYtbmId.get(ytbmTabId);
  const oldYtbm = ytbmByChromeTabId.get(tab.id);
  if (oldYtbm && oldYtbm !== ytbmTabId) chromeTabByYtbmId.delete(oldYtbm);
  if (typeof prevChromeTabId === 'number' && prevChromeTabId !== tab.id) {
    ytbmByChromeTabId.delete(prevChromeTabId);
  }
  ytbmByChromeTabId.set(tab.id, ytbmTabId);
  chromeTabByYtbmId.set(ytbmTabId, tab.id);
}

function removeTab(tabId) {
  const ytbm = ytbmByChromeTabId.get(tabId);
  if (ytbm) chromeTabByYtbmId.delete(ytbm);
  ytbmByChromeTabId.delete(tabId);
  vjProtectedTabs.delete(tabId);
  updateVJPower();
  persistSession().catch(() => {});
}

async function buildOrderForWindow(windowId) {
  await stateReady;
  if (typeof windowId !== 'number') return [];
  const tabs = await chrome.tabs.query({ windowId });
  return tabs
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .filter((tab) => typeof tab.id === 'number' && isVideoTabUrl(tab.url))
    .map((tab) => ytbmByChromeTabId.get(tab.id))
    .filter(Boolean);
}

async function broadcastOrder(windowId) {
  if (typeof windowId !== 'number') return;
  const order = await buildOrderForWindow(windowId);
  const tabs = await chrome.tabs.query({ windowId });
  await Promise.all(tabs.map(async (tab) => {
    if (typeof tab.id !== 'number') return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'ytbm-tab-order-update', order });
    } catch {}
  }));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'ytbm-stems-host') return false;
  if (msg?.target === 'ytbm-stems-background') {
    if (sender.id !== chrome.runtime.id) return false;
    if (msg.kind === 'ytbm-stems-model-removed') chrome.storage.local.remove('ytbmStemsPackInstalled');
    if (msg.kind === 'ytbm-stems-download-done' && msg.ok) chrome.storage.local.set({ ytbmStemsPackInstalled: true });
    chrome.tabs.query({}).then(tabs => Promise.all(tabs.filter(t => isVideoTabUrl(t.url) && (msg.tabId == null || msg.tabId === t.id)).map(tab =>
      chrome.tabs.sendMessage(tab.id, { ...msg, target: 'ytbm-stems' }).catch(() => {})
    ))).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type?.startsWith('ytbm-stems-')) {
    if (msg.type === 'ytbm-stems-storage-remove') {
      if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('addons/stems/storage.html')) return false;
      ensureStemHost().then(() => chrome.runtime.sendMessage({ target: 'ytbm-stems-host', type: 'ytbm-stems-model-remove' }))
        .then(sendResponse, error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (msg.type === 'ytbm-stems-storage-inspect') {
      if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
      inspectStemStorage().then(sendResponse, error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (sender.id !== chrome.runtime.id || !sender.tab || !isVideoTabUrl(sender.tab.url)) return false;
    forwardStemRequest(msg, sender).then(sendResponse, err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (!msg || !['ytbm-register-tab', 'ytbm-get-tab-order', 'ytbm-vj-performance', 'ytbm-fetch-asset', 'ytbm-stems-model-status', 'ytbm-stems-download-start', 'ytbm-stems-download-cancel', 'ytbm-stems-model-remove'].includes(msg.type)) return false;
  (async () => {
    await stateReady;
    if (msg.type === 'ytbm-vj-performance') {
      if (!sender.tab || sender.frameId > 0 || !isVideoTabUrl(sender.tab.url)) { sendResponse({ ok: false }); return; }
      await setVJProtection(sender.tab.id, !!msg.active);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'ytbm-register-tab') {
      const tab = sender.tab;
      const ytbmTabId = msg.ytbmTabId;
      if (sender.frameId > 0 && /(^|\.)youtube\.com$/.test(new URL(tab?.url || 'https://invalid').hostname)) {
        sendResponse({ ok: false, order: [] });
        return;
      }
      if (tab && typeof tab.id === 'number' && typeof ytbmTabId === 'string' && isVideoTabUrl(tab.url)) {
        setMapping(ytbmTabId, tab);
        await persistSession();
        const order = await buildOrderForWindow(tab.windowId);
        sendResponse({ ok: true, order });
        await broadcastOrder(tab.windowId);
      } else {
        sendResponse({ ok: false, order: [] });
      }
      return;
    }
    if (msg.type === 'ytbm-fetch-asset') {
      // Same-origin fetch of our own packaged files (e.g. sounds/*.wav).
      // Content scripts can be blocked from fetching chrome-extension://
      // URLs directly on some pages; the worker origin always matches.
      // NOTE: raw ArrayBuffers do NOT survive sendMessage responses (they
      // arrive as plain {}), so the bytes are base64-encoded here.
      try {
        const rel = String(msg.path || '').replace(/^\/+/, '');
        if (!rel || rel.includes('..')) throw new Error('bad asset path');
        const res = await fetch(chrome.runtime.getURL(rel));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const buf = await res.arrayBuffer();
        if (!buf || !buf.byteLength) throw new Error('empty asset');
        const bytes = new Uint8Array(buf);
        let bin = '';
        const CHUNK = 8192;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        sendResponse({ ok: true, dataB64: btoa(bin), byteLength: buf.byteLength });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
      return;
    }
    if (msg.type === 'ytbm-get-tab-order') {
      const tab = sender.tab;
      if (!tab || typeof tab.windowId !== 'number') {
        sendResponse({ ok: false, order: [] });
        return;
      }
      const order = await buildOrderForWindow(tab.windowId);
      sendResponse({ ok: true, order });
      return;
    }
  })().catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
});

// The offscreen document owns long downloads and same-origin inference workers.
let stemHostCreating = null;
async function ensureStemHost() {
  if (stemHostCreating) return stemHostCreating;
  stemHostCreating = (async () => {
    if (!await chrome.offscreen.hasDocument()) await chrome.offscreen.createDocument({
      url: 'addons/stems/offscreen.html', reasons: ['WORKERS'],
      justification: 'Run the optional downloaded stem model in an extension-owned worker.',
    });
  })();
  try { await stemHostCreating; } finally { stemHostCreating = null; }
}
async function forwardStemRequest(msg, sender) {
  const allowed = ['ytbm-stems-model-status', 'ytbm-stems-download-start', 'ytbm-stems-download-cancel',
    'ytbm-stems-model-remove', 'ytbm-stems-engine-request', 'ytbm-stems-engine-close',
    'ytbm-stems-track-preload', 'ytbm-stems-track-open', 'ytbm-stems-track-clear',
    'ytbm-stems-buffered-append', 'ytbm-stems-buffered-clear'];
  if (!allowed.includes(msg.type)) throw new Error('Unknown stem request');
  await ensureStemHost();
  if (msg.type === 'ytbm-stems-track-preload') {
    const results = await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] }, world: 'MAIN',
      func: YTBMTrackSource.discover, args: [msg.videoId || null, Number(msg.since) || 0],
    });
    msg = { ...msg, sourceInfo: results[0]?.result || { sources: [] } };
  }
  return chrome.runtime.sendMessage({ ...msg, target: 'ytbm-stems-host', tabId: sender.tab.id, frameId: sender.frameId || 0, documentId: sender.documentId });
}

chrome.runtime.onConnect?.addListener(port => {
  if (port.name !== 'ytbm-stems-session' || !port.sender?.tab || port.sender.id !== chrome.runtime.id) return;
  const sender = port.sender;
  port.onMessage.addListener(() => {});
  port.onDisconnect.addListener(() => {
    chrome.offscreen.hasDocument().then(present => present && chrome.runtime.sendMessage({
      target: 'ytbm-stems-host', type: 'ytbm-stems-frame-close', tabId: sender.tab.id,
      frameId: sender.frameId || 0, documentId: sender.documentId,
    })).catch(() => {});
  });
});

async function inspectStemStorage() {
  await ensureStemHost();
  const report = await chrome.runtime.sendMessage({ target: 'ytbm-stems-host', type: 'ytbm-stems-storage-inspect' });
  if (!report?.ok) throw new Error(report?.error || 'Storage inspection unavailable');
  const tabs = (await chrome.tabs.query({})).filter(tab => isVideoTabUrl(tab.url));
  const sessions = await Promise.all(tabs.map(async tab => {
    let timeout;
    try {
      const session = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { type: 'ytbm-stems-session-inspect' }),
        new Promise(resolve => { timeout = setTimeout(() => resolve(null), 1500); }),
      ]);
      return session ? { tabId: tab.id, ...session } : null;
    } catch { return null; }
    finally { clearTimeout(timeout); }
  }));
  return { ...report, extensionId: chrome.runtime.id, extensionOrigin: chrome.runtime.getURL(''),
    version: chrome.runtime.getManifest().version, sessions: sessions.filter(Boolean) };
}

chrome.tabs.onMoved.addListener((tabId, info) => { broadcastOrder(info.windowId); });
chrome.tabs.onAttached.addListener((tabId, info) => { broadcastOrder(info.newWindowId); });
chrome.tabs.onDetached.addListener((tabId, info) => { broadcastOrder(info.oldWindowId); });
chrome.tabs.onRemoved.addListener((tabId, info) => {
  stateReady.then(() => { removeTab(tabId); broadcastOrder(info.windowId); });
  if (chrome.offscreen) chrome.offscreen.hasDocument().then(present => present && chrome.runtime.sendMessage({
    target: 'ytbm-stems-host', type: 'ytbm-stems-tab-close', tabId,
  })).catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab || typeof tab.id !== 'number') return;
  stateReady.then(async () => {
    if (changeInfo.url && !isVideoTabUrl(changeInfo.url)) {
      await setVJProtection(tab.id, false);
      removeTab(tab.id);
    }
    if (changeInfo.status === 'complete' || changeInfo.url) broadcastOrder(tab.windowId);
  });
});
