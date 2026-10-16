const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionDownloads, safeName } = require('../addons/stems/session-downloads.js');
function storage() {
  const missing = () => new DOMException('Not found', 'NotFoundError');
  function directory() {
    const children = new Map();
    return { children, kind: 'directory',
      async getDirectoryHandle(name, options = {}) {
        if (!children.has(name)) { if (!options.create) throw missing(); children.set(name, directory()); }
        return children.get(name);
      },
      async getFileHandle(name, options = {}) {
        if (!children.has(name)) {
          if (!options.create) throw missing();
          const file = { kind: 'file', data: new Blob(), async getFile() { return this.data; }, async createWritable() {
            let value; return { async write(data) { value = new Blob([data]); }, async close() { file.data = value; }, async abort() {} };
          } }; children.set(name, file);
        }
        return children.get(name);
      },
      async removeEntry(name) { if (!children.delete(name)) throw missing(); },
      async *entries() { yield* children; },
    };
  }
  const root = directory();
  return { root, getDirectory: async () => root };
}
test('video folder names cannot escape their owned directory and retain original title in metadata', async () => {
  const fs = storage(), downloads = new SessionDownloads(fs);
  const p = await downloads.save('tab1/track/a', { videoId: '9eoABXv4lGg', title: '../../My / song: café', complete: true }, new Uint8Array([1, 2, 3]));
  assert.match(p, /^ytbm-stems\/videos\/9eoABXv4lGg-/); assert.ok(!p.includes('..'));
  const folder = (await (await fs.root.getDirectoryHandle('ytbm-stems')).getDirectoryHandle('videos')).children.values().next().value;
  const meta = JSON.parse(await (await (await folder.getFileHandle('video.json')).getFile()).text());
  assert.equal(meta.title, '../../My / song: café'); assert.equal(meta.temporary, true); assert.equal(meta.sourceFile, 'source.audio');
  assert.equal((await (await folder.getFileHandle('source.audio')).getFile()).size, 3);
  await downloads.clearAll();
  await assert.rejects((await fs.root.getDirectoryHandle('ytbm-stems')).getDirectoryHandle('videos'), { name: 'NotFoundError' });
});
test('a buffered prefix stays partial until marked complete; closing one frame preserves another', async () => {
  const fs = storage(), downloads = new SessionDownloads(fs);
  const first = await downloads.save('frame1/buffer/a', { videoId: 'a', title: 'Song', complete: false }, new Uint8Array([1]));
  const second = await downloads.save('frame2/track/b', { videoId: 'b', title: 'Song', complete: true }, new Uint8Array([2]));
  assert.notEqual(first, second);
  const updated = await downloads.save('frame1/buffer/a', { videoId: 'a', title: 'Song', complete: true }, new Uint8Array([1, 2]));
  assert.equal(first, updated);
  const parent = await (await fs.root.getDirectoryHandle('ytbm-stems')).getDirectoryHandle('videos');
  const folder = await parent.getDirectoryHandle(downloads.entries.get('frame1/buffer/a').name);
  await assert.rejects(folder.getFileHandle('source.audio.part'), { name: 'NotFoundError' });
  await downloads.clearFrame('frame1'); assert.equal(downloads.entries.size, 1); assert.equal(parent.children.size, 1);
  await downloads.clearFrame('frame1'); await downloads.clearAll(); assert.equal(downloads.entries.size, 0);
});
test('startup removes stale temporary downloads without deleting the installed model or saved exports', async () => {
  const fs = storage(), downloads = new SessionDownloads(fs);
  await downloads.save('frame/track/a', { title: 'Temporary' }, new Uint8Array([1]));
  const stems = await fs.root.getDirectoryHandle('ytbm-stems');
  await stems.getFileHandle('htdemucs-fp16.onnx', { create: true });
  await fs.root.getDirectoryHandle('user-saved-audio', { create: true });
  const restarted = new SessionDownloads(fs); await restarted.clearAll();
  assert.ok(await stems.getFileHandle('htdemucs-fp16.onnx'));
  assert.ok(await fs.root.getDirectoryHandle('user-saved-audio'));
  await assert.rejects(stems.getDirectoryHandle('videos'), { name: 'NotFoundError' });
  assert.ok(safeName('///') === '___');
});
