/* Opt-in actual Chrome extension reload regression, disposable profile only. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.YTBM_PLAYWRIGHT);
const profile = process.env.YTBM_PROFILE;
if (!profile?.includes('/T/opencode/') || !path.basename(profile).startsWith('stems-audit-')) throw new Error('Use a disposable stems-audit-* test profile');
(async () => {
  const root = process.env.YTBM_EXTENSION_ROOT;
  const context = await chromium.launchPersistentContext(profile, { executablePath: process.env.YTBM_CHROME,
    headless: true, args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--autoplay-policy=no-user-gesture-required'] });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const audio = Buffer.alloc(44 + 44100 * 20 * 4);
    audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16);
    audio.writeUInt16LE(1, 20); audio.writeUInt16LE(2, 22); audio.writeUInt32LE(44100, 24); audio.writeUInt32LE(176400, 28);
    audio.writeUInt16LE(4, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
    for (let i = 0; i < 44100 * 20; i++) { const s = Math.round(Math.sin(i * 2 * Math.PI * 220 / 44100) * 8000); audio.writeInt16LE(s, 44 + i * 4); audio.writeInt16LE(s, 46 + i * 4); }
    await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><video class="html5-main-video" controls src="data:audio/wav;base64,${audio.toString('base64')}"></video></body></html>` }));
    const page = await context.newPage(), cdp = await context.newCDPSession(page);
    let world;
    const warnings = [], exceptions = [];
    cdp.on('Runtime.executionContextCreated', ({ context }) => { if (context.origin.startsWith('chrome-extension://')) world = context.id; });
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => exceptions.push(exceptionDetails.exception?.description || exceptionDetails.text));
    page.on('console', message => { if (/Stem worklet tap unavailable|Extension context invalidated/i.test(message.text())) warnings.push(message.text()); });
    await cdp.send('Runtime.enable');
    await page.goto('https://www.youtube.com/watch?v=context-reload-test'); await page.waitForTimeout(1000);
    const run = async expression => {
      const result = await cdp.send('Runtime.evaluate', { expression, contextId: world, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    await cdp.send('Debugger.enable');
    const object = (await cdp.send('Runtime.evaluate', { expression: '__ytbmStemDiag', contextId: world })).result.objectId;
    const { breakpointId } = await cdp.send('Debugger.setBreakpointOnFunctionCall', { objectId: object });
    const paused = new Promise(resolve => cdp.once('Debugger.paused', resolve));
    const trigger = cdp.send('Runtime.evaluate', { expression: '__ytbmStemDiag()', contextId: world });
    const event = await paused;
    await cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: event.callFrames[0].callFrameId,
      expression: `window.__reloadTest={getStemState,ensureStemTapWorklet,requestStemAnalysis,stemContextAvailable,
        start:async()=>{await ensureAudioContext();const st=ensureStemSession();st.installed=true;st.analysisRequested=true;ensureStemBus();applyAllFXRouting();ensureStemResourcePort();return await ensureStemTapWorklet();},
        rms:async()=>{const a=audioContext.createAnalyser();a.fftSize=2048;stemBusOutput.connect(a);await new Promise(r=>setTimeout(r,200));const d=new Float32Array(2048);a.getFloatTimeDomainData(d);stemBusOutput.disconnect(a);return Math.sqrt(d.reduce((s,x)=>s+x*x,0)/d.length);}}` });
    await cdp.send('Debugger.removeBreakpoint', { breakpointId }); await cdp.send('Debugger.resume'); await trigger;
    await run('__reloadTest.start()');
    for (let i = 0; i < 50; i++) {
      if (await run('!!__reloadTest.getStemState()._tapNodes?.length')) break;
      await page.waitForTimeout(100);
    }
    assert.equal(await run('!!__reloadTest.getStemState()._tapNodes?.length'), true);
    await page.locator('video.html5-main-video').first().evaluate(v => v.play());
    const before = await run('__reloadTest.rms()'); assert.ok(before > 0.1);
    const manager = await context.newPage(); await manager.goto('chrome://extensions/');
    await manager.evaluate(() => new Promise(resolve => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, resolve)));
    const extensionId = new URL(worker.url()).hostname;
    await manager.evaluate(id => new Promise((resolve, reject) => {
      chrome.developerPrivate.reload(id, { failQuietly: false, populateErrorForUnpacked: false }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve();
      });
    }), extensionId);
    await page.waitForTimeout(1200);
    for (let i = 0; i < 5; i++) await run('Promise.resolve(__reloadTest.requestStemAnalysis()).then(()=>__reloadTest.ensureStemTapWorklet())');
    const after = await run('__ytbmStemDiag()');
    assert.equal(after.contextInvalidated, true); assert.equal(after.stemsInstalled, false); assert.equal(after.analysisRequested, false);
    assert.equal(after.engine, 'original'); assert.ok(await run('__reloadTest.rms()') > 0.1);
    assert.deepEqual(warnings, []); assert.deepEqual(exceptions, []);
    await page.reload(); await page.waitForTimeout(1000);
    let refreshed = false;
    for (let i = 0; i < 30; i++) {
      const exists = await run('typeof window.__ytbmStemDiag === "function"');
      if (exists) { refreshed = !await run('__ytbmStemDiag().contextInvalidated'); break; }
      await page.waitForTimeout(100);
    }
    if (!refreshed) console.log('REFRESH DEBUG', { exceptions, warnings, workers: context.serviceWorkers().map(w => w.url()),
      extension: await manager.evaluate(id => new Promise(resolve => chrome.developerPrivate.getExtensionInfo(id, resolve)), extensionId) });
    assert.equal(refreshed, true);
    console.log(JSON.stringify({ result: 'PASS', browser: context.browser().version(),
      scenario: 'real chrome://extensions Reload while video and stem worklet are active',
      originalAudioBeforeReload: before, staleContextAfterReload: after, warnings, exceptions,
      refreshCreatesValidContext: true, modelDownloadOrSeparationWasRequired: false }, null, 2));
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
