/* Opt-in real offline-WASM renderer checks; no application dependency. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.YTBM_PLAYWRIGHT);
(async () => {
  const root = process.env.YTBM_EXTENSION_ROOT || path.resolve(__dirname, '..');
  const profile = process.env.YTBM_PROFILE;
  if (!profile?.includes('/T/opencode/stems-audit-')) throw new Error('Use a disposable test profile');
  const context = await chromium.launchPersistentContext(profile, { headless: true,
    executablePath: process.env.YTBM_CHROME,
    args: [`--load-extension=${root}`, `--disable-extensions-except=${root}`] });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const origin = `chrome-extension://${new URL(worker.url()).hostname}`;
    const page = await context.newPage(); await page.goto(origin + '/options.html');
    await page.addScriptTag({ url: origin + '/addons/stems/prepared-stretch.js' });
    for (const [rate, tune] of [[0.5, 0], [1.5, 0], [1, 3]]) {
      const result = await page.evaluate(async ({ origin, rate, tune }) => {
        const sr = 44100;
        const frequencies = [55, 110, 261.63, 330], amplitudes = [0.15, 0.04, 0.2, 0.1];
        const channels = Array.from({ length: 8 }, (_, c) => Float32Array.from({ length: sr * 3 }, (_, i) => {
          const stem = Math.floor(c / 2), t = i / sr;
          const tone = amplitudes[stem] * Math.sin(i * 2 * Math.PI * frequencies[stem] / sr);
          const transient = stem === 0 ? 0.1 * Math.sin(i * 78.233) * Math.exp(-(t % 0.5) * 60) : 0;
          return (tone + transient) * (c % 2 ? -1 : 1);
        }));
        const started = performance.now();
        const out = await YTBMPreparedStretch.render({ channels, sampleRate: sr, rate, tune, offset: sr, frames: sr,
          moduleURL: origin + '/worklets/speed-stretch-worklet.js', config: { blockMs: 160, intervalMs: 8, splitComputation: true } });
        const d = out.channels[2]; let count = 0, first = -1, last = 0;
        for (let i = 1; i < d.length; i++) if (d[i - 1] <= 0 && d[i] > 0) { if (first < 0) first = i; last = i; count++; }
        return { ms: performance.now() - started, frames: d.length, frequency: (count - 1) * sr / (last - first),
          finite: d.every(Number.isFinite), rms: Math.sqrt(d.reduce((s, x) => s + x*x, 0) / d.length),
          stereoError: Math.max(...d.subarray(0, 1000).map((x, i) => Math.abs(x + out.channels[3][i]))) };
      }, { origin, rate, tune });
      console.log({ rate, tune, ...result });
      assert.equal(result.frames, Math.round(44100 / rate)); assert.equal(result.finite, true);
      assert.ok(Math.abs(result.frequency - 110 * 2 ** (tune / 12)) < 2);
      assert.ok(result.rms > 0.02); assert.ok(result.stereoError < 1e-5);
    }
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
