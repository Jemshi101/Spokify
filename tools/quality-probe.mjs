// Voice quality over sentence length and over time: renders each text on the GPU engine and the CPU
// reference, and prints their spectral similarity (healthy ≈ 0.85; garbled < 0.5).
// Usage: node tools/quality-probe.mjs [chrome|opera]
import puppeteer from 'puppeteer';
import path from 'node:path';
import { spectralSimilarity } from '../tests/audio.mjs';

const which = process.argv[2] ?? 'chrome';
const base = 'the reader keeps a steady pace and clear pronunciation while it moves through the article';
const TEXTS = [
  'This is a short sentence to begin with.',
  'Reading long articles out loud should feel natural, with steady pacing and clear pronunciation from start to end.',
  ...[150, 200, 250, 300, 380, 480].map((n) => {
    let t = 'In this longer sentence, ';
    while (t.length < n) t += base + ', and ';
    return t.slice(0, n).replace(/[ ,]+\w*$/, '') + '.';
  }),
];
const SEQ = Array.from({ length: 24 }, (_, i) => `Sentence number ${i + 1} is here, and it talks about the weather, the news, and a small cat that sleeps all day.`);

const opts = { headless: true, pipe: true, protocolTimeout: 1800000, enableExtensions: [path.resolve('dist')], args: ['--mute-audio', '--enable-unsafe-webgpu'] };
if (which === 'opera') Object.assign(opts, { executablePath: '/Applications/Opera.app/Contents/MacOS/Opera', userDataDir: path.resolve('.e2e-opera') });
else opts.userDataDir = path.resolve('.e2e-profile');
const browser = await puppeteer.launch(opts);
try {
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('sw.js'));
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${new URL(sw.url()).host}/diag.html`);
  const render = (texts, engine) =>
    page.evaluate(async (texts, engine) => {
      const w = (window.__w ??= new Worker(new URL('worker.js', location.href), { type: 'module' }));
      let n = (window.__n ??= 0);
      const call = (method, params) => new Promise((ok, no) => {
        const id = (window.__n = ++n);
        const h = ({ data }) => { if (data.id !== id) return; w.removeEventListener('message', h); data.error ? no(new Error(data.error)) : ok(data.result); };
        w.addEventListener('message', h);
        w.postMessage({ id, method, params });
      });
      const out = [];
      for (const text of texts) {
        const r = await call('generate', { text, words: [], voice: 'af_heart', speed: 1, engine });
        out.push({ engine: r.engine, genMs: r.genMs, audioSec: r.audioSec, samples: Array.from(r.samples) });
      }
      return out;
    }, texts, engine);
  const all = [...TEXTS, ...SEQ];
  const gpu = await render(all, 'auto');
  const cpu = await render(all, 'wasm-q8');
  console.log('engine', gpu[0].engine);
  all.forEach((t, i) => {
    const sim = spectralSimilarity(gpu[i].samples, cpu[i].samples);
    console.log(`${i < TEXTS.length ? `len ${String(t.length).padStart(3)}` : `seq ${String(i - TEXTS.length + 1).padStart(3)}`}  sim ${sim.toFixed(2)}  gpu ${(gpu[i].audioSec / (gpu[i].genMs / 1000)).toFixed(1)}x realtime  ${gpu[i].audioSec.toFixed(1)}s${sim < 0.6 ? '  ← BAD' : ''}`);
  });
} finally {
  await browser.close();
}
