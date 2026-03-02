const ytbmByChromeTabId = new Map();
const chromeTabByYtbmId = new Map();

function setMapping(ytbmTabId, tab) {
  if (!ytbmTabId || !tab || typeof tab.id !== 'number') return;
  const prevChromeTabId = chromeTabByYtbmId.get(ytbmTabId);
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
}

async function buildOrderForWindow(windowId) {
  if (typeof windowId !== 'number') return [];
  const tabs = await chrome.tabs.query({ windowId });
  return tabs
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
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
  (async () => {
    if (!msg || !msg.type) return;
    if (msg.type === 'ytbm-register-tab') {
      const tab = sender.tab;
      const ytbmTabId = msg.ytbmTabId;
      if (tab && typeof tab.id === 'number' && typeof ytbmTabId === 'string') {
        setMapping(ytbmTabId, tab);
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
  })();
  return true;
});

chrome.tabs.onMoved.addListener((tabId, info) => { broadcastOrder(info.windowId); });
chrome.tabs.onAttached.addListener((tabId, info) => { broadcastOrder(info.newWindowId); });
chrome.tabs.onDetached.addListener((tabId, info) => { broadcastOrder(info.oldWindowId); });
chrome.tabs.onRemoved.addListener((tabId, info) => {
  removeTab(tabId);
  broadcastOrder(info.windowId);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    broadcastOrder(tab.windowId);
  }
});
