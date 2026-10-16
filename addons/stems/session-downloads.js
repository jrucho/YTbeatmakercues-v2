/* Browser-only, feature-owned temporary source downloads. No writes to the
 * installed extension directory. Every file is deleted with its session. */
(function (root) {
  function safeName(value, fallback = 'video') {
    return String(value || fallback).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9 _.-]/g, '_').replace(/\.{2,}/g, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 80) || fallback;
  }
  class SessionDownloads {
    constructor(storage = navigator.storage) { this.storage = storage; this.entries = new Map(); }
    async directory(create = true) {
      const root = await this.storage.getDirectory();
      return (await root.getDirectoryHandle('ytbm-stems', { create })).getDirectoryHandle('videos', { create });
    }
    save(owner, metadata, bytes) {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > 64 * 1024 * 1024) return Promise.reject(new Error('Invalid source download size'));
      let entry = this.entries.get(owner);
      if (!entry) {
        const suffix = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        const name = `${safeName(metadata.videoId || 'video')}-${safeName(metadata.title, 'untitled')}-${suffix}`;
        entry = { name, queue: Promise.resolve(), active: true, path: `ytbm-stems/videos/${name}/`, bytes: 0 };
        this.entries.set(owner, entry);
      }
      const task = entry.queue.catch(() => {}).then(async () => {
        if (!entry.active || this.entries.get(owner) !== entry) return null;
        const parent = await this.directory();
        if (!entry.active) return null;
        const folder = await parent.getDirectoryHandle(entry.name, { create: true });
        const write = async (name, data) => {
          const writable = await (await folder.getFileHandle(name, { create: true })).createWritable();
          try { await writable.write(data); if (!entry.active) { await writable.abort(); return; } await writable.close(); }
          catch (error) { await writable.abort().catch(() => {}); throw error; }
        };
        const filename = metadata.complete ? 'source.audio' : 'source.audio.part';
        await write(filename, bytes);
        if (!entry.active) return null;
        if (metadata.complete) await folder.removeEntry('source.audio.part').catch(error => { if (error.name !== 'NotFoundError') throw error; });
        await write('video.json', JSON.stringify({ ...metadata, temporary: true, sourceFile: filename, encodedBytes: bytes.byteLength }, null, 2));
        entry.bytes = bytes.byteLength; entry.complete = !!metadata.complete;
        return entry.path;
      });
      entry.queue = task;
      return task;
    }
    async clear(owner) {
      const entry = this.entries.get(owner); if (!entry) return;
      entry.active = false; this.entries.delete(owner);
      await entry.queue.catch(() => {});
      try { await (await this.directory(false)).removeEntry(entry.name, { recursive: true }); }
      catch (error) { if (error.name !== 'NotFoundError') throw error; }
    }
    async clearFrame(frame) {
      await Promise.all([...this.entries.keys()].filter(owner => owner.startsWith(frame + '/')).map(owner => this.clear(owner)));
    }
    async clearAll() {
      for (const entry of this.entries.values()) entry.active = false;
      const pending = [...this.entries.values()].map(entry => entry.queue.catch(() => {}));
      this.entries.clear(); await Promise.all(pending);
      try {
        const dir = await (await this.storage.getDirectory()).getDirectoryHandle('ytbm-stems');
        await dir.removeEntry('videos', { recursive: true });
      } catch (error) { if (error.name !== 'NotFoundError') throw error; }
    }
  }
  root.YTBMSessionDownloads = { SessionDownloads, safeName };
  if (typeof module !== 'undefined') module.exports = root.YTBMSessionDownloads;
})(globalThis);
