/* Explicit ownership: never delete another feature's databases, caches or
 * settings. Browser HTTP/WASM/GPU caches are separate, browser-managed stores. */
(function (root) {
  const DIRECTORIES = ['ytbm-stems', 'ytbm-stems-segments'];
  const owned = name => /^ytbm-stems(?:$|[-:/])/.test(name);
  async function listOPFS(directory, prefix = '') {
    const files = [];
    for await (const [name, handle] of directory.entries()) {
      const path = prefix + name;
      if (handle.kind === 'directory') files.push(...await listOPFS(handle, path + '/'));
      else { const file = await handle.getFile(); files.push({ path, bytes: file.size }); }
    }
    return files;
  }
  async function inspect() {
    const directory = await navigator.storage.getDirectory();
    const files = [];
    for (const name of DIRECTORIES) {
      try { files.push(...await listOPFS(await directory.getDirectoryHandle(name), name + '/')); }
      catch (error) { if (error.name !== 'NotFoundError') throw error; }
    }
    const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    const cacheNames = await caches.keys();
    const estimate = await navigator.storage.estimate();
    return { opfs: files, opfsBytes: files.reduce((sum, f) => sum + f.bytes, 0),
      indexedDB: databases.filter(db => owned(db.name || '')).map(db => db.name),
      cacheStorage: cacheNames.filter(owned), browserOriginUsageBytes: estimate.usage || 0,
      browserOriginUsageDetails: estimate.usageDetails || {} };
  }
  async function removeLegacyStores() {
    const directory = await navigator.storage.getDirectory();
    try { await directory.removeEntry('ytbm-stems-segments', { recursive: true }); }
    catch (error) { if (error.name !== 'NotFoundError') throw error; }
    if (typeof indexedDB.databases === 'function') {
      for (const db of await indexedDB.databases()) if (owned(db.name || '')) {
        await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase(db.name);
          request.onsuccess = resolve;
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error(`Close other extension pages using ${db.name}, then retry removal`));
        });
      }
    }
    for (const name of await caches.keys()) if (owned(name)) await caches.delete(name);
  }
  root.YTBMResourceStorage = { inspect, removeLegacyStores, DIRECTORIES, owned };
  if (typeof module !== 'undefined') module.exports = root.YTBMResourceStorage;
})(globalThis);
