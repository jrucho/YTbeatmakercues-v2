/* Opt-in real Chromium audit. Uses an external Playwright install, never adds
 * a production dependency. Only operates on the supplied disposable profile.
 * YTBM_PLAYWRIGHT, YTBM_CHROME, YTBM_PROFILE, YTBM_EXTENSION_ROOT,
 * YTBM_MODEL_FIXTURE, YTBM_TLS_KEY, YTBM_TLS_CERT, YTBM_EVIDENCE_DIR required.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { chromium } = require(process.env.YTBM_PLAYWRIGHT);
const root = process.env.YTBM_EXTENSION_ROOT || path.resolve(__dirname, '..');
const profile = process.env.YTBM_PROFILE;
if (!profile?.includes('/T/opencode/') || !path.basename(profile).startsWith('stems-audit-')) throw new Error('Use a dedicated stems-audit-* test profile under the approved temp directory');
const report = { startedAt: new Date().toISOString(), browser: null, tests: [], snapshots: [], modelNetwork: [], limitations: [] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const N = 343980, SR = 44100;
let speech = null;
if (process.env.YTBM_VOICE_FIXTURE) {
  const file = fs.readFileSync(process.env.YTBM_VOICE_FIXTURE);
  for (let p = 12; p + 8 <= file.length;) {
    const length = file.readUInt32LE(p + 4);
    if (file.toString('ascii', p, p + 4) === 'data') {
      speech = new Float32Array(length / 2);
      for (let i = 0; i < speech.length; i++) speech[i] = file.readInt16LE(p + 8 + i * 2) / 32768;
      break;
    }
    p += 8 + length + length % 2;
  }
}
function wav(seconds, silent = false) {
  const frames = Math.round(seconds * SR), data = Buffer.alloc(44 + frames * 4);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
  data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const t = i / SR;
    const beat = t % 0.5;
    const voice = (speech?.[i % N] || 0) * 0.7;
    const bass = 0.075 * Math.sin(t * Math.PI * 2 * 110);
    const kick = 0.18 * Math.sin(2 * Math.PI * (55 * beat + 10 * (1 - Math.exp(-beat * 25)))) * Math.exp(-beat * 22);
    const noise = Math.sin(i * 78.233) * Math.sin(i * 12.9898);
    const snare = noise * Math.exp(-((t + 0.5) % 1) * 35) * 0.16;
    const keyboard = [261.63, 329.63, 392].reduce((s, f) => s + Math.sin(t * 2 * Math.PI * f) + 0.25 * Math.sin(t * 4 * Math.PI * f), 0) * 0.022 * Math.exp(-(t % 1) * 3);
    const value = silent ? 0 : speech ? Math.round(Math.max(-0.99, Math.min(0.99, voice + bass + kick + snare + keyboard)) * 32767)
      : Math.round(5000 * Math.sin(t * Math.PI * 2 * 220) + 2500 * Math.sin(t * Math.PI * 2 * 110));
    data.writeInt16LE(value, 44 + i * 4); data.writeInt16LE(value, 46 + i * 4);
  }
  return data;
}
const samples = { normal: wav(7.8), short: wav(0.5), silent: wav(7.8, true), long: wav(30), overlimit: wav(0.5), corrupt: Buffer.from('broken wav input') };
let slowModel = false, recordedWebM = null;
const model = fs.readFileSync(process.env.YTBM_MODEL_FIXTURE);
assert.equal(model.length, 165612636);
const server = https.createServer({ key: fs.readFileSync(process.env.YTBM_TLS_KEY), cert: fs.readFileSync(process.env.YTBM_TLS_CERT) }, (req, res) => {
  if (req.url.startsWith('/sample.wav')) {
    const kind = new URL(req.url, 'https://fixture').searchParams.get('kind') || 'normal';
    const audio = samples[kind]; res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': audio.length }); return res.end(audio);
  }
  const range = (req.headers.range || '').match(/bytes=(\d+)-(\d*)/);
  const from = range ? Number(range[1]) : 0, end = Math.min(model.length - 1, range?.[2] ? Number(range[2]) : model.length - 1);
  const body = model.subarray(from, end + 1);
  res.writeHead(206, { 'content-type': 'application/octet-stream', 'content-length': body.length, 'content-range': `bytes ${from}-${end}/${model.length}` });
  if (!slowModel) return res.end(body);
  let offset = 0;
  const timer = setInterval(() => { const next = Math.min(body.length, offset + 32768); res.write(body.subarray(offset, next)); offset = next; if (offset === body.length) { clearInterval(timer); res.end(); } }, 50);
  res.on('close', () => clearInterval(timer));
});
let context, control, env, browserCDP, offscreen, serial = 0;
async function start() {
  context = await chromium.launchPersistentContext(profile, { executablePath: process.env.YTBM_CHROME,
    headless: true, args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--autoplay-policy=no-user-gesture-required',
      '--ignore-certificate-errors', '--no-proxy-server', '--host-resolver-rules=MAP rr1---sn-test.googlevideo.com 127.0.0.1'] });
  report.browser = context.browser().version();
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${new URL(sw.url()).hostname}`;
  control = await context.newPage(); await control.goto(origin + '/options.html');
  browserCDP = await context.browser().newBrowserCDPSession(); offscreen = null;
  await context.route('https://www.youtube.com/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/audit.webm') return route.fulfill({ contentType: 'audio/webm', body: recordedWebM });
    if (url.pathname === '/sample.wav') {
      const kind = url.searchParams.get('kind') || 'normal';
      return route.fulfill({ contentType: 'audio/wav', body: samples[kind] });
    }
    const kind = url.searchParams.get('kind') || 'normal';
    if (kind === 'mse') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><div id="movie_player"><video class="html5-main-video" controls></video></div><script>
      (async()=>{const v=document.querySelector('video'),m=new MediaSource();v.src=URL.createObjectURL(m);await new Promise(r=>m.addEventListener('sourceopen',r,{once:true}));const s=m.addSourceBuffer('audio/webm;codecs=opus');m.duration=8.2;const data=await(await fetch('/audit.webm')).arrayBuffer();s.appendBuffer(data);await new Promise(r=>s.addEventListener('updateend',r,{once:true}));m.endOfStream();})();
    </script></body></html>` });
    const seconds = kind === 'short' ? 0.5 : kind === 'overlimit' ? 601 : kind === 'long' ? 30 : 7.8;
    const metadata = { videoDetails: { videoId: url.searchParams.get('v'), lengthSeconds: String(seconds) }, streamingData: { adaptiveFormats: [
      { mimeType: 'audio/wav', url: `https://rr1---sn-test.googlevideo.com:${server.address().port}/sample.wav?kind=${kind}` },
    ] } };
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><script>window.ytInitialPlayerResponse=${JSON.stringify(metadata)}</script><div id="movie_player"><video class="html5-main-video" controls preload="auto" src="https://www.youtube.com/sample.wav?kind=${kind}"></video></div></body></html>` });
  });
  return origin;
}
async function video(kind = 'normal') {
  const page = await context.newPage(), cdp = await context.newCDPSession(page);
  let world;
  cdp.on('Runtime.executionContextCreated', ({ context }) => { if (context.origin.startsWith('chrome-extension://')) world = context.id; });
  await cdp.send('Runtime.enable');
  await page.goto(`https://www.youtube.com/watch?v=audit-${++serial}&kind=${kind}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const run = async expression => {
    const result = await cdp.send('Runtime.evaluate', { expression, contextId: world, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await wait(async () => { try { return !!await run('window.__ytbmStemDiag'); } catch { return false; } });
  await run('window.__send=msg=>new Promise(resolve=>chrome.runtime.sendMessage(msg,resolve))');
  return { page, cdp, run, world: () => world };
}
async function wait(condition, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await condition(); if (value) return value; await sleep(100); }
  throw new Error('Timed out waiting for expected state');
}
async function inspect() {
  return control.evaluate(() => chrome.runtime.sendMessage({ type: 'ytbm-stems-storage-inspect' }));
}
async function snapshot(label) {
  const data = await inspect(); assert.equal(data.ok, true);
  report.snapshots.push({ label, ...data }); console.log('STORAGE', label, data.storage);
  return data;
}
async function hostEval(expression) {
  if (!offscreen) {
    const target = (await browserCDP.send('Target.getTargets')).targetInfos.find(t => t.url.endsWith('/addons/stems/offscreen.html'));
    assert.ok(target);
    const attached = await browserCDP.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
    const pending = new Map(); let next = 0;
    browserCDP.on('Target.receivedMessageFromTarget', event => {
      if (event.sessionId !== attached.sessionId) return;
      const message = JSON.parse(event.message), request = pending.get(message.id);
      if (request) { pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result); }
    });
    offscreen = expr => new Promise((resolve, reject) => {
      const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(new Error('Offscreen inspection timed out')); }, 120000);
      pending.set(id, { resolve, reject, timer });
      browserCDP.send('Target.sendMessageToTarget', { sessionId: attached.sessionId, message: JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }) }).catch(reject);
    });
  }
  const result = await offscreen(expression);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function useFixtureModel() {
  await inspect();
  await hostEval(`modelStore.spec={...modelStore.spec,url:'https://rr1---sn-test.googlevideo.com:${server.address().port}/model.onnx'}`);
}
async function install(e = env) {
  const response = await e.run('__send({type:"ytbm-stems-download-start"})'); assert.equal(response.ok, true);
  await wait(async () => { const s = await inspect(); if (s.lastDownloadError && !s.downloading) throw new Error(s.lastDownloadError); return s.model.present && !s.downloading; }, 240000);
  await e.page.reload(); await sleep(750);
  await e.run('window.__send=msg=>new Promise(resolve=>chrome.runtime.sendMessage(msg,resolve))');
}
async function remove(e = env) {
  const result = await e.run('__send({type:"ytbm-stems-model-remove"})');
  assert.equal(result.verified, true); assert.equal(result.after.opfsBytes, 0);
  assert.deepEqual(result.after.indexedDB, []); assert.deepEqual(result.after.cacheStorage, []);
  return result;
}
async function hooks(e = env) {
  await e.cdp.send('Debugger.enable');
  const object = (await e.cdp.send('Runtime.evaluate', { expression: '__ytbmStemDiag', contextId: e.world() })).result.objectId;
  const { breakpointId } = await e.cdp.send('Debugger.setBreakpointOnFunctionCall', { objectId: object });
  const paused = new Promise(resolve => e.cdp.once('Debugger.paused', resolve));
  const trigger = e.cdp.send('Runtime.evaluate', { expression: '__ytbmStemDiag()', contextId: e.world() });
  const event = await paused;
  await e.cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: event.callFrames[0].callFrameId,
    expression: `window.__test={getStemState,getStemAISlice,stopStemAnalysis,jumpToCue,stemAiTick,refreshStemsUI,audioContext,stemBusOutput,requestStemAnalysis,getVideoElement,videoSpeedStretchNode,
      setMode:(mode,rate,tune=0)=>{pitchTarget='video';speedOnlyMode=mode!=='Pitch';speedHDMode=mode==='Speed HD';pitchSemitoneMode=false;updatePitch((rate-1)*100);if(speedHDMode)updateSpeedHDTune(tune);},
      stretchReady:()=>!!videoSpeedStretchNode}` });
  await e.cdp.send('Debugger.removeBreakpoint', { breakpointId }); await e.cdp.send('Debugger.resume'); await trigger;
}
async function separated(e = env) {
  return wait(async () => { const s = await e.run('__ytbmStemDiag()'); if (s.aiError) throw new Error(s.aiError); return s.learnedSegments ? s : false; });
}
async function scenario(name, fn) {
  try { const details = await fn(); report.tests.push({ name, result: 'PASS', details }); console.log('PASS', name); }
  catch (error) { report.tests.push({ name, result: 'FAIL', error: error.message }); console.error('FAIL', name, error); throw error; }
}
async function playbackButtons(e, label) {
  await hooks(e);
  await e.run(`window.__measure=async()=>{const {audioContext:c,stemBusOutput:b}=__test;const a=c.createAnalyser();a.fftSize=2048;b.connect(a);let energy=0;const d=new Float32Array(2048);for(let i=0;i<24;i++){a.getFloatTimeDomainData(d);energy+=d.reduce((s,x)=>s+x*x,0);await new Promise(r=>setTimeout(r,15));}b.disconnect(a);return Math.sqrt(energy/(24*d.length))}`);
  const keys = ['vocals', 'drums', 'bass', 'other'];
  const measure = async () => {
    await e.run('__test.jumpToCue(1)');
    await e.page.locator('video.html5-main-video').first().evaluate(v => v.play());
    await sleep(250);
    return { rms: await e.run('__measure()'), path: await e.run('__ytbmStemDiag().pathMix') };
  };
  const original = await measure(); assert.ok(original.rms > 0.01);
  const singles = {};
  for (const key of keys) {
    assert.equal(await e.page.locator(`[data-stem="${key}"]`).isEnabled(), true);
    await e.page.locator(`[data-stem="${key}"]`).click(); singles[key] = await measure();
    assert.equal(singles[key].path, 'ai');
    assert.ok(singles[key].rms > 0.0001, `muting ${key} must not silence all other instruments`);
    await e.page.locator(`[data-stem="${key}"]`).click();
  }
  for (const key of ['vocals','drums','bass']) await e.page.locator(`[data-stem="${key}"]`).click();
  const onlyOther = await measure(); assert.equal(onlyOther.path, 'ai');
  assert.ok(onlyOther.rms < original.rms * 0.7, 'three mutes must not leave the original full mix playing');
  await e.page.locator('[data-stem="other"]').click(); await sleep(100);
  assert.equal(await e.run('__measure()'), 0);
  for (const key of keys) await e.page.locator(`[data-stem="${key}"]`).click();
  const restored = await measure(); assert.ok(restored.rms > 0.01); assert.equal(restored.path, 'live');
  await e.page.locator('[data-stem="vocals"]').click({ modifiers: ['Shift'] });
  const solo = await measure(); assert.equal(solo.path, 'ai'); assert.ok(solo.rms > 0.001);
  await e.page.locator('[data-stem="vocals"]').click({ modifiers: ['Shift'] });
  await e.page.locator('video.html5-main-video').first().evaluate(v => v.pause());
  const result = { original, singles, onlyOther, restored, solo };
  console.log('MEASURED BUTTONS', label, result);
  return result;
}
async function nativePlayerTest() {
  recordedWebM = Buffer.from(await control.evaluate(async b64 => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const c = new AudioContext({ sampleRate: 44100 }); await c.resume();
    const buffer = await c.decodeAudioData(bytes.buffer), source = c.createBufferSource(), destination = c.createMediaStreamDestination();
    source.buffer = buffer; source.connect(destination);
    const chunks = [], recorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus' });
    recorder.ondataavailable = e => chunks.push(e.data);
    const ended = new Promise(resolve => recorder.onstop = resolve);
    recorder.start(); source.start(); await new Promise(resolve => source.onended = resolve); recorder.stop(); await ended;
    const data = new Uint8Array(await new Blob(chunks).arrayBuffer());
    source.disconnect(); destination.stream.getTracks().forEach(t => t.stop()); await c.close();
    let binary = ''; for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
    return btoa(binary);
  }, samples.normal.toString('base64')), 'base64');
  const e = await video('mse'); await separated(e);
  await wait(async () => { const s = await e.run('__ytbmStemDiag()'); if (s.bufferedError) console.log('BUFFER ERROR', s.bufferedError); return s.analysisMode === 'buffered' && s.learnedSegments >= s.trackSegments; });
  const result = await playbackButtons(e, 'native player WebM'); await e.page.close(); return result;
}
async function playbackRates(e, label) {
  await hooks(e);
  await wait(() => e.run('__test.stretchReady()'));
  for (const key of ['vocals','drums','other']) await e.page.locator(`[data-stem="${key}"]`).click();
  const metrics = [];
  for (const [mode, rate, tune, expected] of [
    ['Pitch', 0.5, 0, 55], ['Pitch', 1.5, 0, 165],
    ['Speed', 0.5, 0, 110], ['Speed', 1.5, 0, 110],
    ['Speed HD', 0.5, 0, 110], ['Speed HD', 1.5, 0, 110],
    ['Speed HD', 0.5, 3, 110 * 2 ** (3 / 12)],
  ]) {
    await e.run(`__test.setMode(${JSON.stringify(mode)},${rate},${tune})`);
    await e.run('__test.jumpToCue(1)');
    await e.page.locator('video.html5-main-video').first().evaluate(v => v.play());
    await sleep(450);
    const result = await e.run(`(async()=>{
      const c=__test.audioContext,node=__test.videoSpeedStretchNode.output,a=c.createAnalyser();a.fftSize=32768;
      node.connect(a);await new Promise(r=>setTimeout(r,850));const spectrum=new Float32Array(a.frequencyBinCount);a.getFloatFrequencyData(spectrum);node.disconnect(a);
      let peak=-Infinity,index=0;for(let i=Math.floor(35*a.fftSize/c.sampleRate);i<Math.ceil(210*a.fftSize/c.sampleRate);i++)if(spectrum[i]>peak){peak=spectrum[i];index=i;}
      return {frequency:index*c.sampleRate/a.fftSize,peak,path:__ytbmStemDiag().pathMix,rate:__test.getVideoElement().playbackRate,mutes:__test.getStemState().mutes};
    })()`);
    assert.equal(result.path, 'ai'); assert.equal(result.rate, rate);
    assert.ok(Math.abs(result.frequency - expected) < 5, `${label} ${mode} at ${rate}x should be ${expected}Hz, got ${result.frequency}`);
    assert.equal(result.mutes.vocals, true); assert.equal(result.mutes.bass, false);
    metrics.push({ mode, rate, tune, expected, ...result });
    await e.page.locator('video.html5-main-video').first().evaluate(v => v.pause());
  }
  await e.run('__test.setMode("Pitch",1)');
  for (const key of ['vocals','drums','other']) await e.page.locator(`[data-stem="${key}"]`).click();
  console.log('PITCH/STRETCH', label, metrics);
  return metrics;
}
async function cachedCueReadiness(e) {
  await hooks(e);
  await e.run('__test.setMode("Pitch",1)');
  await e.page.locator('video.html5-main-video').first().evaluate(v => v.play());
  await e.page.locator('[data-stem="vocals"]').click();
  await sleep(250);
  const metrics = await e.run(`(async()=>{
    const ai=__test.getStemState().ai,v=__test.getVideoElement(),c=__test.audioContext;
    clearInterval(ai.timer);ai.timer=null;
    const results=[];
    try {
      for(const target of [0.5,2,4,1]) {
        const started=performance.now();
        const ready=new Promise((resolve,reject)=>{
          const timeout=setTimeout(()=>{v.removeEventListener('seeked',onReady);reject(new Error('Cue never became ready'));},2000);
          const onReady=()=>setTimeout(()=>{
            clearTimeout(timeout);v.removeEventListener('seeked',onReady);
            const queued=ai.sources.filter(s=>s.generation===ai.generation);
            resolve({target,seekMs:performance.now()-started,path:ai.pathMix,queued:queued.length,leadMs:queued.length?(queued[0].startAt-c.currentTime)*1000:null,readyState:v.readyState,seeking:v.seeking,paused:v.paused});
          },0);
          v.addEventListener('seeked',onReady);
        });
        __test.jumpToCue(target);results.push(await ready);
        await new Promise(r=>setTimeout(r,35));
      }
      return results;
    } finally {ai.timer=setInterval(__test.stemAiTick,150);}
  })()`);
  console.log('CACHED CUE READINESS (polling disabled)', metrics);
  for (const sample of metrics) {
    assert.equal(sample.path, 'ai', 'ready cached cue must switch to stems without the periodic timer');
    assert.ok(sample.queued > 0, 'ready event must queue actual stem sources');
    assert.ok(sample.leadMs <= 6 && sample.leadMs >= -10, 'ready cue must use the existing 5 ms scheduling lead');
  }
  assert.ok(await e.run('__measure()') > 0.0001);
  await e.page.locator('[data-stem="vocals"]').click();
  await e.page.locator('video.html5-main-video').first().evaluate(v => v.pause());
  return metrics;
}
async function darkTooltips(e) {
  const cue = e.page.locator('.ytbm-minimal-bar button').filter({ hasText: 'Cues' }).first();
  await cue.hover();
  const bubble = e.page.locator('#ytbm-tooltip');
  await bubble.waitFor({ state: 'visible' });
  assert.match(await bubble.textContent(), /cues/i);
  assert.equal(await bubble.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(16, 16, 16)');
  assert.equal(await cue.getAttribute('title'), null);
  await e.page.locator('[data-stem="vocals"]').hover();
  assert.match(await bubble.textContent(), /^Vocals · on\n/);
  assert.ok((await bubble.textContent()).length < 100);
  assert.doesNotMatch(await bubble.textContent(), /Buffered song|play at 1×/);
  await e.page.evaluate(() => {
    const button=document.createElement('button');button.id='host-title-test';button.title='Host page title';button.textContent='Host control';
    document.body.appendChild(button);
  });
  await e.page.locator('#host-title-test').hover();
  assert.equal(await e.page.locator('#host-title-test').getAttribute('title'), 'Host page title');
  assert.equal(await bubble.isVisible(), false);
  await cue.focus();
  assert.equal(await bubble.isVisible(), true);
  assert.match(await cue.getAttribute('aria-describedby'), /ytbm-tooltip/);
  await e.page.keyboard.press('Escape');
  assert.equal(await bubble.isVisible(), false);
  assert.equal(await cue.getAttribute('aria-describedby'), null);
  await e.run(`(()=>{const st=__test.getStemState();const previous={installed:st.installed,downloading:st.downloading,downloadProgress:st.downloadProgress};
    st.installed=false;st.downloading=true;st.downloadProgress=.42;__test.refreshStemsUI();
    window.__downloadLabel=document.querySelector('.ytbm-stems-progress-label').textContent;
    Object.assign(st,previous);__test.refreshStemsUI();})()`);
  assert.equal(await e.run('__downloadLabel'), 'Downloading… 42%');
  await e.page.locator('#host-title-test').evaluate(el => el.remove());
  return { background: 'rgb(16, 16, 16)', download: 'Downloading… 42%', nativeHostTitlePreserved: true, keyboardAccessible: true };
}
async function liveYouTubeTest() {
  await context.unroute('https://www.youtube.com/**');
  const page = await context.newPage(), cdp = await context.newCDPSession(page);
  let world;
  cdp.on('Runtime.executionContextCreated', ({ context }) => { if (context.origin.startsWith('chrome-extension://')) world = context.id; });
  await cdp.send('Runtime.enable');
  await page.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3500);
  // Consent intentionally pauses YouTube; respect the page's reject option
  // instead of misdiagnosing a paused player as failed stem scheduling.
  for (const frame of page.frames()) {
    const reject = frame.getByRole('button', { name: /refuser|reject|refuse/i }).first();
    if (await reject.count()) { await reject.click({ timeout: 10000 }); await sleep(3000); break; }
  }
  const run = async expression => {
    const result = await cdp.send('Runtime.evaluate', { expression, contextId: world, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const e = { page, cdp, run, world: () => world };
  await page.evaluate(() => document.getElementById('movie_player')?.playVideo?.());
  await page.waitForFunction(() => { const v = document.querySelector('video.html5-main-video'); return v?.buffered.length && v.buffered.end(v.buffered.length - 1) > 7.8; }, { timeout: 30000 });
  await page.evaluate(() => { const p = document.getElementById('movie_player'); p.seekTo(1, true); p.pauseVideo(); });
  await wait(async () => {
    try { const s = await run('__ytbmStemDiag()'); if (s.aiError) throw new Error(s.aiError);
      return s.analysisMode === 'buffered' && s.learnedSegments > 0 && s.hasCurrentCoverage;
    } catch (error) { if (/not defined|context/.test(error.message)) return false; throw error; }
    });
    const state = await run('__ytbmStemDiag()');
    assert.equal(state.bufferedReady, true);
    const measured = await playbackButtons(e, 'real YouTube page');
    const rateStates = [];
    if(process.env.YTBM_RATE_TESTS) {
      await hooks(e);
      for(const [mode,rate,tune] of [['Pitch',0.5,0],['Pitch',1.5,0],['Speed',0.5,0],['Speed HD',1.5,3]]) {
        await e.run(`__test.setMode(${JSON.stringify(mode)},${rate},${tune})`);
        await e.run('__test.jumpToCue(1)');
        await page.locator('video.html5-main-video').first().evaluate(v=>v.play());
        await sleep(350);
        await page.locator('[data-stem="vocals"]').click();
        await sleep(350);
        const sample=await run('__ytbmStemDiag()');
        assert.equal(sample.pathMix,'ai');
        rateStates.push({mode,rate,tune,path:sample.pathMix});
        await page.locator('[data-stem="vocals"]').click();
        await page.locator('video.html5-main-video').first().evaluate(v=>v.pause());
      }
      console.log('LIVE YOUTUBE RATES',rateStates);
    }
    await page.close();
    return { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', state, measured, rateStates };
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = await start(); env = await video();
    if (!process.env.YTBM_RELEASE_ONLY && (await inspect()).model.present) await remove();
    const existingModel = (await inspect()).model.present;
    if (process.env.YTBM_LOCAL_MODEL) await useFixtureModel();
    await snapshot(existingModel ? 'existing verified model baseline' : 'fresh baseline');
    await scenario(existingModel ? 'reuse installed model and separate without another download' : 'fresh remote installation and first separation', async () => {
      await install(); const state = await separated(); await hooks();
      const slice = await env.run('(()=>{const s=__test.getStemAISlice("vocals");return {frames:s?.left.length,finite:s?.left.every(Number.isFinite)}})()');
      assert.equal(slice.frames, N); assert.equal(slice.finite, true);
      await snapshot('installed and separated'); return { state, slice };
    });
    if (process.env.YTBM_RELEASE_ONLY) {
      await scenario('all buttons and cues on actual direct-source audio', () => playbackButtons(env, 'direct source'));
      await scenario('cached cues schedule on decoder readiness with the 150 ms poll disabled', () => cachedCueReadiness(env));
      await scenario('shared black tooltips, compact stem/download text and untouched host titles', () => darkTooltips(env));
      if(process.env.YTBM_RATE_TESTS) await scenario('stem playback follows Pitch, Speed and Speed HD with preserved mute state', () => playbackRates(env, 'direct source'));
      await scenario('player element replacement does not bind the hidden cue deck or bypass stems', async () => {
        await env.page.locator('video.html5-main-video').first().evaluate(video => {
          const next = video.cloneNode(false), parent = video.parentNode;
          video.remove(); parent.appendChild(next);
        });
        await sleep(500);
        const result = await playbackButtons(env, 'replaced native player');
        assert.equal(await env.run('__test.getVideoElement().classList.contains("ytbm-cue-deck")'), false);
        assert.equal(await env.run('__test.getVideoElement()._audioConnected'), 'two-deck');
        return result;
      });
      await scenario('all buttons and cues on native MediaSource audio with no song URL', nativePlayerTest);
      if (process.env.YTBM_LIVE_YOUTUBE) await scenario('all buttons and cues on a real YouTube page', liveYouTubeTest);
      const ready = await snapshot('release playback verified');
      if (process.env.YTBM_DOWNLOADS_TESTS) await scenario('named temporary source download files are reclaimed when the last video closes', async () => {
        assert.ok(ready.temporaryDownloads?.some(entry => entry.path.startsWith('ytbm-stems/videos/')));
        assert.ok(ready.storage.opfs.some(file => file.path.startsWith('ytbm-stems/videos/')));
        await env.page.close();
        await wait(async () => { const state = await inspect(); return !state.temporaryDownloads.length && !state.inferenceWorkers.length && !state.preloadedTracks.length && !state.bufferedAudio.length; });
        const closed = await snapshot('all video sessions closed; model retained');
        assert.equal(closed.storage.opfsBytes, 165612636);
        return closed.storage;
      });
      if (!process.env.YTBM_KEEP_MODEL) {
        if(env.page.isClosed()) env=await video();
        await remove();
      }
      return;
    }
    await scenario('pending single mute does not mute the entire original; ready mutes and cue playback', async () => {
      await env.run(`window.__rms=async()=>{const {audioContext:c,stemBusOutput:b}=__test;const a=c.createAnalyser();a.fftSize=2048;b.connect(a);await new Promise(r=>setTimeout(r,250));const d=new Float32Array(2048);a.getFloatTimeDomainData(d);b.disconnect(a);return Math.sqrt(d.reduce((s,x)=>s+x*x,0)/d.length)}`);
      await env.page.locator('video.html5-main-video').first().evaluate(v => { v.currentTime = 1; return v.play(); });
      const before = await env.run('__rms()'); assert.ok(before > 0.01);
      await env.page.locator('[data-stem="vocals"]').click(); await sleep(300);
      assert.equal(await env.run('__ytbmStemDiag().pathMix'), 'ai');
      await env.run('__test.jumpToCue(2)'); await sleep(400);
      assert.equal(await env.run('__ytbmStemDiag().pathMix'), 'ai');
      for (const key of ['drums', 'bass', 'other']) await env.page.locator(`[data-stem="${key}"]`).click();
      assert.equal(await env.run('__rms()'), 0);
      for (const key of ['vocals', 'drums', 'bass', 'other']) await env.page.locator(`[data-stem="${key}"]`).click();
      assert.ok(await env.run('__rms()') > 0.01); return { before };
    });
    await scenario('saved and unrelated resources preserved; feature stores reclaimed', async () => {
      await control.evaluate(async () => {
        await chrome.storage.local.set({ auditUserSettings: { keep: true } });
        const root = await navigator.storage.getDirectory(); const dir = await root.getDirectoryHandle('user-saved-audio', { create: true });
        const w = await (await dir.getFileHandle('keep.wav', { create: true })).createWritable(); await w.write(new Uint8Array([1, 2, 3])); await w.close();
        const temp = await root.getDirectoryHandle('ytbm-stems-segments', { create: true });
        const t = await (await temp.getFileHandle('old.tmp', { create: true })).createWritable(); await t.write('temporary'); await t.close();
        await (await caches.open('ytbm-stems-legacy')).put('https://fixture.test/temp', new Response('old weights'));
        await (await caches.open('unrelated-cache')).put('https://fixture.test/keep', new Response('keep'));
        await new Promise((resolve, reject) => { const r = indexedDB.open('ytbm-stems-legacy'); r.onsuccess = () => { r.result.close(); resolve(); }; r.onerror = reject; });
      });
      await snapshot('before removal with legacy fixtures'); const result = await remove(); await snapshot('after removal');
      const retained = await control.evaluate(async () => ({ setting: (await chrome.storage.local.get('auditUserSettings')).auditUserSettings,
        savedBytes: (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('user-saved-audio')).getFileHandle('keep.wav').then(h => h.getFile())).size,
        caches: await caches.keys() }));
      assert.equal(retained.savedBytes, 3); assert.equal(retained.setting.keep, true); assert.ok(retained.caches.includes('unrelated-cache'));
      return { before: result.before, after: result.after, retained };
    });
    await useFixtureModel();
    await scenario('install and remove without processing', async () => {
      await env.run('__send({type:"ytbm-stems-download-start"})');
      await wait(async () => (await inspect()).model.present);
      await remove(); return 'Verified full-size model fixture installed via real OPFS installer, then removed before engine init';
    });
    await scenario('partial install cancellation and repeated cleanup', async () => {
      slowModel = true; await env.run('__send({type:"ytbm-stems-download-start"})');
      await sleep(450);
      await env.run('__send({type:"ytbm-stems-download-cancel"})'); await remove(); await remove(); slowModel = false;
      return (await snapshot('after cancelled download')).storage;
    });
    await scenario('reinstall; short and silent samples; corrupt/long rejection; repeated jobs', async () => {
      await install(); await separated();
      for (const kind of ['short', 'silent', 'long']) {
        const e = await video(kind); await separated(e);
        if (kind === 'long') await wait(async () => { const s = await e.run('__ytbmStemDiag()'); return s.trackSegments && s.learnedSegments === s.trackSegments; });
        const state = await e.run('__ytbmStemDiag()'); await hooks(e);
        const result = await e.run('(()=>{const s=__test.getStemAISlice("vocals");return {frames:s?.left.length,peak:s?.left.reduce((p,x)=>Math.max(p,Math.abs(x)),0)}})()');
        assert.equal(result.frames, kind === 'short' ? SR / 2 : kind === 'long' ? SR * 30 : N);
        if (kind === 'silent') assert.ok(result.peak < 1e-4);
        report.tests.push({ name: `real model ${kind} audio`, result: 'PASS', details: { state, result } });
        await e.page.close();
      }
      for (const kind of ['corrupt', 'overlimit']) {
        const e = await video(kind); await sleep(2500);
        await e.run('__send({type:"ytbm-stems-track-preload",track:"reject",videoId:null,since:0})');
        const result = await e.run('__send({type:"ytbm-stems-track-open",track:"reject"})');
        assert.equal(result.ok, false); report.tests.push({ name: `reject ${kind} audio`, result: 'PASS', details: result });
        await e.page.close();
      }
    });
    await scenario('native MediaSource buffered audio is decoded, separated, and playable without a direct song URL', async () => {
      const base64 = samples.normal.toString('base64');
      const encoded = await control.evaluate(async b64 => {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const ctx = new AudioContext({ sampleRate: 44100 }); await ctx.resume();
        const buffer = await ctx.decodeAudioData(bytes.buffer), source = ctx.createBufferSource(), destination = ctx.createMediaStreamDestination();
        source.buffer = buffer; source.connect(destination);
        const recorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus' }), chunks = [];
        recorder.ondataavailable = e => chunks.push(e.data);
        const stopped = new Promise(resolve => recorder.onstop = resolve);
        recorder.start(); source.start(); await new Promise(resolve => source.onended = resolve);
        recorder.stop(); await stopped;
        const result = new Uint8Array(await new Blob(chunks).arrayBuffer());
        destination.stream.getTracks().forEach(track => track.stop()); source.disconnect(); destination.disconnect(); await ctx.close();
        let binary = ''; for (let i = 0; i < result.length; i += 8192) binary += String.fromCharCode(...result.subarray(i, i + 8192));
        return btoa(binary);
      }, base64);
      recordedWebM = Buffer.from(encoded, 'base64');
      const e = await video('mse'); const state = await separated(e);
      assert.equal(state.analysisMode, 'buffered'); assert.equal(state.bufferedReady, true);
      await e.page.locator('[data-stem="vocals"]').click();
      await e.page.locator('video.html5-main-video').first().evaluate(v => { v.currentTime = 1; return v.play(); });
      await sleep(600); assert.equal(await e.run('__ytbmStemDiag().pathMix'), 'ai');
      const storage = await snapshot('native buffered source after separation');
      await e.page.close(); return { state, bufferedEntries: storage.bufferedAudio };
    });
    await scenario('cancel active processing and tab closure release workers and temporary audio', async () => {
      await hooks(); await env.run('__test.stopStemAnalysis()');
      await wait(async () => { const s = await inspect(); return !s.inferenceWorkers.length && !s.preloadedTracks.length && !s.bufferedAudio.length; });
      await env.run('__test.requestStemAnalysis()'); await sleep(1500); await env.page.close();
      await wait(async () => { const s = await inspect(); return !s.inferenceWorkers.length && !s.preloadedTracks.length && !s.bufferedAudio.length; });
      return (await snapshot('after last video tab closed')).storage;
    });
    env = await video();
    await scenario('removal during active model work then reinstall', async () => {
      await sleep(1000); await remove(); await install(); await separated(); return await snapshot('after reinstall');
    });
    await scenario('offline installed-model operation', async () => {
      await context.setOffline(true);
      const result = await env.run(`__send({type:'ytbm-stems-engine-request',client:'offline-test',message:{type:'init',modelBytes:165612636,modelSha256:'d05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a',wasmPaths:{ortMin:chrome.runtime.getURL('addons/stems/vendor/ort.min.js'),dir:chrome.runtime.getURL('addons/stems/vendor/')}}})`);
      assert.equal(result.message.type, 'ready');
      await env.run('__send({type:"ytbm-stems-engine-close",client:"offline-test"})');
      await context.setOffline(false); return 'Cached/local audio and model supported; fetching a new YouTube song still requires network';
    });
    await scenario('browser restart preserves installed model and drops temporary audio', async () => {
      await env.page.close(); await wait(async () => !(await inspect()).inferenceWorkers.length);
      await context.close(); context = null; await start();
      const state = await snapshot('browser restart before opening a video');
      assert.equal(state.model.present, true); assert.equal(state.preloadedTracks.length, 0); assert.equal(state.inferenceWorkers.length, 0);
      env = await video(); await separated();
    });
    await scenario('final repeated resource removal returns owned storage to zero', async () => {
      await remove(); await remove(); const state = await snapshot('final baseline');
      assert.equal(state.storage.opfsBytes, 0); assert.equal(state.inferenceWorkers.length, 0);
      assert.equal(state.preloadedTracks.length, 0); assert.equal(state.bufferedAudio.length, 0);
      return state.storage;
    });
    report.limitations.push('Range/reinstall cycles after the first real remote install use the exact verified full-size model served by an isolated HTTPS fixture, not repeated external CDN downloads.',
      'Player fixtures verify real Web Audio/inference in Chrome; live YouTube and crash/power-loss behavior are separate tests.',
      'Origin usage may retain Chrome metadata, HTTP/compiled-WASM/GPU caches and deliberate unrelated test data; owned model/audio files are measured separately.');
  } finally {
    if (context && control && !control.isClosed()) { try { await snapshot('end-of-run evidence'); } catch {} }
    report.finishedAt = new Date().toISOString();
    if (context) await context.close(); server.close();
    const text = JSON.stringify(report, null, 2);
    fs.writeFileSync(path.join(process.env.YTBM_EVIDENCE_DIR, 'stems-browser-audit.json'), text);
    fs.writeFileSync(path.join(process.env.YTBM_EVIDENCE_DIR, `stems-browser-audit-${Date.now()}.json`), text);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
