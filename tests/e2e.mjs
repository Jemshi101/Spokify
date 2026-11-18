// End-to-end MVP checks in Chrome for Testing (headless). Run `npm run build` first.
// Usage: node tests/e2e.mjs [--engine=webgpu-fp16] [--skip-pause]
import puppeteer from 'puppeteer';
import http from 'node:http';
import path from 'node:path';

const arg = (name, def) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def;
const engine = arg('engine', 'auto');
const skipPause = process.argv.includes('--skip-pause');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ARTICLE = `<!doctype html><html><head><title>Test article</title></head><body>
<header><nav><a href="/">Home</a> <a href="/news">News</a> <p>Subscribe to our newsletter for daily updates and offers.</p></nav></header>
<div class="layout">
  <aside><p>Related: Ten tips for better sleep, and why you should drink more water every day.</p></aside>
  <main><h1>Why reading aloud helps</h1>
    <div class="content">
      <p>Listening to text while following along can improve focus. Many people find it easier to stay engaged with long articles this way.</p>
      <p>In 2024, small speech models became good enough to run inside a browser tab. They no longer sound robotic, and they cost nothing to use.</p>
      <p>Dr. Smith's team tested state-of-the-art voices on 1,000 sentences; the results were surprisingly close to human recordings.</p>
      <p>The subscription costs $5.99 per month, which is cheaper than most audiobook services, according to the report.</p>
      <p>Reading along also helps with vocabulary. When you see and hear a word at the same time, it sticks better.</p>
      <p>Finally, it is simply relaxing to close your eyes and let the article read itself to you.</p>
    </div>
  </main>
</div>
<footer><p>Copyright 2026 Example Media. All rights reserved. Privacy policy and terms of use apply.</p></footer>
</body></html>`;
const OTHER = '<!doctype html><title>Other</title><p>Another page.</p>';

const server = http
  .createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(req.url === '/other' ? OTHER : ARTICLE))
  .listen(0);
const base = `http://localhost:${server.address().port}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  headless: true,
  pipe: true,
  userDataDir: path.resolve('.e2e-profile'), // keeps the downloaded model cached between runs
  enableExtensions: [path.resolve('dist')],
  args: ['--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required'],
});

try {
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('sw.js'));
  const extId = new URL(sw.url()).host;
  const ext = await browser.newPage();
  await ext.goto(`chrome-extension://${extId}/popup.html`);
  const call = (msg) => ext.evaluate((m) => chrome.runtime.sendMessage({ target: 'sw', ...m }), msg);
  const status = () => call({ type: 'host', payload: { type: 'status' } });
  const setSettings = (s) => ext.evaluate((v) => chrome.storage.local.set({ settings: v }), s);

  await setSettings({ engine, voice: 'af_heart', speed: 1.5 });
  const info = await call({ type: 'hostInfo' });
  check('audio host starts as offscreen document', info.host?.kind === 'offscreen', JSON.stringify(info));

  const page = await browser.newPage();
  await page.goto(`${base}/article`);
  await page.bringToFront();
  const tabId = await ext.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, `${base}/article`);
  const state = () => page.evaluate(() => {
    const d = document.documentElement.dataset.ttsReader;
    const h = (n) => (CSS.highlights.get(n) ? [...CSS.highlights.get(n)][0].toString() : null);
    return { ...(d ? JSON.parse(d) : {}), sentence: h('tts-sentence'), word: h('tts-word') };
  });

  // --- model warm-up (what opening the popup does), then time to first audio
  const tw = Date.now();
  await call({ type: 'host', payload: { type: 'warmup' } });
  while (!(await call({ type: 'host', payload: { type: 'env' } })).worker?.loaded) await sleep(200);
  console.log(`   model ready after ${Date.now() - tw} ms (cold start includes the one-time download)`);
  const t0 = Date.now();
  const res = await call({ type: 'extract', mode: 'page', tabId });
  check('extracts the article', res?.count === 10, `${res?.count} segments`);
  let s;
  while (!(s = await state()).sentence && Date.now() - t0 < 120000) await sleep(50);
  const ttfa = Date.now() - t0;
  check('first audio starts quickly (warm model)', ttfa < 1500, `${ttfa} ms`);

  // --- collect sentences & words while reading; switch tabs (background play) and change speed midway
  const sentences = new Set();
  const words = new Set();
  let switched = false;
  let speedChanged = false;
  let lastSid = -1;
  let rateSeen = 0;
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    s = await state();
    if (s.sentence) sentences.add(s.sentence.trim());
    if (s.word) words.add(`${s.sid}:${s.word}`);
    if (s.sid !== undefined) lastSid = s.sid;
    if (s.rate) rateSeen = Math.max(rateSeen, s.rate);
    if (!switched && s.sid >= 2) {
      await ext.bringToFront(); // reading tab goes to the background
      switched = true;
    }
    if (!speedChanged && s.sid >= 4) {
      await setSettings({ engine, voice: 'af_heart', speed: 2.5 });
      await page.bringToFront(); // back in view: word highlighting animates again
      speedChanged = true;
    }
    if (!skipPause && s.sid === 6 && !s.paused) break;
    if (s.sid === s.total - 1 && !s.sentence) break;
    await sleep(40);
  }
  const all = [...sentences].join(' ');
  check('title is read first', [...sentences][0]?.startsWith('Why reading aloud helps'), [...sentences][0]);
  check('nav, sidebar and footer are skipped', !/Subscribe|Related:|Copyright/.test(all));
  check('keeps playing while the tab is in the background', lastSid >= 4, `reached sentence ${lastSid + 1}`);
  check('speed change applies mid-reading (pitch-preserving rate > 1)', rateSeen > 1.6, `playback rate ${rateSeen.toFixed(2)}`);

  // --- pause for 45 s: offscreen document must survive silence
  if (!skipPause) {
    await call({ type: 'host', payload: { type: 'pause' } });
    await sleep(45000);
    const st = await status();
    check('host survives a 45 s pause', st.active && st.paused, JSON.stringify({ active: st.active, paused: st.paused }));
    await call({ type: 'host', payload: { type: 'resume' } });
    const end = Date.now() + 120000;
    while (Date.now() < end) {
      s = await state();
      if (s.word) words.add(`${s.sid}:${s.word}`);
      if (s.sid === s.total - 1 && !s.sentence) break;
      await sleep(40);
    }
    check('resumes and finishes', s.sid === s.total - 1, `sentence ${s.sid + 1}/${s.total}`);
  }

  const st = await status();
  const stats = (await page.evaluate(() => document.documentElement.dataset.ttsReader)) ?? '{}';
  console.log('content stats:', stats);
  check('word highlighting advances through the text', words.size >= 50, `${words.size} distinct word highlights`);

  // --- stop on navigation
  await page.bringToFront();
  await call({ type: 'extract', mode: 'page', tabId });
  while (!(await state()).sentence) await sleep(50);
  await page.goto(`${base}/other`);
  await sleep(1500);
  const after = await status();
  check('stops when the reading tab navigates away', !after.active, JSON.stringify({ active: after.active }));

  const r = await call({ type: 'host', payload: { type: 'env' } });
  console.log('engine:', JSON.stringify(r.worker?.loaded), 'last session stats:', JSON.stringify(st.stats));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
