/* YTBM Stems inference worker — own implementation.
 * Does NOT copy any proprietary engine. Uses public MIT components:
 *  - ONNX Runtime Web (MIT, vendored separately in vendor/)
 *  - StemSplit HT-Demucs ONNX export (MIT), Meta HT-Demucs model (MIT).
 * Contract with content.js via postMessage:
 *  in:  {type:'init', modelUrl, modelBytes, modelSha256, wasmPaths}
 *  out: {type:'ready'} | {type:'progress', f} | {type:'error', error}
 *  in:  {type:'separate', id, mix: Float32Array(2*SEG)} [transfer]
 *  out: {type:'stems', id, data: Float32Array(4*2*SEG)} [transfer]
 * Only downloaded, checksum-verified model bytes are accepted.
 */
const SEG = 343980; // 7.8 s @ 44.1 kHz
const STEMS_LENGTH = 4 * 2 * SEG;
let ortRuntime = null;
let session = null;
let expectedSha256 = null;

async function sha256Hex(data) {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function openModelCache() {
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle('ytbm-stems');
}

async function readCachedFile(dir, name, spec) {
  try {
    const handle = await dir.getFileHandle(name);
    const file = await handle.getFile();
    if (file.size !== spec.bytes) return null;
    const buf = new Uint8Array(await file.arrayBuffer());
    if ((await sha256Hex(buf)) !== spec.sha256) return null;
    return buf.buffer;
  } catch { return null; }
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  try {
    if (msg.type === 'init') {
      expectedSha256 = msg.modelSha256 || null;
      postMessage({ type: 'progress', f: 0 });
      const dir = await openModelCache();
      const buffer = await readCachedFile(dir, 'htdemucs-fp16.onnx', { bytes: msg.modelBytes, sha256: msg.modelSha256 });
      if (!buffer) throw new Error('Model missing or invalid — install the stems package first');
      postMessage({ type: 'progress', f: 0.95 });
      if (!msg.wasmPaths || !msg.wasmPaths.ortMin || !msg.wasmPaths.dir) {
        throw new Error('runtime-missing (vendored ORT paths not provided)');
      }
      importScripts(msg.wasmPaths.ortMin);
       ortRuntime = self.ort;
       if (!ortRuntime) throw new Error('ORT failed to load from vendored bundle');
       ortRuntime.env.wasm.wasmPaths = msg.wasmPaths.dir;
       const threads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
       ortRuntime.env.wasm.numThreads = threads;
       ortRuntime.env.wasm.proxy = false;
       ortRuntime.env.logLevel = 'error';
      // Memory-safe session options: the 166 MB graph overflows the wasm
      // heap with default optimizer/arena settings.
      const SAFE_OPTS = {
        graphOptimizationLevel: 'disabled',
        enableCpuMemArena: false,
        enableMemPattern: false,
        logSeverityLevel: 3,
      };
      // Try WebGPU first (real-time capable), fall back to WASM.
      const attempts = msg.ep === 'wasm' ? ['wasm'] : ['webgpu', 'wasm'];
      const errors = [];
      let activeEp = null;
      for (const ep of attempts) {
        try {
          session = await ortRuntime.InferenceSession.create(new Uint8Array(buffer), {
            executionProviders: [ep],
            ...SAFE_OPTS,
          });
          activeEp = ep;
          break;
        } catch (err) {
          errors.push(ep + ': ' + (err && err.message ? err.message : err));
          session = null;
        }
      }
      if (!session) throw new Error('No execution provider worked: ' + errors.join(' | '));
       postMessage({ type: 'ready', ep: activeEp, providerErrors: errors, threads, isolated: !!self.crossOriginIsolated });
      return;
    }
    if (msg.type === 'separate') {
      if (!session) { postMessage({ type: 'error', id: msg.id, error: 'model not ready' }); return; }
      const mix = msg.mix;
      const startedAt = performance.now();
      if (!(mix instanceof Float32Array) || mix.length !== 2 * SEG) throw new Error('Invalid model input');
      const input = new ortRuntime.Tensor('float32', mix, [1, 2, SEG]);
      const feeds = {};
      feeds[session.inputNames[0]] = input;
      let results;
      try {
      results = await session.run(feeds);
      const output = results[session.outputNames[0]];
      // With the WebGPU EP the tensor may still live on the GPU.
      const outData =
        (output.location && output.location !== 'cpu' && typeof output.getData === 'function')
          ? await output.getData()
          : output.data;
      if (!outData || outData.length < STEMS_LENGTH) {
        throw new Error('Short model output: got ' + (outData && outData.length));
      }
      // Copy into a fresh buffer so the transfer never touches memory that
      // onnxruntime may reuse for the next run.
      const data = new Float32Array(STEMS_LENGTH);
      data.set(outData.subarray(0, STEMS_LENGTH));
      for (const sample of data) if (!Number.isFinite(sample)) throw new Error('Model produced invalid audio samples');
      postMessage({ type: 'stems', id: msg.id, data, inferenceMs: performance.now() - startedAt }, [data.buffer]);
      } finally {
        input.dispose();
        for (const tensor of Object.values(results || {})) tensor.dispose();
      }
      return;
    }
    if (msg.type === 'clear-cache') {
      try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry('ytbm-stems-segments', { recursive: true });
      } catch {}
      postMessage({ type: 'cache-cleared' });
      return;
    }
  } catch (err) {
    postMessage({ type: 'error', id: msg.id, error: String((err && err.message) || err) });
  }
};
