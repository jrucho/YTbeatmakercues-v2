/* Extension-origin model storage. The package contains no model bytes. */
(function (root) {
  const SPEC = Object.freeze({
    url: 'https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/d54ed9eb60e258ea82131c6ee14578628816456a/htdemucs_fp16weights.onnx',
    bytes: 165612636,
    sha256: 'd05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a',
    directory: 'ytbm-stems', filename: 'htdemucs-fp16.onnx',
  });
  class ModelStore {
    constructor(storage = navigator.storage, spec = SPEC, fetcher = (...args) => fetch(...args)) {
      this.storage = storage; this.spec = spec; this.fetcher = fetcher;
      this.job = null; this.verified = null;
      this.epoch = 0; this.checking = null;
    }
    async hash(file) {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    }
    async status() {
      if (this.checking) return this.checking;
      const epoch = this.epoch;
      const check = this.checkStatus(epoch);
      this.checking = check;
      try { return await check; } finally { if (this.checking === check) this.checking = null; }
    }
    async checkStatus(epoch) {
      try {
        const dir = await (await this.storage.getDirectory()).getDirectoryHandle(this.spec.directory);
        const file = await (await dir.getFileHandle(this.spec.filename)).getFile();
        const fingerprint = `${file.size}:${file.lastModified}`;
        if (file.size !== this.spec.bytes) return { ok: true, present: false, bytes: file.size, reason: 'size-mismatch' };
        if (this.verified !== fingerprint) {
          if (await this.hash(file) !== this.spec.sha256) return { ok: true, present: false, bytes: file.size, reason: 'checksum-mismatch' };
          if (epoch !== this.epoch) return { ok: true, present: false, bytes: 0, reason: 'removed' };
          this.verified = fingerprint;
        }
        return { ok: true, present: true, bytes: file.size, source: 'opfs', lastModified: file.lastModified };
      } catch (err) {
        if (err.name !== 'NotFoundError') throw err;
        return { ok: true, present: false, bytes: 0, reason: 'missing' };
      }
    }
    download(progress = () => {}) {
      if (this.job) return this.job.promise;
      const job = { abort: new AbortController() };
      this.job = job;
      job.promise = this.write(job, progress).finally(() => { if (this.job === job) this.job = null; });
      return job.promise;
    }
    async write(job, progress) {
      let dir, writable;
      const check = () => { if (job.abort.signal.aborted) throw new DOMException('Download cancelled', 'AbortError'); };
      try {
        if ((await this.status()).present) { check(); return this.status(); }
        check();
        dir = await (await this.storage.getDirectory()).getDirectoryHandle(this.spec.directory, { create: true });
        const handle = await dir.getFileHandle(this.spec.filename + '.part', { create: true });
        writable = await handle.createWritable();
        let received = 0, postedAt = 0;
        let source = this.spec.url, retries = 0;
        // Bounded ranges avoid CDN HTTP/2 failures on a single 166 MB stream.
        // If a range disconnects, resume after the last successfully written
        // byte. Only the final full-file SHA-256 can publish this model.
        while (received < this.spec.bytes) {
          check();
          const end = Math.min(this.spec.bytes - 1, received + 4 * 1024 * 1024 - 1);
          let reader;
          const rangeAbort = new AbortController();
          const abortRange = () => rangeAbort.abort();
          job.abort.signal.addEventListener('abort', abortRange, { once: true });
          const rangeTimer = setTimeout(abortRange, 30000);
          try {
            const response = await this.fetcher(source, { signal: rangeAbort.signal, cache: 'no-store', headers: { Range: `bytes=${received}-${end}` } });
            if (!response.ok || !response.body) throw new Error('Download failed: HTTP ' + response.status);
            const range = (response.headers.get('content-range') || '').match(/^bytes (\d+)-(\d+)\/(\d+)$/);
            if (response.status === 206) {
              if (!range || Number(range[1]) !== received || Number(range[3]) !== this.spec.bytes || Number(range[2]) > end) {
                await response.body.cancel();
                throw new Error('Invalid model download range');
              }
            } else if (received) {
              await response.body.cancel();
              throw new Error('Model server cannot resume the download');
            }
            if (response.url) source = response.url;
            const expectedEnd = range ? Number(range[2]) + 1 : this.spec.bytes;
            reader = response.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              check();
              if (done) break;
              if (received + value.byteLength > expectedEnd) throw new Error('Unexpected model size');
              await writable.write(value);
              received += value.byteLength;
              if (Date.now() - postedAt > 400) {
                progress({ received, expected: this.spec.bytes, f: Math.min(0.99, received / this.spec.bytes) });
                postedAt = Date.now();
              }
            }
            if (received !== expectedEnd) throw new Error('Incomplete model range');
            retries = 0;
          } catch (error) {
            if (reader) await reader.cancel().catch(() => {});
            check();
            if (++retries > 3 || /Invalid model|Unexpected model|cannot resume/.test(error.message)) throw error;
            await new Promise(resolve => setTimeout(resolve, retries * 500));
          } finally {
            clearTimeout(rangeTimer);
            job.abort.signal.removeEventListener('abort', abortRange);
          }
        }
        if (received !== this.spec.bytes) throw new Error('Incomplete model download');
        await writable.close(); writable = null;
        progress({ received, expected: received, f: 0.99, verifying: true });
        const file = await handle.getFile();
        if (await this.hash(file) !== this.spec.sha256) throw new Error('Model checksum mismatch');
        check();
        // Publish only verified bytes. No partial file is ever considered installed.
        const destination = await dir.getFileHandle(this.spec.filename, { create: true });
        writable = await destination.createWritable();
        await writable.write(file);
        check();
        await writable.close(); writable = null;
        await dir.removeEntry(this.spec.filename + '.part');
        this.verified = null;
        const status = await this.status();
        check();
        if (!status.present) throw new Error('Model verification failed');
        return status;
      } catch (err) {
        if (writable) await writable.abort().catch(() => {});
        if (dir) for (const name of [this.spec.filename + '.part', this.spec.filename]) {
          await dir.removeEntry(name).catch(() => {});
        }
        this.verified = null;
        throw err;
      }
    }
    async cancel() {
      const job = this.job;
      if (job) { job.abort.abort(); await job.promise.catch(() => {}); }
    }
    async remove() {
      this.epoch++;
      await this.cancel();
      if (this.checking) await this.checking.catch(() => {});
      const root = await this.storage.getDirectory();
      try { await root.removeEntry(this.spec.directory, { recursive: true }); }
      catch (err) { if (err.name !== 'NotFoundError') throw err; }
      this.verified = null;
      try { await root.getDirectoryHandle(this.spec.directory); }
      catch (err) {
        if (err.name === 'NotFoundError') return { ok: true, removed: true, verified: true };
        throw err;
      }
      throw new Error('Model folder could not be erased');
    }
    async discardPartial() {
      if (this.job) return;
      try {
        const dir = await (await this.storage.getDirectory()).getDirectoryHandle(this.spec.directory);
        try { await dir.removeEntry(this.spec.filename + '.part'); }
        catch (error) { if (error.name !== 'NotFoundError') throw error; }
        // An interrupted installation must not leave an empty feature folder.
        let hasFiles = false;
        for await (const entry of dir.entries()) { hasFiles = true; break; }
        if (!hasFiles) await (await this.storage.getDirectory()).removeEntry(this.spec.directory);
      } catch (error) { if (error.name !== 'NotFoundError') throw error; }
    }
  }
  root.YTBMModelStore = { ModelStore, SPEC };
  if (typeof module !== 'undefined') module.exports = root.YTBMModelStore;
})(globalThis);
