// Renders the store images into store/images/ with the built extension (run `npm run build` first):
//   screenshot-1..4.png        1280×800, for the Chrome Web Store and Opera add-ons
//   promo-small-440x280.png    Chrome Web Store small promo tile
//   promo-marquee-1400x560.png Chrome Web Store marquee (optional)
// Uses the e2e profile so the voice model is already cached; audio is muted.
// Usage: npm run store-images
import puppeteer from 'puppeteer';
import http from 'node:http';
import path from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { freshExtensionScripts } from '../tests/profile.mjs';

const OUT = 'store/images';
const W = 1280;
const H = 800;
const ACCENT = '#2f6fed';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const ARTICLE = `<!doctype html><html><head><meta charset="utf-8"><title>The quiet comeback of listening</title>
<style>
  body { margin: 0; font: 19px/1.65 Georgia, 'Times New Roman', serif; color: #222; background: #fbfaf7; }
  nav { font: 15px system-ui, sans-serif; padding: 16px 40px; border-bottom: 1px solid #e6e2d8; display: flex; gap: 24px; color: #555; background: #fff; }
  nav b { color: #111; margin-right: auto; }
  main { max-width: 700px; margin: 0 auto; padding: 36px 24px 300px; }
  h1 { font-size: 40px; line-height: 1.2; margin: 0 0 10px; }
  .by { font: 14px system-ui, sans-serif; color: #777; margin-bottom: 28px; }
</style></head><body>
<nav><b>The Long Read</b><span>Science</span><span>Culture</span><span>Technology</span></nav>
<main>
  <h1>The quiet comeback of listening</h1>
  <div class="by">By Maya Ortiz · 6 min read</div>
  <p>For most of history, people heard stories before they read them. Long before printed books, knowledge travelled from voice to ear, and listeners remembered remarkable amounts of it.</p>
  <p>Today, listening is making a comeback. Commuters fill their mornings with audiobooks, and students play lectures at double speed. Many readers say that hearing a text while following it on the page helps them stay focused for longer.</p>
  <p>The voices have changed too. Speech models that once sounded flat and robotic now pause, breathe and stress the right words. Small versions of these models are efficient enough to run inside a web browser, on an ordinary laptop.</p>
  <p>That matters for privacy as much as for cost. When the voice runs on your own computer, the article you are reading never has to be sent anywhere to be spoken.</p>
  <p>Researchers who study reading are careful not to overstate the benefits. Still, for people with dyslexia, tired eyes or simply too many open tabs, a natural voice can turn a reading list into something they actually finish.</p>
</main></body></html>`;

const server = http.createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(ARTICLE)).listen(0);
const articleUrl = `http://localhost:${server.address().port}/article`;

const browser = await puppeteer.launch({
  headless: true,
  pipe: true,
  userDataDir: freshExtensionScripts(path.resolve('.e2e-profile')),
  enableExtensions: [path.resolve('dist')],
  args: ['--mute-audio', '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb'],
});

