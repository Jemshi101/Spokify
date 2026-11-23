// Generates one sentence with each engine inside a browser and prints audio statistics.
// Usage: OUT=<dir> node tools/engine-probe.mjs [chrome|opera] [--headful]
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { freshExtensionScripts } from '../tests/profile.mjs';
const which = process.argv[2] ?? 'chrome';
const S = process.env.OUT ?? '.';
const opts = {
  headless: !process.argv.includes('--headful'),
  pipe: true,
  protocolTimeout: 600000,
  userDataDir: freshExtensionScripts(path.resolve(S, `probe-${which}`)),
  enableExtensions: [path.resolve('dist')],
  args: ['--mute-audio', '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required', '--no-first-run'],
};
if (which === 'opera') opts.executablePath = '/Applications/Opera.app/Contents/MacOS/Opera';
const browser = await puppeteer.launch(opts);
try {
  console.log('browser', await browser.version());
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('sw.js'), { timeout: 30000 });
  const id = new URL(sw.url()).host;
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${id}/diag.html`);
  const res = await page.evaluate(async () => {
    const text = 'Hi! I can read any web page or PDF to you, and highlight each word as I go.';
    const w = new Worker(new URL('worker.js', location.href), { type: 'module' });
    let n = 0;
    const call = (method, params) => new Promise((ok, no) => {
      const id = ++n;
      const h = ({ data }) => { if (data.id !== id) return; w.removeEventListener('message', h); data.error ? no(new Error(data.error)) : ok(data.result); };
      w.addEventListener('message', h);
      w.postMessage({ id, method, params });
    });
    const out = { env: await call('envReport'), runs: [] };
    for (const engine of ['webgpu-fp32', 'webgpu-fp16', 'wasm-q8']) {
      try {
        const r = await call('generate', { text, words: text.split(/\s+/), voice: 'af_heart', speed: 1, engine });
        const s = r.samples;
        let sum = 0, peak = 0, clip = 0, nan = 0, zc = 0;
        for (let i = 0; i < s.length; i++) {
          const v = s[i];
          if (!Number.isFinite(v)) { nan++; continue; }
          sum += v * v; peak = Math.max(peak, Math.abs(v)); if (Math.abs(v) >= 0.99) clip++;
          if (i && (s[i - 1] < 0) !== (v < 0)) zc++;
        }
        out.runs.push({ engine: r.engine, audioSec: +r.audioSec.toFixed(2), genMs: r.genMs, rms: +Math.sqrt(sum / s.length).toFixed(4), peak: +peak.toFixed(3), clipped: clip, nan, zeroCrossPerSec: Math.round(zc / r.audioSec), exactWords: r.exact, firstTimes: r.wordTimes.slice(0, 6).map((t) => +t.toFixed(2)), wav: Array.from(s.subarray(0, Math.min(s.length, 24000 * 8))) });
      } catch (e) { out.runs.push({ engine, error: String(e.message ?? e) }); }
    }
    w.terminate();
    return out;
  });
  console.log('env', JSON.stringify(res.env));
  for (const r of res.runs) {
    if (r.wav) {
      const f = path.resolve(S, `${which}-${r.engine}.f32`);
      fs.writeFileSync(f, Buffer.from(new Float32Array(r.wav).buffer));
      delete r.wav;
    }
    console.log(JSON.stringify(r));
  }
} finally {
  await browser.close();
}
