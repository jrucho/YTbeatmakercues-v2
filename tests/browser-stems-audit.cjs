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
      const audio=samples[kind],range=route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
      const from=range?Number(range[1]):0,end=range?.[2]?Math.min(audio.length-1,Number(range[2])):audio.length-1;
      return route.fulfill({ status:range?206:200, contentType: 'audio/wav',
        headers:{'accept-ranges':'bytes','content-length':String(end-from+1),...(range?{'content-range':`bytes ${from}-${end}/${audio.length}`}:{})},body:audio.subarray(from,end+1) });
    }
    const kind = url.searchParams.get('kind') || 'normal';
    if (kind.startsWith('mse')) return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><div id="movie_player" class="html5-video-player"><video class="html5-main-video" controls></video><div class="ytp-right-controls" style="height:48px"><button class="ytp-subtitles-button">CC</button><button class="ytp-settings-button">Settings</button></div></div><script>
      window.__loadNativeSource=async(id,delay=0)=>{if(id)history.pushState({},'', '/watch?v='+id+'&kind=mse');if(delay)await new Promise(r=>setTimeout(r,delay));const v=document.querySelector('video.html5-main-video'),m=new MediaSource();v.pause();v.src=URL.createObjectURL(m);await new Promise(r=>m.addEventListener('sourceopen',r,{once:true}));const s=m.addSourceBuffer('audio/webm;codecs=opus');m.duration=8.2;const data=await(await fetch('/audit.webm')).arrayBuffer();s.appendBuffer(data);await new Promise(r=>s.addEventListener('updateend',r,{once:true}));m.endOfStream();};
      __loadNativeSource(null,${kind === 'mse-late' ? 1200 : 0});
    </script></body></html>` });
    const seconds = kind === 'short' ? 0.5 : kind === 'overlimit' ? 601 : kind === 'long' ? 30 : 7.8;
    const metadata = { videoDetails: { videoId: url.searchParams.get('v'), lengthSeconds: String(seconds) }, streamingData: { adaptiveFormats: [
      { mimeType: 'audio/wav', url: `https://rr1---sn-test.googlevideo.com:${server.address().port}/sample.wav?kind=${kind}` },
    ] } };
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><script>window.ytInitialPlayerResponse=${JSON.stringify(metadata)}</script><div id="movie_player" class="html5-video-player"><video class="html5-main-video" controls preload="auto" src="https://www.youtube.com/sample.wav?kind=${kind}"></video><div class="ytp-right-controls" style="height:48px"><button class="ytp-subtitles-button">CC</button><button class="ytp-settings-button">Settings</button></div></div></body></html>` });
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
  if (!process.env.YTBM_PLAYER_SWITCH_ONLY) {
    await page.locator('.ytbm-player-cues-button').waitFor({ state: 'visible' });
    await page.locator('.ytbm-player-cues-button').click();
  }
  return { page, cdp, run, world: () => world };
}
async function showMiniBar(e) {
  await e.page.locator('.ytbm-player-cues-button').waitFor({ state: 'visible' });
  if (!await e.page.locator('.ytbm-minimal-bar').isVisible()) await e.page.locator('.ytbm-player-cues-button').click();
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
  const documentStarted = await e.page.evaluate(() => performance.timeOrigin);
  if (process.env.YTBM_UI_INSTALL && !(await inspect()).model.present) {
    await wait(() => e.run('__ytbmStemDiag().modelCheckState === "missing"'));
    await e.page.locator('.ytbm-stems-btn').click();
    await e.page.getByText('Download stems package', { exact: true }).click();
    assert.equal(await e.page.locator('.ytbm-stems-progress-wrap').isVisible(), true);
    assert.equal(await e.page.locator('.ytbm-stems-status').isVisible(), false);
  } else {
    const response = await e.run('__send({type:"ytbm-stems-download-start"})'); assert.equal(response.ok, true);
  }
  await wait(async () => { const s = await inspect(); if (s.lastDownloadError && !s.downloading) throw new Error(s.lastDownloadError); return s.model.present && !s.downloading; }, 240000);
  assert.equal(await e.page.evaluate(() => performance.timeOrigin), documentStarted, 'installation must work without refreshing');
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
  const hookResult = await e.cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: event.callFrames[0].callFrameId,
    expression: `window.__test={getStemState,getStemAISlice,stopStemAnalysis,jumpToCue,stemAiTick,refreshStemsUI,audioContext,stemBusOutput,requestStemAnalysis,getVideoElement,videoSpeedStretchNode,buildTouchPopup,setCueAtKey,getRegionLoopController,goAdvancedUI,goMinimalUI,
      setMode:(mode,rate,tune=0)=>{pitchTarget='video';speedOnlyMode=mode!=='Pitch';speedHDMode=mode==='Speed HD';pitchSemitoneMode=false;updatePitch((rate-1)*100);if(speedHDMode)updateSpeedHDTune(tune);},
      stretchReady:()=>!!videoSpeedStretchNode}` });
  await e.cdp.send('Debugger.removeBreakpoint', { breakpointId }); await e.cdp.send('Debugger.resume'); await trigger;
  if (hookResult.exceptionDetails) throw new Error(hookResult.exceptionDetails.exception?.description || hookResult.exceptionDetails.text);
}
async function separated(e = env) {
  return wait(async () => { const s = await e.run('__ytbmStemDiag()'); if (s.aiError) throw new Error(s.aiError); return s.learnedSegments ? s : false; });
}
async function scenario(name, fn) {
  try { const details = await fn(); report.tests.push({ name, result: 'PASS', details }); console.log('PASS', name); }
  catch (error) { report.tests.push({ name, result: 'FAIL', error: error.message }); console.error('FAIL', name, error); throw error; }
}
async function playerCuesSwitch(e) {
  const button=e.page.locator('.ytbm-player-cues-button'),bar=e.page.locator('#ytbm-mini-bar');
  await button.waitFor({state:'visible'});await bar.waitFor({state:'attached'});
  assert.equal(await bar.isVisible(),false,'mini bar must stay hidden on startup');
  assert.equal(await button.getAttribute('aria-pressed'),'false');
  const placement=await button.evaluate(el=>({tag:el.tagName,native:el.classList.contains('ytp-button'),
    parent:el.parentElement.className,next:el.nextElementSibling?.className,previous:el.previousElementSibling?.className,
    label:el.textContent,svg:!!el.querySelector('svg'),background:getComputedStyle(el).backgroundColor}));
  assert.equal(placement.tag,'BUTTON');assert.equal(placement.native,true);assert.match(placement.parent,/ytp-right-controls/);
  assert.match(placement.next,/ytp-settings-button/);assert.equal(placement.label,'');assert.equal(placement.svg,true);
  assert.match(await button.getAttribute('aria-label'),/Show Cues/);
  assert.match(placement.previous,/ytp-subtitles-button/);
  await button.hover();await sleep(180);
  const hoverStyle=await button.evaluate(el=>({outer:getComputedStyle(el).backgroundColor,
    pill:getComputedStyle(el.querySelector('.ytbm-player-cues-content')).backgroundColor,
    round:getComputedStyle(el.querySelector('.ytbm-player-cues-content')).borderRadius}));
  assert.equal(hoverStyle.outer,'rgba(0, 0, 0, 0)');assert.equal(hoverStyle.pill,'rgba(0, 0, 0, 0)');assert.equal(hoverStyle.round,'999px');
  const glyph=await button.evaluate(el=>{
    const svg=el.querySelector('svg'),p=svg.querySelector('path').getBBox(),b=svg.getBoundingClientRect(),outer=el.getBoundingClientRect();
    return {playWidth:p.width,playHeight:p.height,iconWidth:b.width,iconHeight:b.height,
      dx:b.left+b.width/2-outer.left-outer.width/2,dy:b.top+b.height/2-outer.top-outer.height/2};
  });
  assert.ok(glyph.playWidth>=3.5&&glyph.playHeight>=4.4);assert.equal(glyph.iconWidth,24);assert.equal(glyph.iconHeight,24);
  assert.ok(Math.abs(glyph.dx)<.5&&Math.abs(glyph.dy)<.5);
  await button.click();assert.equal(await bar.isVisible(),true);assert.equal(await button.getAttribute('aria-pressed'),'true');
  await button.click();assert.equal(await bar.isVisible(),false);
  await button.focus();await e.page.keyboard.press('Enter');assert.equal(await bar.isVisible(),true);
  await e.page.keyboard.press('Space');assert.equal(await bar.isVisible(),false);
  await button.click();
  const current=e.page.url();
  await e.page.evaluate(()=>history.pushState({},'','/watch?v=toggle-next'));
  await wait(async()=>!await bar.isVisible());assert.equal(await button.getAttribute('aria-pressed'),'false');
  await button.click();assert.equal(await bar.isVisible(),true);
  await e.page.locator('.ytp-right-controls').evaluate(el=>{
    const next=document.createElement('div');next.className='ytp-right-controls';next.style.height='48px';
    next.innerHTML='<div class="ytp-control-group" style="height:48px"><button class="ytp-subtitles-button">CC</button><button class="ytp-settings-button">Settings</button></div>';el.replaceWith(next);
  });
  await button.waitFor({state:'visible'});
  assert.equal(await button.count(),1);assert.equal(await bar.isVisible(),true,'control rebuild must preserve the current visibility');
  assert.equal(await button.evaluate(el=>el.previousElementSibling?.classList.contains('ytp-subtitles-button')),true);
  await button.click();assert.equal(await bar.isVisible(),false);
  await e.page.evaluate(url=>history.pushState({},'',url),current);
  await wait(async()=>!await bar.isVisible());
  await button.click();await e.page.locator('#movie_player').evaluate(el=>el.requestFullscreen());
  await wait(()=>e.page.evaluate(()=>document.fullscreenElement?.contains(document.getElementById('ytbm-mini-bar'))));
  assert.equal(await bar.isVisible(),true);await button.click();assert.equal(await bar.isVisible(),false);
  await button.click();await e.page.evaluate(()=>document.exitFullscreen());
  await wait(()=>e.page.evaluate(()=>document.getElementById('ytbm-mini-bar').parentElement===document.body));
  assert.equal(await bar.isVisible(),true);
  await e.page.locator('video.html5-main-video').first().evaluate(v=>v.play());
  await button.click();const t=await e.page.locator('video.html5-main-video').first().evaluate(v=>v.currentTime);
  await sleep(150);assert.equal(await bar.isVisible(),false);
  assert.ok(await e.page.locator('video.html5-main-video').first().evaluate(v=>!v.paused&&v.currentTime>0));
  await e.page.locator('video.html5-main-video').first().evaluate(v=>v.pause());
  await e.page.screenshot({path:process.env.YTBM_EVIDENCE_DIR+'/player-cues-switch.png'});
  return {placement,fullscreen:true,keyboard:true,controlsReplacement:true,navigationStartsHidden:true,audioContinuesWhileHidden:true};
}
async function livePlayerCuesSwitch() {
  await context.unroute('https://www.youtube.com/**');
  const page=await context.newPage();
  const extensionErrors=[];
  page.on('pageerror',e=>{if(/player-cues-button\.js|chrome-extension:/.test(e.stack||''))extensionErrors.push(e.stack);});
  await page.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw',{waitUntil:'domcontentloaded',timeout:60000});
  await sleep(3000);
  for(const frame of page.frames()){
    const reject=frame.getByRole('button',{name:/refuser|reject|refuse/i}).first();
    if(await reject.count()){await reject.click({timeout:10000});await sleep(2500);break;}
  }
  try{await page.locator('.ytbm-player-cues-button').waitFor({state:'attached',timeout:30000});}
  catch(error){
    console.log('LIVE SWITCH DOM',await page.evaluate(()=>({url:location.href,title:document.title,video:document.querySelectorAll('video').length,
      controls:document.querySelectorAll('.ytp-right-controls').length,players:document.querySelectorAll('#movie_player').length,
      mini:document.querySelectorAll('.ytbm-minimal-bar').length,body:document.body.innerText.slice(0,1500)})));
    await page.screenshot({path:process.env.YTBM_EVIDENCE_DIR+'/player-cues-live-debug.png'});throw error;
  }
  await page.locator('#movie_player').hover();
  const button=page.locator('.ytbm-player-cues-button'),bar=page.locator('#ytbm-mini-bar');
  assert.equal(await bar.isVisible(),false);
  await button.click();assert.equal(await bar.isVisible(),true);
  const placement=await button.evaluate(el=>{
    const b=el.getBoundingClientRect(),row=el.closest('.ytp-right-controls'),settings=row.querySelector('.ytp-settings-button').getBoundingClientRect();
    return {parent:el.parentElement.className,width:b.width,height:b.height,settingsHeight:settings.height,
      right:b.right,settingsLeft:settings.left,pressed:el.getAttribute('aria-pressed'),previous:el.previousElementSibling?.className};
  });
  assert.ok(placement.height>0&&Math.abs(placement.height-placement.settingsHeight)<2);
  assert.ok(placement.right<=placement.settingsLeft+1,'Cues must sit beside settings without overlapping it');
  assert.match(placement.previous,/ytp-subtitles-button/);
  await page.screenshot({path:process.env.YTBM_EVIDENCE_DIR+'/player-cues-live-youtube.png'});
  await button.hover();await sleep(180);await button.screenshot({path:process.env.YTBM_EVIDENCE_DIR+'/player-cues-live-icon.png'});
  await button.click();assert.equal(await bar.isVisible(),false);
  await button.focus();await page.keyboard.press('Enter');assert.equal(await bar.isVisible(),true);
  await page.locator('#movie_player').evaluate(el=>el.requestFullscreen());
  await wait(()=>page.evaluate(()=>document.fullscreenElement?.contains(document.getElementById('ytbm-mini-bar'))));
  await page.locator('#movie_player').hover();
  await page.screenshot({path:process.env.YTBM_EVIDENCE_DIR+'/player-cues-live-fullscreen.png'});
  await button.click();assert.equal(await bar.isVisible(),false);
  await page.evaluate(()=>document.exitFullscreen());
  assert.deepEqual(extensionErrors,[],'native control insertion must not raise extension errors');
  await page.close();return {url:'https://www.youtube.com/watch?v=jNQXAC9IVRw',placement,fullscreen:true,keyboard:true};
}
async function regionControls(e) {
  e.page.on('pageerror', error => console.log('REGION PAGE ERROR',error.stack));
  await e.page.locator('[data-region-action="in"]').waitFor();
  await hooks(e);
  await e.run('__test.goAdvancedUI()');
  const latency=e.page.getByRole('combobox',{name:'Speed HD latency',exact:true});
  await latency.waitFor({state:'visible'});
  const latencyStyle=await latency.evaluate(el=>({round:getComputedStyle(el).borderRadius,appearance:getComputedStyle(el).appearance,color:getComputedStyle(el).color,options:[...el.options].map(o=>o.textContent)}));
  assert.equal(latencyStyle.round,'999px');assert.equal(latencyStyle.appearance,'none');assert.equal(latencyStyle.color,'rgb(255, 255, 255)');
  await latency.selectOption('live');
  await wait(()=>e.run('Math.abs(__test.videoSpeedStretchNode.latencySeconds-.068)<.001'));
  await wait(()=>latency.isEnabled());await latency.selectOption('quality');
  await wait(()=>e.run('Math.abs(__test.videoSpeedStretchNode.latencySeconds-.168)<.001'));
  await wait(()=>latency.isEnabled());await e.run('__test.goMinimalUI()');
  await e.run('__test.getRegionLoopController().clear()');
  await e.page.locator('video.html5-main-video').first().evaluate(v=>v.play());
  await sleep(250);
  const state = () => e.run('__test.getRegionLoopController().snapshot()');
  const seek = async time => {
    await e.page.waitForFunction(() => document.querySelector('video.html5-main-video').readyState >= 2);
    await e.page.locator('video.html5-main-video').first().evaluate((v, time) => { v.pause(); v.currentTime=time; }, time);
    await e.page.waitForFunction(time => {const v=document.querySelector('video.html5-main-video');return !v.seeking&&Math.abs(v.currentTime-time)<0.02;},time);
  };
  assert.equal(await e.page.locator('.ytbm-minimal-bar').getByText('Import', { exact: true }).count(), 0);
  const buttonStyle = await e.page.locator('[data-region-action="in"]').evaluate(el => ({
    background: getComputedStyle(el).backgroundColor, round: getComputedStyle(el).borderRadius }));
  assert.equal(buttonStyle.background, 'rgba(255, 255, 255, 0.08)'); assert.equal(buttonStyle.round, '999px');
  const iconAlignment=await e.page.locator('[data-region-action="clear"]').evaluate(el=>{
    const b=el.getBoundingClientRect(),i=el.querySelector('svg').getBoundingClientRect();
    return {dx:(i.left+i.width/2)-(b.left+b.width/2),dy:(i.top+i.height/2)-(b.top+b.height/2)};
  });
  assert.ok(Math.abs(iconAlignment.dx)<0.5&&Math.abs(iconAlignment.dy)<0.5,'region loop SVG must be centered in both axes');
  await seek(1); await e.page.keyboard.press('i');
  assert.ok(Math.abs((await state()).in - 1) < 0.02);
  await seek(3); await e.page.keyboard.press('o'); assert.ok(Math.abs((await state()).out - 3) < 0.02);
  assert.equal((await state()).enabled, true);
  assert.equal(await e.page.locator('[data-region-action="in"]').evaluate(el=>el.classList.contains('ytbm-region-set')),true);
  assert.equal(await e.page.locator('[data-region-action="out"]').evaluate(el=>el.classList.contains('ytbm-region-set')),true);
  assert.equal(await e.page.locator('[data-region-action="clear"]').evaluate(el=>el.classList.contains('ytbm-region-enabled')),true);
  await wait(async()=>await e.page.locator('[data-region-action="clear"]').evaluate(el=>getComputedStyle(el).backgroundColor)==='rgba(255, 80, 80, 0.3)',3000);
  let chooser = false; const onChooser = () => chooser = true; e.page.on('filechooser', onChooser);
  await e.page.keyboard.press('Meta+i'); assert.equal(chooser, false); e.page.off('filechooser', onChooser);
  assert.ok(Math.abs((await state()).in - 1) < 0.02, 'Cmd-I must not import or mark IN');
  await e.page.locator('.ytp-progress-bar').evaluate(el => { el.style.width='600px';el.style.height='10px';el.style.marginTop='30px'; });
  await e.run('__test.getRegionLoopController().render()');
  const marker = e.page.locator('.ytbm-region-in'); await marker.scrollIntoViewIfNeeded();
  const bar = await e.page.locator('.ytp-progress-bar').boundingBox(), start = await marker.boundingBox();
  const duration = await e.page.locator('video.html5-main-video').first().evaluate(v => v.duration);
  await e.page.mouse.move(start.x + 4, start.y + 6); await e.page.mouse.down();
  await e.page.mouse.move(bar.x + 2 / duration * bar.width, start.y + 6, { steps: 5 }); await e.page.mouse.up();
  assert.ok(Math.abs((await state()).in - 2) < 0.04);
  await e.page.keyboard.press('u'); assert.ok(Math.abs((await state()).in - 1) < 0.02);
  await e.page.keyboard.press('Meta+u'); assert.ok(Math.abs((await state()).in - 2) < 0.04);
  await e.page.locator('.ytbm-region-out').dblclick(); assert.equal((await state()).out, null);
  assert.equal((await state()).enabled, false);
  await e.page.keyboard.press('u'); assert.ok(Math.abs((await state()).out - 3) < 0.02);
  await e.page.locator('[data-region-action="clear"]').click();
  assert.equal((await state()).in, null); assert.equal((await state()).out, null);
  assert.equal(await e.page.locator('[data-region-action="clear"]').evaluate(el=>el.classList.contains('ytbm-region-enabled')),false);
  await e.page.keyboard.press('u'); assert.ok(Math.abs((await state()).in - 2) < 0.04);
  await e.page.keyboard.down('i');await e.page.keyboard.down('o');
  await e.page.keyboard.up('o');await e.page.keyboard.up('i');
  assert.equal((await state()).in,null);assert.equal((await state()).out,null);
  await e.page.keyboard.press('u');assert.ok(Math.abs((await state()).in-2)<0.04);
  await e.page.locator('[data-region-action="in"]').click({ button: 'right' });
  await e.page.locator('.ytbm-region-menu input[name="regionIn"]').fill('1.1');
  await e.page.locator('.ytbm-region-menu input[name="regionOut"]').fill('2.4');
  await e.page.locator('.ytbm-region-menu button[type="submit"]').click();
  assert.equal((await state()).in, 1.1); assert.equal((await state()).out, 2.4);
  await seek(1.1); await e.page.locator('video.html5-main-video').first().evaluate(v => v.play());
  await wait(() => e.run('__test.getRegionLoopController().nativeRepeats >= 2'), 10000);
  const native = await e.run('({state:__test.getRegionLoopController().snapshot(),repeats:__test.getRegionLoopController().nativeRepeats,time:__test.getVideoElement().currentTime})');
  await e.page.locator('video.html5-main-video').first().evaluate(v => v.pause());
  const beforeEndLoop=await e.run('__test.getRegionLoopController().nativeRepeats');
  await e.run(`__test.getRegionLoopController().change({in:${duration-0.6},out:${duration},enabled:true})`);
  await seek(duration-0.6);await e.page.locator('video.html5-main-video').first().evaluate(v=>v.play());
  await wait(async()=>await e.run('__test.getRegionLoopController().nativeRepeats')>beforeEndLoop,5000);
  assert.equal((await state()).enabled,true);
  await e.page.locator('video.html5-main-video').first().evaluate(v=>v.pause());
  await e.run('__test.getRegionLoopController().change({in:1.1,out:2.4,enabled:true})');
  await e.page.reload();
  await showMiniBar(e);
  await e.page.locator('[data-region-action="in"]').waitFor(); await hooks(e);
  await wait(async () => (await state()).in === 1.1);
  assert.equal((await state()).out, 2.4); assert.equal((await state()).enabled, true);
  const currentURL=e.page.url();
  await e.page.evaluate(()=>history.pushState({},'','/watch?v=region-next-video'));
  await wait(async()=> (await state()).videoId==='youtube:region-next-video');
  assert.equal((await state()).in,null); assert.equal((await state()).enabled,false);
  await e.page.evaluate(url=>history.pushState({},'',url),currentURL);
  await wait(async()=>{const s=await state();return s.videoId==='youtube:audit-1'&&s.in===1.1;});
  assert.equal((await state()).out,2.4);
  await e.run('window.__send=msg=>new Promise(resolve=>chrome.runtime.sendMessage(msg,resolve));__test.getRegionLoopController().clear()');
  return { native, persistence: true, dragUndoRedo: true, doubleClickErase: true, miniBarStyle: buttonStyle };
}

async function regionStemPlayback(e) {
  await showMiniBar(e);
  await hooks(e);
  await e.page.locator('video.html5-main-video').first().evaluate(v => {v.pause();v.currentTime=1;});
  await e.page.waitForFunction(() => !document.querySelector('video.html5-main-video').seeking);
  await e.page.locator('[data-stem="vocals"]').click();
  const metrics = [];
  for (const [mode, rate, tune] of [['Pitch',1,0],['Speed',0.5,0],['Speed HD',0.75,3]]) {
    await e.run(`__test.setMode(${JSON.stringify(mode)},${rate},${tune});__test.getRegionLoopController().change({in:1,out:1.6,enabled:true})`);
    await e.page.locator('video.html5-main-video').first().evaluate(v => v.play());
    await wait(async () => {
      const s=await e.run('__ytbmStemDiag()');
      if(s.preparedError)throw new Error(s.preparedError);
      return s.regionLoop?.audioClock&&s.pathMix==='ai'&&(mode==='Pitch'||s.preparedRate===rate&&s.preparedTune===tune);
    });
    const sample = await e.run(`(async()=>{
      const c=__test.audioContext,ai=__test.getStemState().ai,loop=__test.getRegionLoopController();
      const generation=ai.generation, before=loop.audioRepeats,a=c.createAnalyser();a.fftSize=256;
      __test.videoSpeedStretchNode.output.connect(a);
      let min=Infinity,max=0;const d=new Float32Array(256);
      for(let i=0;i<${Math.ceil(0.6 / rate * 2.5 / 0.015)};i++){
        a.getFloatTimeDomainData(d);const rms=Math.sqrt(d.reduce((s,x)=>s+x*x,0)/d.length);
        if(i>3){min=Math.min(min,rms);max=Math.max(max,rms);}await new Promise(r=>setTimeout(r,15));
      }
      __test.videoSpeedStretchNode.output.disconnect(a);
      return {minRms:min,maxRms:max,generationUnchanged:generation===ai.generation,visualSeeks:loop.audioRepeats-before,
        mutes:__test.getStemState().mutes,state:__ytbmStemDiag(),loopedSources:ai.sources.filter(s=>s.region).length};
    })()`);
    assert.equal(sample.generationUnchanged, true, 'visual looping must not stop/restart the stem queue');
    assert.ok(sample.visualSeeks >= 1); assert.ok(sample.loopedSources > 0);
    assert.ok(sample.minRms > 0.0001, 'ready stem loops must not have a decoder-seek silence');
    assert.equal(sample.mutes.vocals, true); assert.equal(sample.state.liveStretchActive, false);
    metrics.push({ mode, rate, tune, ...sample });
    await e.page.locator('video.html5-main-video').first().evaluate(v => v.pause());
  }
  await e.page.locator('video.html5-main-video').first().evaluate(v=>v.play());
  await e.run('__test.jumpToCue(5)');
  assert.equal(await e.run('__test.getRegionLoopController().state.enabled'),true,'cues must not disable an active region');
  await wait(()=>e.run('__test.getVideoElement().currentTime>=1&&__test.getVideoElement().currentTime<1.7'),5000);
  await e.page.locator('video.html5-main-video').first().evaluate(v=>v.pause());
  await e.run('__test.getRegionLoopController().clear();__test.setMode("Pitch",1)');
  await e.page.locator('[data-stem="vocals"]').click();
  console.log('REGION STEM LOOPS',JSON.stringify(metrics)); return metrics;
}
async function verifyInstalledStemUI(e) {
  const state=await e.run('__ytbmStemDiag()');
  assert.equal(state.contextInvalidated,false);
  assert.equal(state.stemsInstalled,true,'a mute must not change model installation');
  assert.equal(await e.page.locator('.ytbm-minimal-bar').count(),1,'one current mini bar');
  assert.equal(await e.page.locator('.ytbm-stems-grid--inline').isVisible(),true);
  assert.equal(await e.page.locator('.ytbm-stems-grid--inline [data-stem]').count(),4);
  assert.equal(await e.page.locator('.ytbm-stems-btn').isVisible(),false,'the pre-install text button must stay hidden');
  assert.equal(await e.page.getByText('Download stems package',{exact:true}).evaluateAll(els=>els.some(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden')),false);
}
async function normalStemUI(e) {
  await showMiniBar(e);
  await hooks(e);
  await e.page.locator('video.html5-main-video').first().evaluate(v=>{v.pause();v.currentTime=1;});
  await wait(()=>e.run('__ytbmStemDiag().hasCurrentCoverage'));
  let clicks=0;
  for(const mode of ['Pitch','Speed','Speed HD']) {
    await e.run(`__test.setMode(${JSON.stringify(mode)},1)`);
    for(let round=0;round<3;round++) {
      for(const key of ['vocals','drums','bass','other']) {
        const button=e.page.locator(`[data-stem="${key}"]`);
        await button.click();await verifyInstalledStemUI(e);clicks++;
        await button.click();await verifyInstalledStemUI(e);clicks++;
        await button.click({modifiers:['Shift']});await verifyInstalledStemUI(e);clicks++;
        await button.click({modifiers:['Shift']});await verifyInstalledStemUI(e);clicks++;
      }
      await e.run('__test.goAdvancedUI();__test.goMinimalUI()');
      await verifyInstalledStemUI(e);
    }
  }
  console.log('INSTALLED STEM UI CHECK',{clicks,modes:['Pitch','Speed','Speed HD'],viewSwitches:9,result:'PASS'});
  return {clicks,viewSwitches:9,installerReappeared:false};
}
async function hdThenMute(e) {
  await showMiniBar(e);await hooks(e);
  const metrics=[];
  for(const [rate,tune] of [[0.65,3],[1.5,-3],[1,5]]){
    await e.run(`__test.getRegionLoopController().clear();__test.setMode('Speed HD',${rate},${tune});__test.jumpToCue(1)`);
    await e.page.locator('video.html5-main-video').first().evaluate(v=>v.play());
    await sleep(120);
    const before=await e.run('__ytbmStemDiag()');
    assert.equal(before.pathMix,'live');assert.equal(before.liveStretchActive,true);
    const started=Date.now();await e.page.locator('[data-stem="vocals"]').click();
    const state=await wait(async()=>{
      const s=await e.run('__ytbmStemDiag()');
      if(s.preparedError||s.aiError)throw new Error(s.preparedError||s.aiError);
      return s.pathMix==='ai'&&s.preparedRate===rate&&s.preparedTune===tune&&!s.liveStretchActive?s:false;
    },45000);
    const rms=await e.run(`(async()=>{
      const c=__test.audioContext,a=c.createAnalyser();a.fftSize=2048;__test.videoSpeedStretchNode.output.connect(a);
      await new Promise(r=>setTimeout(r,80));const d=new Float32Array(2048);a.getFloatTimeDomainData(d);
      __test.videoSpeedStretchNode.output.disconnect(a);return Math.sqrt(d.reduce((s,x)=>s+x*x,0)/d.length);
    })()`);
    assert.ok(rms>0.001,'muting vocals must leave other stems audible with speed and tuning');
    await verifyInstalledStemUI(e);
    await e.page.locator('.ytbm-player-cues-button').click();
    assert.equal(await e.page.locator('#ytbm-mini-bar').isVisible(),false);
    const hiddenState=await e.run('__ytbmStemDiag()');assert.equal(hiddenState.pathMix,'ai');
    assert.equal(await e.run('__test.getStemState().mutes.vocals'),true);
    await e.page.locator('.ytbm-player-cues-button').click();
    await e.page.locator('[data-stem="vocals"]').click();
    await wait(()=>e.run('__ytbmStemDiag().pathMix==="live"'));
    metrics.push({rate,tune,prepareMs:Date.now()-started,rms,state});
    await e.page.locator('video.html5-main-video').first().evaluate(v=>v.pause());
  }
  await e.run('__test.setMode("Pitch",1)');
  console.log('HD FIRST THEN VOCAL MUTE',JSON.stringify(metrics));return metrics;
}
async function playbackButtons(e, label) {
  await showMiniBar(e);
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
    await e.page.locator(`[data-stem="${key}"]`).click(); await verifyInstalledStemUI(e); singles[key] = await measure();
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
  const e = await video('mse-late'); await separated(e);
  await wait(async () => { const s = await e.run('__ytbmStemDiag()'); if (s.bufferedError) console.log('BUFFER ERROR', s.bufferedError); return s.analysisMode === 'buffered' && s.learnedSegments >= s.trackSegments; });
  const result = await playbackButtons(e, 'native player WebM with delayed first metadata');
  const origin = await e.page.evaluate(() => performance.timeOrigin);
  assert.equal(await e.page.locator('.ytbm-stems-analysis-progress').count(), 0);
  await e.page.locator('[data-stem="vocals"]').hover();
  assert.match(await e.page.locator('#ytbm-tooltip').textContent(), /100% separated/);
  await e.run('window.__beforeReanalyse=__test.getStemState().ai');
  const downloads = report.modelNetwork.length;
  await e.page.locator('[data-stem="vocals"]').click({ button: 'right' });
  assert.equal(await e.page.getByText('Stop analysis', { exact: true }).count(), 0);
  await e.page.getByText('Reanalyse song', { exact: true }).click();
  assert.equal(await e.run('__test.getStemState().ai !== __beforeReanalyse'), true);
  await wait(async () => { const s = await e.run('__ytbmStemDiag()'); return s.analysisMode === 'buffered' && s.learnedSegments >= s.trackSegments; });
  assert.equal(report.modelNetwork.length, downloads, 'reanalysis must reuse the installed model');
  const repeated = await playbackButtons(e, 'reanalysed native song');
  const navigated = [];
  for (const id of ['same-tab-next', 'same-tab-third']) {
    await e.page.evaluate(id => window.__loadNativeSource(id), id);
    await wait(async () => { const s = await e.run('__ytbmStemDiag()'); return s.stemVideoId === 'youtube:' + id && s.analysisMode === 'buffered' && s.learnedSegments > 0 && s.learnedSegments >= s.trackSegments; });
    assert.equal(await e.page.evaluate(() => performance.timeOrigin), origin);
    navigated.push(await playbackButtons(e, id));
  }
  await e.page.close(); return { initial: result, reanalysed: repeated, navigated, refreshRequired: false };
}
async function playbackRates(e, label) {
  await showMiniBar(e);
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
    if (mode !== 'Pitch') await wait(async () => {
      const s = await e.run('__ytbmStemDiag()');
      return s.preparedError || (s.preparedRate === rate && s.preparedTune === tune && !s.liveStretchActive);
    });
    await sleep(450);
    const result = await e.run(`(async()=>{
      const c=__test.audioContext,node=__test.videoSpeedStretchNode.output,a=c.createAnalyser();a.fftSize=32768;
      node.connect(a);await new Promise(r=>setTimeout(r,850));const spectrum=new Float32Array(a.frequencyBinCount);a.getFloatFrequencyData(spectrum);node.disconnect(a);
      let peak=-Infinity,index=0;for(let i=Math.floor(35*a.fftSize/c.sampleRate);i<Math.ceil(210*a.fftSize/c.sampleRate);i++)if(spectrum[i]>peak){peak=spectrum[i];index=i;}
      return {frequency:index*c.sampleRate/a.fftSize,peak,path:__ytbmStemDiag().pathMix,rate:__test.getVideoElement().playbackRate,mutes:__test.getStemState().mutes};
    })()`);
    console.log('RATE SAMPLE', { mode, rate, tune, ...result });
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
async function preparedPlayback(e) {
  await showMiniBar(e);
  await hooks(e);
  for (const key of ['vocals', 'drums', 'other']) await e.page.locator(`[data-stem="${key}"]`).click();
  await e.page.locator('video.html5-main-video').first().evaluate(v => v.play());
  const metrics = [];
  for (const [mode, rate, tune] of [['Speed', 0.5, 0], ['Speed HD', 0.5, 3], ['Speed HD', 1, 0], ['Speed', 1.5, 0]]) {
    await e.run(`__test.setMode(${JSON.stringify(mode)},${rate},${tune})`);
    await wait(async () => {
      const s = await e.run('__ytbmStemDiag()');
      if (s.preparedError) throw new Error(s.preparedError);
      return !s.liveStretchActive && s.pathMix === 'ai' && (rate === 1 && tune === 0 ? s.preparedRate == null : s.preparedRate === rate && s.preparedTune === tune);
    });
    const result = await e.run(`(async()=>{
      const c=__test.audioContext,a=c.createAnalyser();a.fftSize=256;
      __test.videoSpeedStretchNode.output.connect(a);
      __test.jumpToCue(1.25);
      await new Promise(r=>setTimeout(r,60));
      const d=new Float32Array(256);a.getFloatTimeDomainData(d);
      __test.videoSpeedStretchNode.output.disconnect(a);
      return {rmsAt60ms:Math.sqrt(d.reduce((s,x)=>s+x*x,0)/d.length),state:__ytbmStemDiag()};
    })()`);
    assert.ok(result.rmsAt60ms > 0.001, 'prepared/direct cue must sound before the old HD warmup');
    assert.equal(result.state.liveStretchActive, false); assert.equal(result.state.pathMix, 'ai');
    assert.ok(result.state.preparedBytes <= 96 * 1024 * 1024);
    metrics.push({ mode, rate, tune, ...result });
  }
  for (const rate of [0.7, 0.8, 0.9, 1.2]) {
    const transition = await e.run(`(()=>{
      __test.setMode('Speed HD',${rate});
      return {actual:__test.getVideoElement().playbackRate,state:__ytbmStemDiag()};
    })()`);
    assert.equal(transition.actual, transition.state.preparedRate, 'hold the committed speed until the new render is ready');
    assert.equal(transition.state.liveStretchActive, false);
    await sleep(20);
  }
  await wait(async () => { const s = await e.run('__ytbmStemDiag()');
    if (s.preparedError) throw new Error(s.preparedError);
    return s.preparedRate === 1.2 && !s.liveStretchActive && s.pathMix === 'ai';
  });
  await e.run('__test.buildTouchPopup();__test.setCueAtKey("1",1);');
  await e.page.evaluate(() => {
    window.__padSeeks=0;document.querySelector('video.html5-main-video').addEventListener('seeking',()=>window.__padSeeks++);
  });
  const pad = e.page.locator('[data-pad-index="0"]');
  await pad.scrollIntoViewIfNeeded(); const rect = await pad.boundingBox();
  await e.run('__test.audioContext.suspend()');
  await e.page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await e.page.mouse.down(); await sleep(80);
  assert.equal(await e.run('__test.audioContext.state'), 'running', 'pad press must resume audio before release');
  const seeksOnPress = await e.page.evaluate(() => window.__padSeeks);
  assert.equal(seeksOnPress, 1, 'cue must seek while the pad is held down');
  await e.page.mouse.up(); await sleep(50);
  assert.equal(await e.page.evaluate(() => window.__padSeeks), seeksOnPress, 'release must not retrigger the cue');
  await e.page.locator('video.html5-main-video').first().evaluate(v => v.pause());
  await e.run('__test.setMode("Pitch",1)');
  for (const key of ['vocals', 'drums', 'other']) await e.page.locator(`[data-stem="${key}"]`).click();
  console.log('PREPARED PLAYBACK', JSON.stringify(metrics));
  return { metrics, seeksOnPress, releaseRetriggered: false };
}
async function playbackTransitions(e) {
  await hooks(e);
  for (const key of ['vocals', 'drums', 'other']) await e.page.locator(`[data-stem="${key}"]`).click();
  const results = [];
  for (const mode of ['Speed', 'Speed HD']) {
    await e.run(`__test.setMode(${JSON.stringify(mode)},0.65)`);
    await e.page.locator('video.html5-main-video').first().evaluate(v => v.play());
    await sleep(500);
    const fader = [];
    for (const rate of [0.7, 0.8, 0.95, 1, 1.05, 1.2, 0.9]) {
      fader.push(await e.run(`(()=>{
        const ai=__test.getStemState().ai,c=__test.audioContext;
        const old=ai.sources.find(s=>s.startAt<=c.currentTime&&s.startAt+s.duration>c.currentTime);
        __test.setMode(${JSON.stringify(mode)},${rate});
        return {rate:${rate},path:ai.pathMix,retained:!old||ai.sources.includes(old),scheduledRates:ai.sources.map(s=>s.rate),actualRates:ai.sources.map(s=>s.nodes[0].playbackRate.value)};
      })()`));
      await sleep(35);
      fader.at(-1).renderedRates = await e.run('__test.getStemState().ai.sources.map(s=>s.nodes[0].playbackRate.value)');
    }
    for (const sample of fader) {
      assert.equal(sample.path, 'ai'); assert.equal(sample.retained, true);
      assert.ok(sample.scheduledRates.every(rate => Math.abs(rate - sample.rate) < 1e-6), JSON.stringify(sample));
      assert.ok(sample.renderedRates.every(rate => Math.abs(rate - sample.rate) < 1e-6), JSON.stringify(sample));
    }
    const cueOutput = await e.run(`(async()=>{
      const c=__test.audioContext,a=c.createAnalyser();a.fftSize=256;
      __test.videoSpeedStretchNode.output.connect(a);
      const rms=()=>{const d=new Float32Array(256);a.getFloatTimeDomainData(d);return Math.sqrt(d.reduce((s,x)=>s+x*x,0)/d.length);};
      __test.jumpToCue(1);
      await new Promise(r=>setTimeout(r,60));const duringWarmup=rms();
      await new Promise(r=>setTimeout(r,300));const recovered=rms();
      __test.videoSpeedStretchNode.output.disconnect(a);
      return {duringWarmup,recovered,path:__ytbmStemDiag().pathMix};
    })()`);
    assert.ok(cueOutput.duringWarmup < 0.00001, 'cue must not replay old spectral history');
    assert.ok(cueOutput.recovered > 0.001, 'fresh cue audio must recover after the existing engine warmup');
    assert.equal(cueOutput.path, 'ai');
    results.push({ mode, fader, cueOutput });
    await e.page.locator('video.html5-main-video').first().evaluate(v => v.pause());
  }
  await e.run('__test.setMode("Pitch",1)');
  for (const key of ['vocals', 'drums', 'other']) await e.page.locator(`[data-stem="${key}"]`).click();
  console.log('SPEED TRANSITIONS', JSON.stringify(results));
  return results;
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
    window.__duplicateDownloadVisible=document.querySelector('.ytbm-stems-status').style.display!=='none';
    Object.assign(st,previous);__test.refreshStemsUI();})()`);
  assert.equal(await e.run('__downloadLabel'), 'Downloading… 42%');
  assert.equal(await e.run('__duplicateDownloadVisible'), false);
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
   await showMiniBar(e);
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
        const sample=await wait(async()=>{
          const state=await run('__ytbmStemDiag()');
          if(state.preparedError)throw new Error(state.preparedError);
          const ready=mode==='Pitch'||(state.preparedRate===rate&&state.preparedTune===(mode==='Speed HD'?tune:0)&&!state.liveStretchActive);
          return ready&&state.pathMix==='ai'?state:false;
        });
        assert.equal(sample.pathMix,'ai');
        rateStates.push({mode,rate,tune,path:sample.pathMix});
        await page.locator('[data-stem="vocals"]').click();
        await page.locator('video.html5-main-video').first().evaluate(v=>v.pause());
      }
      console.log('LIVE YOUTUBE RATES',rateStates);
    }
     if(process.env.YTBM_REGION_LIVE) await regionStemPlayback(e);
     if(process.env.YTBM_HD_MUTE_LIVE) await hdThenMute(e);
     await page.close();
    return { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', state, measured, rateStates };
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = await start(); env = await video();
    if(process.env.YTBM_PLAYER_SWITCH_ONLY){
      await scenario('native player Cues switch: hidden startup, keyboard, navigation, fullscreen and replacement',()=>playerCuesSwitch(env));
      if(process.env.YTBM_PLAYER_SWITCH_LIVE)await scenario('native Cues control matches the live YouTube control row and fullscreen',livePlayerCuesSwitch);
      return;
    }
    if (!process.env.YTBM_RELEASE_ONLY && (await inspect()).model.present) await remove();
    const existingModel = (await inspect()).model.present;
    if (process.env.YTBM_LOCAL_MODEL) await useFixtureModel();
    if (process.env.YTBM_REGION_ONLY) await scenario('region controls, markers, shortcuts and global undo/redo without stems', () => regionControls(env));
    await snapshot(existingModel ? 'existing verified model baseline' : 'fresh baseline');
    await scenario(existingModel ? 'reuse installed model and separate without another download' : 'fresh remote installation and first separation', async () => {
      await install(); const state = await separated(); await hooks();
      const slice = await env.run('(()=>{const s=__test.getStemAISlice("vocals");return {frames:s?.left.length,finite:s?.left.every(Number.isFinite)}})()');
      assert.equal(slice.frames, N); assert.equal(slice.finite, true);
      await snapshot('installed and separated'); return { state, slice };
    });
    if (process.env.YTBM_REGION_ONLY) {
      await scenario('region loops preserve audio-clock stem playback in Pitch, Speed and HD', () => regionStemPlayback(env));
      return;
    }
    if (process.env.YTBM_UI_ONLY) {
      await scenario('repeated stem mute/solo and Advanced/minimal switches never restore the installer',()=>normalStemUI(env));
      return;
    }
    if(process.env.YTBM_HD_MUTE_ONLY){
      await scenario('Speed HD speed+tuning first, then vocal mute preserves other stems',()=>hdThenMute(env));
      return;
    }
    if (process.env.YTBM_STARTUP_ONLY) {
      await scenario('fresh UI installation starts working in the same document without refresh', () => playbackButtons(env, 'fresh UI install'));
      return;
    }
    if (process.env.YTBM_TRANSITIONS_ONLY) {
      await scenario('continuous fader retiming and cue history isolation in Speed and Speed HD', () => playbackTransitions(env));
      return;
    }
    if (process.env.YTBM_PREPARED_ONLY) {
      await scenario('prepared Speed/HD cues and unity bypass; pads trigger before release', () => preparedPlayback(env));
      return;
    }
    if (process.env.YTBM_LIVE_ONLY) {
      await scenario('all buttons and cues on a real YouTube page', liveYouTubeTest);
      await env.page.close();
      await wait(async () => { const s=await inspect();return !s.temporaryDownloads.length&&!s.inferenceWorkers.length&&!s.bufferedAudio.length&&!s.preloadedTracks.length; });
      await snapshot('video sessions closed; source files and workers reclaimed');
      return;
    }
    if (process.env.YTBM_RELEASE_ONLY) {
      await scenario('all buttons and cues on actual direct-source audio', () => playbackButtons(env, 'direct source'));
      await scenario('cached cues schedule on decoder readiness with the 150 ms poll disabled', () => cachedCueReadiness(env));
      await scenario('shared black tooltips, compact stem/download text and untouched host titles', () => darkTooltips(env));
      if(process.env.YTBM_RATE_TESTS) await scenario('stem playback follows Pitch, Speed and Speed HD with preserved mute state', () => playbackRates(env, 'direct source'));
      if(process.env.YTBM_RATE_TESTS) await scenario('prepared Speed/HD cues and unity bypass; pads trigger before release', () => preparedPlayback(env));
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
