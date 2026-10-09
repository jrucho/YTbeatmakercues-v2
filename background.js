const ytbmByChromeTabId = new Map();
const chromeTabByYtbmId = new Map();
const vjProtectedTabs = new Map();
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
  if (!msg || !['ytbm-register-tab', 'ytbm-get-tab-order', 'ytbm-vj-performance'].includes(msg.type)) return false;
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

chrome.tabs.onMoved.addListener((tabId, info) => { broadcastOrder(info.windowId); });
chrome.tabs.onAttached.addListener((tabId, info) => { broadcastOrder(info.newWindowId); });
chrome.tabs.onDetached.addListener((tabId, info) => { broadcastOrder(info.oldWindowId); });
chrome.tabs.onRemoved.addListener((tabId, info) => {
  stateReady.then(() => { removeTab(tabId); broadcastOrder(info.windowId); });
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
