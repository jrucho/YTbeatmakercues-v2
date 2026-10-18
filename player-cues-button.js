/* Real button mounted in YouTube's native right-hand player controls. */
(function (root) {
  class PlayerCuesButton {
    constructor(options) {
      this.options = options;
      this.doc = options.document || document;
      this.key = null; this.button = null; this.pending = null; this.disposed = false;
      this.listeners = [];
      const listen = (name, fn) => {
        this.doc.addEventListener(name, fn, true);
        this.listeners.push(() => this.doc.removeEventListener(name, fn, true));
      };
      listen('yt-navigate-finish', () => this.ensure());
      listen('fullscreenchange', () => { this.ensure(); options.onFullscreen?.(); });
      for (const event of ['loadedmetadata', 'loadeddata', 'play']) {
        listen(event, e => { if (e.target === options.getVideo()) this.ensure(); });
      }
      this.observer = new MutationObserver(records => {
        if (this.disposed || this.pending != null) return;
        // Ignore extension UI changes: labels update frequently during analysis.
        if (records.every(record => record.target.nodeType === 1 &&
            record.target.closest('[class*="ytbm-"], [class*="looper-"], #touchPopup'))) return;
        this.pending = setTimeout(() => { this.pending = null; this.ensure(); }, 80);
      });
      this.observer.observe(this.doc.documentElement, { childList: true, subtree: true });
      this.ensure();
    }
    ensure() {
      if (this.disposed) return;
      const key = this.options.getVideoId();
      if (key !== this.key) {
        this.key = key;
        this.options.onVideoChange?.();
      }
      const video = this.options.getVideo();
      const player = video?.closest('.html5-video-player, #movie_player');
      const controls = player?.querySelector('.ytp-right-controls');
      if (!controls) {
        this.button?.remove();
        return;
      }
      if (!this.button) {
        const button = this.doc.createElement('button');
        button.type = 'button';
        button.className = 'ytp-button ytbm-player-cues-button';
        button.setAttribute('aria-controls', 'ytbm-mini-bar');
        button.innerHTML = '<span class="ytbm-player-cues-content" aria-hidden="true"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" focusable="false"><rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" stroke="none"/><path d="M5 4.2 8.8 6.5 5 8.8Z" fill="#111" stroke="none"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></span>';
        button.addEventListener('click', event => {
          event.preventDefault(); event.stopPropagation();
          // A click may beat the navigation observer. Synchronize the player
          // first, preserving the user's tab-wide choice across videos.
          this.ensure();
          this.options.onToggle(); this.refresh();
        });
        button.addEventListener('dblclick', event => { event.preventDefault(); event.stopPropagation(); });
        button.addEventListener('keydown', event => {
          // Preserve native button Enter/Space activation; prevent player hotkeys.
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        });
        this.button = button;
      }
      const captions = controls.querySelector('.ytp-subtitles-button');
      const settings = controls.querySelector('.ytp-settings-button');
      // Keep the button beside CC, including YouTube's newer nested chip groups.
      // If captions are absent, place it immediately before Settings instead.
      const host = captions?.parentElement || settings?.parentElement || controls;
      const anchor = captions ? captions.nextSibling : settings;
      if (anchor !== this.button && (this.button.parentElement !== host || this.button.nextSibling !== anchor)) host.insertBefore(this.button, anchor);
      this.refresh();
    }
    refresh() {
      if (!this.button) return;
      const visible = !!this.options.isVisible();
      const action = visible ? 'Hide Cues mini bar' : 'Show Cues mini bar';
      if (this.button.getAttribute('aria-pressed') !== String(visible)) {
        this.button.setAttribute('aria-pressed', String(visible));
        this.button.setAttribute('aria-label', action);
        this.button.title = action;
      }
    }
    dispose() {
      this.disposed = true;
      if (this.pending != null) clearTimeout(this.pending);
      this.observer.disconnect(); this.listeners.forEach(remove => remove());
      this.button?.remove(); this.button = null;
    }
  }
  root.YTBMPlayerCues = { PlayerCuesButton };
})(globalThis);