const shots = {};
// Every page in light mode, so the popup matches the page it sits on.
const light = async (p) => (await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]), p);
try {
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('sw.js'));
  const extId = new URL(sw.url()).host;
  const extUrl = (p) => `chrome-extension://${extId}/${p}`;

  const ext = await browser.newPage();
  await ext.goto(extUrl('popup.html'));
  const call = (msg) => ext.evaluate((m) => chrome.runtime.sendMessage({ target: 'sw', ...m }), msg);
  await ext.evaluate(() => chrome.storage.local.set({ testMute: true }));
  await ext.evaluate(() => chrome.storage.local.remove('positions'));
  await ext.evaluate(() => chrome.storage.sync.set({ settings: { systemVoice: '', engine: 'auto', voice: 'af_heart', speed: 1 } }));

  // 1. An article being read: sentence and word highlights, floating player.
  const page = await light(await browser.newPage());
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto(articleUrl);
  await page.bringToFront();
  const tabId = await ext.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, articleUrl);
  await call({ type: 'host', payload: { type: 'warmup' } });
  const until = Date.now() + 180000;
  while (!(await call({ type: 'host', payload: { type: 'env' } })).worker?.loaded && Date.now() < until) await sleep(250);
  await page.bringToFront();
  await call({ type: 'extract', mode: 'page', tabId });
  const state = () => page.evaluate(() => {
    const d = document.documentElement.dataset.ttsReader;
    const h = (n) => (CSS.highlights.get(n) ? [...CSS.highlights.get(n)][0].toString() : null);
    return { ...(d ? JSON.parse(d) : {}), word: h('tts-word') };
  });
  // Stop on the third paragraph's first sentence, mid-sentence, with a word highlighted.
  let s;
  const end = Date.now() + 120000;
  while (Date.now() < end && !((s = await state()).sid >= 4 && s.word && s.word.length > 3)) await sleep(40);
  await call({ type: 'host', payload: { type: 'pause' } });
  await sleep(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);
  shots.reading = await page.screenshot({ type: 'png' });

  // 2. The same page with the popup open over it.
  const popup = await light(await browser.newPage());
  await popup.setViewport({ width: 340, height: 700, deviceScaleFactor: 1 });
  await popup.goto(extUrl('popup.html'));
  await sleep(800);
  const box = await popup.evaluate(() => ({ w: document.body.offsetWidth, h: document.body.scrollHeight }));
  shots.popup = await popup.screenshot({ type: 'png', clip: { x: 0, y: 0, width: box.w, height: box.h } });
  await popup.close();
  await call({ type: 'host', payload: { type: 'stop' } });

  // 3. Settings page.
  const opts = await light(await browser.newPage());
  await opts.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await opts.goto(extUrl('options.html'));
  await sleep(1500);
  shots.settings = await opts.screenshot({ type: 'png' });
  await opts.close();

  // 4. Welcome page (voice download and getting started).
  const welcome = await light(await browser.newPage());
  await welcome.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await welcome.goto(extUrl('welcome.html'));
  await sleep(1500);
  shots.welcome = await welcome.screenshot({ type: 'png' });
  await welcome.close();

  // Compose the store images.
  const canvas = await browser.newPage();
  const data = (buf) => `data:image/png;base64,${Buffer.from(buf).toString('base64')}`;
  const icon = readFileSync('tools/icon.svg', 'utf8');
  const frame = (img, url) => `
    <div class="win"><div class="bar"><i></i><i></i><i></i><span>${url}</span></div><img src="${img}"></div>`;
  const slide = (title, sub, body) => `<!doctype html><html><head><style>
    * { box-sizing: border-box; }
    body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; font-family: -apple-system, 'Segoe UI', system-ui, sans-serif;
      background: linear-gradient(160deg, #eef3ff 0%, #dfe8ff 55%, #fff3d6 100%); display: flex; flex-direction: column; align-items: center; }
    h1 { margin: 44px 0 6px; font-size: 40px; color: #10204a; letter-spacing: -0.5px; }
    p.sub { margin: 0 0 28px; font-size: 20px; color: #4a5778; }
    .stage { position: relative; }
    .win { width: 960px; border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 24px 60px rgba(16,32,74,.25); }
    .bar { height: 34px; background: #f1f2f5; display: flex; align-items: center; gap: 7px; padding: 0 14px; border-bottom: 1px solid #e2e4ea; }
    .bar i { width: 11px; height: 11px; border-radius: 50%; background: #d4d7de; }
    .bar span { margin-left: 14px; font-size: 13px; color: #6b7280; background: #fff; border-radius: 6px; padding: 3px 12px; flex: 1; }
    .win img { display: block; width: 960px; height: ${Math.round((960 * H) / W)}px; object-fit: cover; object-position: top; }
    .pop { position: absolute; top: 40px; right: -60px; border-radius: 10px; overflow: hidden; box-shadow: 0 18px 48px rgba(16,32,74,.35); border: 1px solid #d8dbe3; }
    .pop img { display: block; }
  </style></head><body><h1>${title}</h1><p class="sub">${sub}</p><div class="stage">${body}</div></body></html>`;

  const render = async (file, html, w = W, h = H) => {
    await canvas.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await canvas.setContent(html, { waitUntil: 'load' });
    await canvas.screenshot({ path: `${OUT}/${file}`, type: 'png', clip: { x: 0, y: 0, width: w, height: h } });
    console.log(`${OUT}/${file}`);
  };

  await render('screenshot-1.png', slide('Listen to any article', 'Natural voices, with each sentence and word highlighted as it’s read', frame(data(shots.reading), 'thelongread.example/the-quiet-comeback-of-listening')));
  await render('screenshot-2.png', slide('One click to start', 'Read the page or just your selection, pick a voice, set the speed', frame(data(shots.reading), 'thelongread.example/the-quiet-comeback-of-listening') + `<div class="pop"><img src="${data(shots.popup)}"></div>`));
  await render('screenshot-3.png', slide('Voices that run on your computer', 'No account, no servers: pages never leave your browser', frame(data(shots.settings), 'Spokify settings')));
  await render('screenshot-4.png', slide('Ready in a minute', 'The voice downloads once, then works offline', frame(data(shots.welcome), 'Welcome to Spokify')));

  const promo = (w, h, big) => `<!doctype html><html><head><style>
    body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; font-family: -apple-system, 'Segoe UI', system-ui, sans-serif;
      background: linear-gradient(135deg, ${ACCENT} 0%, #1d4fc4 100%); color: #fff; display: flex; align-items: center; justify-content: center; gap: ${big ? 56 : 22}px; }
    svg { width: ${big ? 220 : 108}px; height: ${big ? 220 : 108}px; filter: drop-shadow(0 8px 18px rgba(0,0,0,.25)); }
    h1 { margin: 0; font-size: ${big ? 92 : 44}px; letter-spacing: -1px; }
    p { margin: ${big ? 12 : 6}px 0 0; font-size: ${big ? 32 : 17}px; line-height: 1.3; color: #dfe8ff; max-width: ${big ? 640 : 230}px; }
  </style></head><body>${icon}<div><h1>Spokify</h1><p>Natural voices read any page aloud, right on your computer</p></div></body></html>`;
  await render('promo-small-440x280.png', promo(440, 280, false), 440, 280);
  await render('promo-marquee-1400x560.png', promo(1400, 560, true), 1400, 560);
} finally {
  await browser.close();
  server.close();
}
