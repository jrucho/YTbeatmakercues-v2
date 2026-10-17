/* IN/OUT video-region transport. Independent of the recorder/overdub looper. */
(function (root) {
  const MIN_SECONDS = 0.1;
  const empty = () => ({ in: null, out: null, enabled: false });
  const clean = value => ({
    in: Number.isFinite(value?.in) && value.in >= 0 ? value.in : null,
    out: Number.isFinite(value?.out) && value.out >= 0 ? value.out : null,
    enabled: value?.enabled === true,
  });
  const stamp = time => time == null ? 'not set' : `${Math.floor(time / 60)}:${(time % 60).toFixed(3).padStart(6, '0')}`;
  const wrap = (position, start, end) => {
    const length = end - start;
    let phase = ((position - start) % length + length) % length;
    // Scheduled buffer boundaries are quantized to samples, not media doubles.
    if (length - phase < 2 / 44100) phase = 0;
    return start + phase;
  };

  class RegionLoop {
    constructor(options) {
      this.options = options;
      this.state = empty(); this.key = null; this.generation = 0;
      this.clock = null; this.timer = null; this.internalUntil = 0;
      this.nativeRepeats = 0; this.audioRepeats = 0; this.message = '';
      this.keys = new Set(); this.keyTimer = null; this.chord = false;
      this.listeners = [];
      this.now = options.now || (() => performance.now());
      this.interval = options.setInterval || ((fn, ms) => setInterval(fn, ms));
      this.clearInterval = options.clearInterval || (id => clearInterval(id));
      this.doc = options.document || (typeof document !== 'undefined' ? document : null);
      if (this.doc) {
        const listen = (target, name, fn) => {
          target.addEventListener(name, fn, true);
          this.listeners.push(() => target.removeEventListener(name, fn, true));
        };
        for (const type of ['loadedmetadata', 'durationchange', 'play', 'pause', 'ended', 'seeked', 'seeking']) {
          listen(this.doc, type, event => {
            if (event.target !== this.options.getVideo()) return;
            this.sync();
            if (type === 'seeking') this.mediaSeeking();
            if (type === 'seeked') this.internalUntil = 0;
            if (type === 'pause' && !event.target.ended) this.dropClock();
            this.render(); this.tick();
          });
        }
        listen(this.doc, 'yt-navigate-finish', () => this.sync());
        listen(this.doc, 'pointerdown', event => {
          if (this.menu && !this.menu.contains(event.target)) this.menu.style.display = 'none';
        });
        listen(this.doc, 'keydown', event => { if (event.key === 'Escape' && this.menu) this.menu.style.display = 'none'; });
        if (this.doc.defaultView) listen(this.doc.defaultView, 'blur', () => this.cancelKeys());
      }
      this.sync();
    }
    range() {
      const { in: start, out: end, enabled } = this.state;
      const duration = this.options.getVideo()?.duration;
      if (!enabled || start == null || end == null || end - start < MIN_SECONDS - 1e-8 ||
          (Number.isFinite(duration) && duration > 0 && end > duration + 0.01)) return null;
      return { in: start, out: end };
    }
    valid(start = this.state.in, end = this.state.out) {
      const duration = this.options.getVideo()?.duration;
      return start != null && end != null && Number.isFinite(start) && Number.isFinite(end) && start >= 0 &&
        end - start >= MIN_SECONDS - 1e-8 && (!Number.isFinite(duration) || duration <= 0 || end <= duration + 0.01);
    }
    storageKey() { return `ytbm-region-loop:${this.key}`; }
    sync() {
      const key = this.options.getVideoId();
      if (key === this.key) return;
      this.cancelKeys();
      this.key = key; this.state = empty(); this.clock = null; this.internalUntil = 0; this.message = '';
      this.drag = null; this.preview = null;
      const generation = ++this.generation;
      this.options.onChange?.(); this.updateTimer(); this.render();
      if (!key || !this.options.storage) return;
      const storageKey = this.storageKey();
      Promise.resolve().then(() => this.options.storage.get(storageKey)).then(result => {
        if (generation !== this.generation || this.key !== key || this.disposed) return;
        this.state = clean(result?.[storageKey]);
        if (!this.valid()) this.state.enabled = false;
        this.options.onChange?.(); this.updateTimer(); this.render(); this.tick();
      }).catch(() => {});
    }
    snapshot() { return { videoId: this.key, ...this.state }; }
    restore(value) {
      this.sync();
      if (value?.videoId === this.key) this.change(value, { record: false });
    }
    change(next, { record = true } = {}) {
      const state = clean(next);
      if (!this.valid(state.in, state.out)) state.enabled = false;
      if (JSON.stringify(state) === JSON.stringify(this.state)) { this.generation++; return; }
      if (record) this.options.beforeChange?.();
      this.generation++;
      this.state = state;
      this.clock = null; this.internalUntil = 0; this.message = '';
      this.options.onChange?.(); this.updateTimer(); this.render();
      if (this.options.storage && this.key) {
        const key = this.storageKey(), value = { ...this.state };
        this.writes = (this.writes || Promise.resolve()).catch(() => {}).then(() => this.options.storage.set({ [key]: value })).catch(() => {});
      }
      this.tick();
    }
    mark(which, capturedTime) {
      this.sync();
      const video = this.options.getVideo();
      if (!video || video.readyState < 1 || !Number.isFinite(video.currentTime)) return;
      const time = Math.max(0, capturedTime ?? video.currentTime);
      if (which === 'in') {
        const out = this.state.out != null && this.state.out - time >= MIN_SECONDS ? this.state.out : null;
        this.change({ in: time, out, enabled: out != null });
      } else {
        if (!this.valid(this.state.in, time)) {
          this.message = this.state.in == null ? 'Set IN first' : 'OUT must be at least 0.10 s after IN';
          this.render(); return;
        }
        this.change({ ...this.state, out: time, enabled: true });
      }
    }
    keyDown(key) {
      if (this.keys.has(key)) return;
      this.keys.add(key);
      if (this.keys.size === 2) {
        if (this.keyTimer != null) clearTimeout(this.keyTimer);
        this.keyTimer = null; this.pendingKey = null; this.chord = true;
        this.clear(); return;
      }
      if (this.chord) return;
      // Capture the press position now, allowing a short chord-detection window
      // so simultaneous I+O clears without first moving either saved boundary.
      this.pendingKey = { key, time: this.options.getVideo()?.currentTime, videoId: this.options.getVideoId() };
      this.keyTimer = setTimeout(() => this.flushKey(), 80);
    }
    flushKey() {
      if (this.keyTimer != null) clearTimeout(this.keyTimer);
      this.keyTimer = null;
      const pending = this.pendingKey; this.pendingKey = null;
      if (pending && !this.chord && pending.videoId === this.options.getVideoId()) this.mark(pending.key === 'i' ? 'in' : 'out', pending.time);
    }
    keyUp(key) {
      if (this.pendingKey?.key === key) this.flushKey();
      this.keys.delete(key);
      if (!this.keys.size) this.chord = false;
    }
    cancelKeys() {
      if (this.keyTimer != null) clearTimeout(this.keyTimer);
      this.keyTimer = null; this.pendingKey = null; this.keys.clear(); this.chord = false;
    }
    toggle() {
      this.sync();
      if (!this.valid()) { this.message = 'Set IN and OUT first'; this.render(); return; }
      this.change({ ...this.state, enabled: !this.state.enabled });
    }
    clear() { this.sync(); this.change(empty()); }
    erase(which) { this.change({ ...this.state, [which]: null, enabled: false }); }
    updateTimer() {
      if (this.state.enabled && !this.timer) this.timer = this.interval(() => this.tick(), 12);
      if (!this.state.enabled && this.timer) { this.clearInterval(this.timer); this.timer = null; }
    }
    dropClock() {
      if (!this.clock) return;
      this.clock = null; this.options.onClockReset?.();
    }
    alignAudioClock(now, rate, media) {
      const range = this.range();
      if (!range) return null;
      if (this.clock) {
        if (Math.abs(this.clock.rate - rate) > 1e-8) {
          this.clock = { media: this.positionAt(now), at: now, rate };
        }
        return this.clock;
      }
      if (media < range.in - 0.001 || media >= range.out) return null;
      this.clock = { media: Math.max(range.in, media), at: now, rate };
      return this.clock;
    }
    positionAt(time) {
      const range = this.range();
      if (!range || !this.clock) return null;
      return wrap(this.clock.media + (time - this.clock.at) * this.clock.rate, range.in, range.out);
    }
    userSeek(target) {
      const range = this.range();
      if (!range) return;
      // Cues/scrubbing do not silently turn the loop off. An outside seek is
      // brought back into the selected region once the decoder is ready.
      this.dropClock();
    }
    mediaSeeking() {
      const video = this.options.getVideo();
      if (!video) return;
      if (this.now() < this.internalUntil && Math.abs(video.currentTime - this.internalTarget) < 0.15) return;
      this.userSeek(video.currentTime);
    }
    seek(target, visualOnly) {
      this.internalTarget = target; this.internalUntil = this.now() + 1500;
      try {
        if (visualOnly) this.options.getVideo().currentTime = target;
        else this.options.seek(target);
      } catch { this.internalUntil = 0; }
    }
    tick() {
      if (this.disposed) return;
      this.sync();
      const range = this.range(), video = this.options.getVideo();
      if (!range || !video || (this.options.isEligible && !this.options.isEligible())) { this.dropClock(); return; }
      if (video.seeking || this.now() < this.internalUntil) return;
      if (video.ended) {
        this.seek(this.clock ? this.positionAt(this.options.audioTime()) : range.in, !!this.clock);
        video.play?.().catch(() => {}); return;
      }
      if (video.paused) { this.dropClock(); return; }
      if (this.clock) {
        const now = this.options.audioTime?.();
        if (Number.isFinite(now)) {
          const position = this.positionAt(now);
          if (video.currentTime >= range.out || video.currentTime < range.in - 0.02 || Math.abs(video.currentTime - position) > 0.12) {
            this.audioRepeats++; this.seek(position, true);
          }
        }
      } else if (video.currentTime >= range.out || video.currentTime < range.in - 0.02 || video.ended) {
        this.nativeRepeats++; this.seek(range.in, false);
      }
      if (this.now() - (this.lastPaint || 0) > 250) { this.lastPaint = this.now(); this.renderMarkers(); }
    }
    createControls() {
      const doc = this.doc;
      const group = doc.createElement('div'); group.className = 'ytbm-region-controls';
      group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Video region loop');
      const make = (name, text, action) => {
        const button = doc.createElement('button'); button.type = 'button';
        button.className = 'looper-btn ytbm-region-btn'; button.dataset.regionAction = name; button.textContent = text;
        this.options.bindPress(button, action);
        button.addEventListener('contextmenu', event => {
          event.preventDefault(); event.stopPropagation(); this.openMenu(button);
        });
        group.appendChild(button); return button;
      };
      this.controls = { group, in: make('in', 'IN', () => this.mark('in')),
        out: make('out', 'OUT', () => this.mark('out')), clear: make('clear', '↻', () => this.clear()) };
      this.controls.clear.innerHTML = '<svg class="ytbm-region-loop-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10a8 8 0 1 0-1.8 7.1M20 4v6h-6"/></svg>';
      this.render(); return group;
    }
    render() {
      if (this.controls) {
        for (const which of ['in', 'out']) {
          const button = this.controls[which], set = this.state[which] != null;
          button.classList.toggle('ytbm-region-set', set);
          button.setAttribute('aria-pressed', String(set));
          button.setAttribute('aria-label', `Loop ${which.toUpperCase()}: ${stamp(this.state[which])}`);
          button.title = `${which.toUpperCase()}: ${stamp(this.state[which])}\n${which.toUpperCase()}: mark current position · Right-click: adjust/clear`;
        }
        const button = this.controls.clear;
        button.classList.toggle('ytbm-region-enabled', this.state.enabled && !!this.range());
        button.disabled = this.state.in == null && this.state.out == null;
        button.setAttribute('aria-label', 'Clear IN and OUT');
        button.title = this.message || `Region loop ${this.state.enabled ? 'on' : 'off'}\n${stamp(this.state.in)} → ${stamp(this.state.out)}\nPress or I+O: clear · U: undo · Right-click: options`;
      }
      this.renderMarkers();
    }
    renderMarkers() {
      if (!this.doc || !this.options.getProgressBar) return;
      const bar = this.options.getProgressBar(), duration = this.options.getVideo()?.duration;
      if (!bar || !Number.isFinite(duration) || duration <= 0 || (this.state.in == null && this.state.out == null)) {
        this.markers?.remove(); this.markers = null; return;
      }
      if (!this.markers || this.markers.parentNode !== bar) {
        this.markers?.remove();
        this.markers = this.doc.createElement('div'); this.markers.className = 'ytbm-region-overlay';
        this.markers.innerHTML = '<div class="ytbm-region-selection"></div><span class="ytbm-region-marker ytbm-region-in">IN</span><span class="ytbm-region-marker ytbm-region-out">OUT</span>';
        for (const which of ['in', 'out']) {
          const marker = this.markers.querySelector(`.ytbm-region-${which}`);
          marker.addEventListener('dblclick', event => { event.preventDefault(); event.stopPropagation(); this.erase(which); });
          marker.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
          marker.addEventListener('pointerdown', event => this.startDrag(event, which, marker, bar));
          marker.addEventListener('pointermove', event => this.moveDrag(event));
          marker.addEventListener('pointerup', event => this.finishDrag(event));
          marker.addEventListener('pointercancel', event => this.finishDrag(event, true));
          marker.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); this.openMenu(marker); });
        }
        bar.appendChild(this.markers);
      }
      const state = this.preview || this.state;
      const percent = value => Math.max(0, Math.min(100, value / duration * 100));
      for (const which of ['in', 'out']) {
        const marker = this.markers.querySelector(`.ytbm-region-${which}`);
        marker.style.display = state[which] == null ? 'none' : '';
        marker.title = `${which.toUpperCase()}: ${stamp(state[which])}\nDrag: move · Double-click: erase · U: undo`;
        if (state[which] != null) marker.style.left = `${percent(state[which])}%`;
      }
      const selection = this.markers.querySelector('.ytbm-region-selection');
      selection.style.display = this.valid(state.in, state.out) ? '' : 'none';
      if (this.valid(state.in, state.out)) {
        selection.style.left = `${percent(state.in)}%`;
        selection.style.width = `${percent(state.out) - percent(state.in)}%`;
        selection.classList.toggle('ytbm-region-enabled', this.state.enabled);
      }
    }
    startDrag(event, which, marker, bar) {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      this.drag = { which, marker, bar, pointerId: event.pointerId, x: event.clientX, key: this.key };
      marker.setPointerCapture(event.pointerId);
    }
    moveDrag(event) {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      if (Math.abs(event.clientX - this.drag.x) < 2 && !this.preview) return;
      const rect = this.drag.bar.getBoundingClientRect(), duration = this.options.getVideo()?.duration;
      if (!(rect.width > 0) || !Number.isFinite(duration)) return;
      let time = Math.max(0, Math.min(duration, (event.clientX - rect.left) / rect.width * duration));
      if (this.drag.which === 'in' && this.state.out != null) time = Math.max(0, Math.min(time, this.state.out - MIN_SECONDS));
      if (this.drag.which === 'out' && this.state.in != null) time = Math.max(time, this.state.in + MIN_SECONDS);
      this.preview = { ...this.state, [this.drag.which]: time };
      this.renderMarkers();
    }
    finishDrag(event, cancelled = false) {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      const drag = this.drag, next = this.preview;
      this.drag = null; this.preview = null;
      try { drag.marker.releasePointerCapture(event.pointerId); } catch {}
      if (!cancelled && next && drag.key === this.options.getVideoId()) this.change(next);
      this.renderMarkers();
    }
    openMenu(anchor) {
      this.sync();
      if (!this.menu) {
        const menu = this.doc.createElement('form'); menu.className = 'ytbm-region-menu';
        menu.setAttribute('aria-label', 'Adjust video region loop');
        menu.innerHTML = '<label>IN (seconds)<input name="regionIn" type="number" min="0" step="0.001" required></label><label>OUT (seconds)<input name="regionOut" type="number" min="0" step="0.001" required></label><div class="ytbm-region-menu-status" role="status"></div><div class="ytbm-region-menu-actions"><button type="submit">Apply</button><button type="button" data-region-toggle>Pause loop</button><button type="button" data-region-clear>Clear</button><button type="button" data-region-close>Close</button></div>';
        menu.addEventListener('submit', event => {
          event.preventDefault();
          const start = Number.parseFloat(menu.elements.regionIn.value), end = Number.parseFloat(menu.elements.regionOut.value);
          if (!this.valid(start, end)) { menu.querySelector('[role="status"]').textContent = 'OUT must follow IN by at least 0.10 s and be within the video.'; return; }
          this.change({ in: start, out: end, enabled: true }); menu.style.display = 'none';
        });
        menu.querySelector('[data-region-clear]').addEventListener('click', () => { this.clear(); menu.style.display = 'none'; });
        menu.querySelector('[data-region-toggle]').addEventListener('click', () => { this.toggle(); menu.style.display = 'none'; });
        menu.querySelector('[data-region-close]').addEventListener('click', () => { menu.style.display = 'none'; });
        this.doc.body.appendChild(menu); this.menu = menu;
      }
      this.menu.elements.regionIn.value = this.state.in == null ? '' : this.state.in.toFixed(3);
      this.menu.elements.regionOut.value = this.state.out == null ? '' : this.state.out.toFixed(3);
      this.menu.querySelector('[role="status"]').textContent = this.clock ? 'Stem audio-clock looping' : 'Player looping; seek gaps may be audible';
      this.menu.querySelector('[data-region-toggle]').textContent = this.state.enabled ? 'Pause loop' : 'Enable loop';
      this.menu.querySelector('[data-region-toggle]').disabled = !this.valid();
      this.menu.style.display = 'block';
      const r = anchor.getBoundingClientRect(), w = this.menu.offsetWidth, h = this.menu.offsetHeight;
      this.menu.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left))}px`;
      this.menu.style.top = `${Math.max(8, r.top - h - 8 >= 8 ? r.top - h - 8 : Math.min(innerHeight - h - 8, r.bottom + 8))}px`;
    }
    dispose() {
      this.disposed = true;
      this.cancelKeys();
      if (this.timer) this.clearInterval(this.timer);
      this.timer = null; this.clock = null;
      this.listeners.forEach(remove => remove()); this.listeners = [];
      this.menu?.remove(); this.markers?.remove();
    }
  }
  root.YTBMRegionLoop = { RegionLoop, MIN_SECONDS, wrap };
  if (typeof module !== 'undefined') module.exports = root.YTBMRegionLoop;
})(globalThis);
