/* Shared dark tooltips for extension controls. Never changes host-page titles. */
(() => {
  if (window.YTBMTooltips) return;
  const scope = '[class*="ytbm-"], [class*="looper-"], #touchPopup';
  const extensionPage = location.protocol === 'chrome-extension:';
  const owns = el => extensionPage || !!el.closest(scope);
  let bubble = null, anchor = null;
  const listeners = [];
  const labels = new WeakMap();

  function text(el) {
    if (el.hasAttribute('title')) {
      const title = el.getAttribute('title');
      el.dataset.ytbmTooltip = title;
      el.removeAttribute('title');
      // Removing native title must not remove a control's accessible name.
      if (el.matches('button, input, select, a, [role="button"]') &&
          !el.hasAttribute('aria-labelledby') &&
          (!el.hasAttribute('aria-label') || el.getAttribute('aria-label') === labels.get(el))) {
        el.setAttribute('aria-label', title);
        labels.set(el, title);
      }
    }
    return el.getAttribute('data-hint') || el.dataset.ytbmTooltip || '';
  }

  function hide() {
    if (anchor) {
      const ids = (anchor.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== 'ytbm-tooltip');
      if (ids.length) anchor.setAttribute('aria-describedby', ids.join(' '));
      else anchor.removeAttribute('aria-describedby');
    }
    anchor = null;
    if (bubble) bubble.style.display = 'none';
  }

  function show(el) {
    const message = text(el);
    if (!message || !el.isConnected) { hide(); return; }
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.id = 'ytbm-tooltip';
      bubble.setAttribute('role', 'tooltip');
      bubble.style.cssText = 'all:initial;position:fixed;box-sizing:border-box;max-width:min(320px,calc(100vw - 16px));background:rgb(16,16,16);color:#fff;border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:7px 10px;font:12px/1.4 Arial,sans-serif;white-space:pre-line;overflow-wrap:anywhere;box-shadow:0 12px 32px rgba(0,0,0,.5);z-index:2147483647;pointer-events:none;';
      document.documentElement.appendChild(bubble);
    }
    if (anchor !== el) hide();
    anchor = el;
    const ids = new Set((el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    ids.add(bubble.id);
    el.setAttribute('aria-describedby', [...ids].join(' '));
    bubble.textContent = message;
    bubble.style.display = 'block';
    const r = el.getBoundingClientRect();
    const width = bubble.offsetWidth, height = bubble.offsetHeight;
    bubble.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, r.left + r.width / 2 - width / 2))}px`;
    const top = r.top - height - 8;
    bubble.style.top = `${Math.max(8, Math.min(innerHeight - height - 8, top >= 8 ? top : r.bottom + 8))}px`;
  }

  function enter(event) {
    if (!(event.target instanceof Element)) return;
    // Suppress ancestor native titles too; otherwise Chrome can show a second,
    // white tooltip above the shared one (e.g. the Speed HD tuning group).
    let el = event.target, first = null;
    while (el) {
      if (owns(el) && el.matches('[title], [data-hint], [data-ytbm-tooltip]')) {
        if (text(el) && !first) first = el;
      }
      el = el.parentElement;
    }
    if (first) show(first);
    else hide();
  }

  function listen(target, name, fn) {
    target.addEventListener(name, fn, true);
    listeners.push(() => target.removeEventListener(name, fn, true));
  }
  listen(document, 'pointerover', enter);
  listen(document, 'focusin', enter);
  listen(document, 'pointerout', event => {
    if (anchor && !(event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget))) hide();
  });
  for (const name of ['focusout', 'pointerdown', 'scroll']) listen(document, name, hide);
  for (const name of ['resize', 'blur', 'pagehide']) listen(window, name, hide);
  listen(document, 'keydown', event => { if (event.key === 'Escape') hide(); });
  const observer = new MutationObserver(records => {
    for (const { target } of records) {
      if (owns(target)) {
        text(target);
        if (target === anchor) show(target);
      }
    }
    if (anchor && !anchor.isConnected) hide();
  });
  observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['title', 'data-hint'] });
  window.YTBMTooltips = { hide, dispose() {
    hide(); observer.disconnect(); listeners.forEach(remove => remove());
    bubble?.remove(); delete window.YTBMTooltips;
  } };
})();
