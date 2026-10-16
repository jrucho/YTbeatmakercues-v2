/* One model session per extension, with serialized requests across tabs. */
(function (root) {
  class InferenceHost {
    constructor(createWorker = () => new Worker('stems-inference-worker.js')) {
      this.createWorker = createWorker; this.clients = new Set(); this.queue = [];
      this.worker = null; this.active = null; this.initializing = null; this.ready = null; this.serial = 0;
    }
    async request(owner, message) {
      if (message.type === 'init') {
        this.clients.add(owner);
        if (this.ready) return this.ready;
        if (!this.initializing) {
          const worker = this.worker = this.createWorker();
          worker.onmessage = ({ data }) => { if (this.worker === worker) this.receive(data); };
          worker.onerror = error => { if (this.worker === worker) this.fail(error.message || 'Inference worker crashed'); };
          this.initializing = new Promise(resolve => { this.initResolve = resolve; });
          this.timer = setTimeout(() => this.fail('Model initialization timed out'), 120000);
          this.worker.postMessage(message);
        }
        return this.initializing;
      }
      if (!this.clients.has(owner) || !this.ready || !this.worker) return { type: 'error', id: message.id, error: 'Engine not initialized' };
      if (this.queue.length >= 32) return { type: 'error', id: message.id, error: 'Too many active separation jobs' };
      return new Promise(resolve => {
        this.queue.push({ owner, originalId: message.id, message: { ...message, id: ++this.serial }, resolve });
        this.pump();
      });
    }
    receive(data) {
      if (data.type === 'progress') return;
      if (this.initResolve) {
        clearTimeout(this.timer);
        const resolve = this.initResolve; this.initResolve = null;
        if (data.type === 'ready') { this.ready = data; resolve(data); this.pump(); }
        else { resolve(data); this.disposeWorker(); }
        return;
      }
      const job = this.active;
      if (!job || data.id !== job.message.id) return;
      clearTimeout(this.timer); this.active = null;
      job.resolve({ ...data, id: job.originalId });
      this.pump();
    }
    pump() {
      if (this.active || !this.ready || !this.worker) return;
      const job = this.queue.shift();
      if (!job) return;
      this.active = job;
      this.timer = setTimeout(() => this.fail('Model separation timed out'), 90000);
      try { this.worker.postMessage(job.message, [job.message.mix.buffer]); }
      catch (error) { this.receive({ type: 'error', id: job.message.id, error: error.message }); }
    }
    close(owner) {
      this.clients.delete(owner);
      this.queue = this.queue.filter(job => {
        if (job.owner !== owner) return true;
        job.resolve({ type: 'error', id: job.originalId, error: 'Separation cancelled' }); return false;
      });
      if (this.active?.owner === owner) {
        this.active.resolve({ type: 'error', id: this.active.originalId, error: 'Separation cancelled' });
        // The native run cannot be aborted without terminating WASM. Keep it
        // only when another client still owns the shared session; discard reply.
        this.active.resolve = () => {};
      }
      if (!this.clients.size) this.fail('Engine closed');
    }
    fail(error) {
      if (this.initResolve) { this.initResolve({ type: 'error', error }); this.initResolve = null; }
      if (this.active) this.active.resolve({ type: 'error', id: this.active.originalId, error });
      for (const job of this.queue) job.resolve({ type: 'error', id: job.originalId, error });
      this.active = null; this.queue = []; this.disposeWorker();
    }
    disposeWorker() {
      clearTimeout(this.timer); this.worker?.terminate(); this.worker = null;
      this.ready = null; this.initializing = null;
    }
    clear() { this.clients.clear(); this.fail('Resources removed'); }
  }
  root.YTBMInferenceHost = { InferenceHost };
  if (typeof module !== 'undefined') module.exports = root.YTBMInferenceHost;
})(globalThis);
