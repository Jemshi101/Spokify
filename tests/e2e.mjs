// End-to-end MVP checks in Chrome for Testing (headless). Run `npm run build` first.
// Usage: node tests/e2e.mjs [--engine=webgpu-fp32] [--skip-pause]
import puppeteer from 'puppeteer';
import http from 'node:http';
import path from 'node:path';
import { spectralSimilarity } from './audio.mjs';
import { freshExtensionScripts } from './profile.mjs';

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

// Shaped like Google Docs' HTML export: scoped c## classes, body class, a comment thread, a footnote.
const GDOC = `<html><head><meta content="text/html; charset=UTF-8" http-equiv="content-type"><style type="text/css">@import url(https://themes.googleusercontent.com/fonts/css?kit=x);.c1{font-weight:700}.c2{background-color:#ffffff;max-width:468pt;padding:72pt 72pt 72pt 72pt}body{color:#000}p{margin:0;font-size:11pt}h1{font-size:20pt}</style></head><body class="c2 doc-content">
<h1 id="h.a"><span>Quarterly plan</span></h1>
<p><span>Our team will ship the reader to more people this quarter.</span><sup><a href="#cmnt1" id="cmnt_ref1">[a]</a></sup><span>&nbsp;The main goal is better voices on slow laptops.</span></p>
<p><span class="c1">Second,</span><span>&nbsp;we will support documents written in Google Docs.</span><sup><a href="#ftnt1" id="ftnt_ref1">[1]</a></sup></p>
<ul><li><span>Fix the remaining highlighting bugs.</span></li><li><span>Measure how long the first sentence takes.</span></li></ul>
<p><span>Finally, we will ask readers what they think and adjust the plan.</span></p>
<hr><div><p><a href="#ftnt_ref1" id="ftnt1">[1]</a><span>&nbsp;Docs draws text on a canvas, so we read the export.</span></p></div>
<div><p><a href="#cmnt_ref1" id="cmnt1">[a]</a><span>Reviewer comment that must never be read aloud.</span></p></div>
</body></html>`;
// A list of entries (like GitHub releases) where the longest entry is the last one.
const RELEASES = `<!doctype html><html><head><title>Releases</title></head><body><header><nav><a href="/">Home</a></nav></header>
<main><h1>Releases</h1>
${[
  ['Version three', 'This newest release adds a jump button to the player. It also lets you change the voice while reading.'],
  ['Version two', 'This release fixes the robotic voice on some computers. The default engine changed to a safer one.'],
  ['Version one', 'The first release could read web pages aloud with natural voices, highlight each word as it was spoken, keep playing in the background, and remember where you stopped. It also had keyboard shortcuts, a floating player with speed control, and a right-click menu for reading a selection, a whole page or a linked PDF document.'],
].map(([t, b]) => `<section class="release"><div class="box"><div class="box-body"><h2>${t}</h2><div class="markdown-body"><p>${b}</p></div></div></div></section>`).join('\n')}
</main></body></html>`;
// Like an e-learning lesson (Articulate Rise): content scrolls inside a panel, blocks are nested deep,
// a closed accordion hides a long transcript that must not be read, and the longest text sits in a
// tab panel 12 levels below its lesson block, with screen-reader-only "(opens in a new tab)" in a link.
// ARIA tabs and an ARIA carousel: closed tabs and hidden slides are read too, and switched to when reading
// reaches them. The takeaway has double spaces in its HTML (word highlights must not shift).
const deep = (html) => '<div><div><div class="row"><div class="col"><div class="view"><div>' + html + '</div></div></div></div></div></div>';
const COURSE = `<!doctype html><html><head><title>Lesson</title><style>html,body{margin:0;height:100%;overflow:hidden}#scroller{height:100%;overflow:auto}.gap{height:1600px}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}</style></head><body>
<header class="bar"><h1>Introduction to agents</h1></header>
<div id="scroller"><main><div class="lesson">
${[
  '<h2>Introduction to agents</h2><p>An agent is a software system that works toward a goal for you, usually with a language model. It decides which steps to take, which tools to use, and when the job is done.</p><div class="gap"></div>',
  '<h2>Agents versus chatbots</h2><p>Chatbots follow fixed scripts, answer one question at a time, and stay inside a single source of data. Agents, by contrast, plan several steps, call tools, and keep going until the task is finished.</p>',
  '<div class="tabs">' + '<div>'.repeat(4) + '<div class="tab-panel"><p>Business users can build agents without code, using tools like <a href="#">Agent Designer<span class="sr">(opens in a new tab)</span></a> and visual workflow builders, which guide them step by step, suggest actions, connect to data, and publish the finished agent for the whole team.</p><p>Developers, meanwhile, write agents in code with an open-source kit, test them locally, deploy them to managed runtimes, and watch them with logs, traces, and evaluations.</p></div><div class="tab-panel" style="display:none"><p>Hidden tab text.</p></div>' + '</div>'.repeat(4) + '</div>',
  '<section class="accordion"><button>Show transcript</button><section class="accordion__content" style="display:none"><p>Speaker one: this hidden transcript is long, much longer than anything else on the page, and it rambles on about many things, one after another, with commas, clauses, asides, and more commas, so that a text-length score would pick it first.</p><p>Speaker two: indeed, and it keeps going, sentence after sentence, paragraph after paragraph, none of which is visible on the screen.</p></section></section>',
  '<div class="aria-tabs"><div role="tablist"><button role="tab" id="tab-a" aria-controls="panel-a" aria-selected="true">Overview</button><button role="tab" id="tab-b" aria-controls="panel-b" aria-selected="false">Pricing</button></div><div role="tabpanel" id="panel-a"><p>The overview tab says what agents do.</p></div><div role="tabpanel" id="panel-b" hidden><p>The pricing tab explains what agents cost to run.</p></div></div>',
  '<div role="region" aria-roledescription="carousel" aria-label="Steps"><button aria-label="Previous slide">‹</button><button aria-label="Next slide">›</button><div class="slides"><div role="group" aria-roledescription="slide"><p>Step one is to plan the task.</p></div><div role="group" aria-roledescription="slide" hidden inert><p>Step two is to connect the tools.</p></div></div></div>',
  '<h2>Key takeaway</h2><p>Agents  plan,  use tools, and carry a task through to the end, within the limits you set. They are used for travel, scheduling, support, and software work.</p>',
].map((b) => '<div class="block">' + deep(b) + '</div>').join('\n')}
</div></main></div>
<script>
for (const t of document.querySelectorAll('[role=tab]')) t.onclick = () => {
  for (const u of document.querySelectorAll('[role=tab]')) {
    u.setAttribute('aria-selected', String(u === t));
    document.getElementById(u.getAttribute('aria-controls')).hidden = u !== t;
  }
};
// Like Rise: the slide changes after an animation.
const slides = [...document.querySelectorAll('[aria-roledescription=slide]')];
const go = (d) => setTimeout(() => {
  const i = slides.findIndex((s) => !s.hidden), j = Math.min(Math.max(i + d, 0), slides.length - 1);
  slides.forEach((s, k) => { s.hidden = k !== j; s.inert = k !== j; });
}, 300);
document.querySelector('[aria-label="Next slide"]').onclick = () => go(1);
document.querySelector('[aria-label="Previous slide"]').onclick = () => go(-1);
</script></body></html>`;
const OTHER = '<!doctype html><title>Other</title><p>Another page.</p>';

let pdfBytes = null;
let longPdfBytes = null;
// Two A6 pages: the long sentence starts at the bottom of page 1 and ends on page 2; footers carry page numbers.
const CROSS = 'The reader keeps going across the page break because this sentence continues on the next page without stopping anywhere in between, and it should be heard as one.';
const LONG_DOC = `<!doctype html><html><body style="margin:0;font:12pt serif;orphans:1;widows:1"><div style="height:106mm"></div>
<p>${CROSS}</p><p>After that, a short closing sentence ends the document.</p></body></html>`;
const server = http
  .createServer((req, res) => {
    if (req.url === '/course') return res.writeHead(200, { 'content-type': 'text/html' }).end(COURSE);
    if (req.url === '/releases') return res.writeHead(200, { 'content-type': 'text/html' }).end(RELEASES);
    if (req.url === '/gdoc') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(GDOC);
    if (req.url === '/long.pdf') return res.writeHead(200, { 'content-type': 'application/pdf', 'access-control-allow-origin': '*' }).end(longPdfBytes);
    if (req.url === '/doc.pdf') return res.writeHead(200, { 'content-type': 'application/pdf', 'access-control-allow-origin': '*' }).end(pdfBytes);
    res.writeHead(200, { 'content-type': 'text/html' }).end(req.url === '/other' ? OTHER : ARTICLE);
  })
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
  userDataDir: freshExtensionScripts(path.resolve('.e2e-profile')), // keeps downloaded models cached between runs
  enableExtensions: [path.resolve('dist')],
  args: ['--mute-audio', '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required'],
});

try {
  {
    const p = await browser.newPage();
    await p.setContent(ARTICLE.replace(/<header>[\s\S]*?<\/header>|<aside>[\s\S]*?<\/aside>|<footer>[\s\S]*?<\/footer>/g, ''));
    pdfBytes = Buffer.from(await p.pdf({ format: 'A4' }));
    await p.setContent(LONG_DOC);
    longPdfBytes = Buffer.from(await p.pdf({ format: 'A6', margin: { top: '10mm', bottom: '15mm', left: '10mm', right: '10mm' }, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:9pt;width:100%;text-align:center"><span class="pageNumber"></span></div>' }));
    await p.close();
  }
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('sw.js'));
  const extId = new URL(sw.url()).host;
  const ext = await browser.newPage();
  await ext.goto(`chrome-extension://${extId}/popup.html`);
  const call = (msg) => ext.evaluate((m) => chrome.runtime.sendMessage({ target: 'sw', ...m }), msg);
  const status = () => call({ type: 'host', payload: { type: 'status' } });
  const setSettings = (s) => ext.evaluate((v) => chrome.storage.sync.set({ settings: { systemVoice: '', ...v } }), s);
  const waitFor = async (fn, ms = 60000) => {
    const end = Date.now() + ms;
    let v;
    while (!(v = await fn()) && Date.now() < end) await sleep(100);
    return v;
  };

  await ext.evaluate(() => chrome.storage.local.remove('positions'));
  await ext.evaluate(() => chrome.storage.local.set({ testMute: true })); // keep the run silent
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

  // --- player: jump back to the highlight, and change the voice (the player is a closed shadow root:
  // DevTools' DOM domain can see inside it)
  {
    await page.bringToFront();
    const cdp = await page.createCDPSession();
    const inPlayer = async (selector) => {
      const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const shadows = [];
      const walk = (n) => { for (const s of n.shadowRoots ?? []) shadows.push(s); for (const c of n.children ?? []) walk(c); };
      walk(root);
      for (const s of shadows) {
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: s.nodeId, selector }).catch(() => ({ nodeId: 0 }));
        if (nodeId) return nodeId;
      }
      return 0;
    };
    const clickInPlayer = async (selector) => {
      const nodeId = await inPlayer(selector);
      const box = nodeId && (await cdp.send('DOM.getBoxModel', { nodeId }).catch(() => null));
      if (!box) return false;
      const q = box.model.content;
      await page.mouse.click((q[0] + q[4]) / 2, (q[1] + q[5]) / 2);
      return true;
    };
    await ext.evaluate(() => chrome.storage.local.remove('positions'));
    await setSettings({ engine, voice: 'af_heart', speed: 1 });
    await page.goto(`${base}/article`);
    await page.evaluate(() => (document.body.style.paddingBottom = '4000px'));
    await call({ type: 'extract', mode: 'page', tabId });
    await waitFor(async () => (await state()).sentence);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const shown = await waitFor(() => page.evaluate(() => document.documentElement.dataset.ttsLocate === 'true'), 5000);
    const clicked = shown && (await clickInPlayer('button[data-a="locate"]'));
    const back = clicked && (await waitFor(() => page.evaluate(() => document.documentElement.dataset.ttsLocate === 'false' && scrollY < 1500), 5000));
    check('player jumps back to the highlight', !!shown && !!back, `button shown ${!!shown}, clicked ${!!clicked}, back in view ${!!back}`);

    const opened = await clickInPlayer('button[data-a="voice"]');
    // The menu opens after asking the host what is speaking: wait for it.
    const select = opened && (await waitFor(() => inPlayer('.menu:not([hidden]) select'), 5000));
    if (select) {
      await cdp.send('DOM.focus', { nodeId: select });
      await page.keyboard.press('ArrowDown');
    }
    const voice = await waitFor(async () => { const v = (await ext.evaluate(async () => (await chrome.storage.sync.get('settings')).settings?.voice)); return v !== 'af_heart' && v; }, 5000);
    check('player changes the voice', !!voice, `menu ${select ? 'opened' : 'missing'}, voice now ${voice}`);
    await call({ type: 'host', payload: { type: 'stop' } });
    await setSettings({ engine, voice: 'af_heart', speed: 2.5 });
  }

  // --- select text → a Read button appears next to it → only the selection is read
  {
    const cdp = await page.createCDPSession();
    const inShadow = async (selector) => {
      const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const shadows = [];
      const walk = (n) => { for (const s of n.shadowRoots ?? []) shadows.push(s); for (const c of n.children ?? []) walk(c); };
      walk(root);
      for (const s of shadows) {
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: s.nodeId, selector }).catch(() => ({ nodeId: 0 }));
        if (nodeId) return nodeId;
      }
      return 0;
    };
    const boxOf = async (nodeId) => (nodeId ? (await cdp.send('DOM.getBoxModel', { nodeId }).catch(() => null))?.model.content : null);
    const segsNext = () =>
      ext.evaluate(() => new Promise((ok) => chrome.runtime.onMessage.addListener(function l(m) {
        if (m.target === 'host' && m.type === 'read') { chrome.runtime.onMessage.removeListener(l); ok(m.segments.map((s) => s.text)); }
      })));
    await setSettings({ engine: 'system', voice: 'af_heart', speed: 2 });
    await page.goto(`${base}/article`);
    await page.bringToFront();
    // Triple-click selects the whole paragraph, like a user would.
    const para = await page.$('main .content p:nth-of-type(5)');
    await para.click({ count: 3 });
    const btn = await waitFor(async () => { const q = await boxOf(await inShadow('button[aria-label="Read the selection aloud"]')); return q && q[2] - q[0] > 0 && q; }, 3000);
    const sel1 = segsNext();
    if (btn) await page.mouse.click((btn[0] + btn[4]) / 2, (btn[1] + btn[5]) / 2);
    const picked = btn ? await Promise.race([sel1, sleep(10000).then(() => [])]) : [];
    check('selecting text shows a Read button that reads just the selection', !!btn && picked.length === 2 && picked[0].startsWith('Reading along also helps'), JSON.stringify(picked));
    await call({ type: 'host', payload: { type: 'stop' } });

    // The shortcut (extract mode 'auto') reads the selection when there is one.
    await para.click({ count: 3 });
    const sel2 = segsNext();
    await call({ type: 'extract', mode: 'auto', tabId });
    const viaKey = await Promise.race([sel2, sleep(10000).then(() => [])]);
    check('the shortcut reads the selection when text is selected', viaKey.length === 2 && viaKey[0].startsWith('Reading along also helps'), JSON.stringify(viaKey));
    await call({ type: 'host', payload: { type: 'stop' } });
    await page.evaluate(() => getSelection().removeAllRanges());

    // While reading, hovering a sentence shows a play button that continues from there.
    await ext.evaluate(() => chrome.storage.local.remove('positions'));
    await call({ type: 'extract', mode: 'page', tabId });
    await waitFor(async () => (await state()).sentence, 10000);
    const target = await page.$('main .content p:nth-of-type(4)');
    const tb = await target.boundingBox();
    await page.mouse.move(tb.x + 40, tb.y + 8);
    await page.mouse.move(tb.x + 60, tb.y + 10);
    const play = await waitFor(async () => { const q = await boxOf(await inShadow('button[aria-label="Read from here"]')); return q && q[2] - q[0] > 0 && q; }, 3000);
    const jump = ext.evaluate(() => new Promise((ok) => chrome.runtime.onMessage.addListener(function l(m) {
      if (m.target === 'host' && m.type === 'read') { chrome.runtime.onMessage.removeListener(l); ok({ startAt: m.startAt, text: m.segments[m.startAt]?.text }); }
    })));
    if (play) await page.mouse.click((play[0] + play[4]) / 2, (play[1] + play[5]) / 2);
    const jumped = play ? await Promise.race([jump, sleep(10000).then(() => null)]) : null;
    const paraText = await target.evaluate((p) => p.textContent.replace(/\s+/g, ' '));
    const nowAt = jumped && (await waitFor(async () => { const x = await state(); return x.sid === jumped.startAt && x; }, 10000));
    check('hovering a sentence while reading shows a play button that continues from there',
      !!play && jumped?.startAt > 0 && paraText.includes(jumped.text.slice(0, 30)) && !!nowAt, JSON.stringify({ play: !!play, jumped }));
    await call({ type: 'host', payload: { type: 'stop' } });
    await page.mouse.move(1, 1);
    await setSettings({ engine, voice: 'af_heart', speed: 2.5 });
  }

  // --- stop on navigation
  await page.bringToFront();
  await call({ type: 'extract', mode: 'page', tabId });
  while (!(await state()).sentence) await sleep(50);
  await page.goto(`${base}/other`);
  await sleep(1500);
  const after = await status();
  check('stops when the reading tab navigates away', !after.active, JSON.stringify({ active: after.active }));

  // --- resume where you left off
  await page.goto(`${base}/article`);
  await page.bringToFront();
  await setSettings({ engine, voice: 'af_heart', speed: 2 });
  await call({ type: 'extract', mode: 'page', tabId });
  await waitFor(async () => (await state()).sid >= 3);
  await call({ type: 'host', payload: { type: 'stop' } });
  await sleep(500);
  const resumed = await call({ type: 'extract', mode: 'page', tabId });
  const firstSid = (await waitFor(async () => { const x = await state(); return x.sentence && x; }))?.sid;
  check('resumes where reading stopped', resumed?.startAt >= 3 && firstSid >= 3, `startAt ${resumed?.startAt}, first sentence ${firstSid + 1}`);
  await call({ type: 'host', payload: { type: 'stop' } });

  // --- lite mode: system voices with live word events
  await ext.evaluate(() => chrome.storage.local.remove('positions'));
  await setSettings({ engine: 'system', voice: 'af_heart', speed: 1.5 });
  const env = await call({ type: 'host', payload: { type: 'env' } });
  if (!env.host?.systemVoices) {
    console.log('⚠️  lite mode skipped: no system voices in this browser');
  } else {
    await page.goto(`${base}/article`);
    await page.bringToFront();
    await call({ type: 'extract', mode: 'page', tabId });
    const seenWords = new Set();
    let lite;
    const endLite = Date.now() + 40000;
    while (Date.now() < endLite) {
      lite = await state();
      if (lite.word) seenWords.add(`${lite.sid}:${lite.word}`);
      if (lite.sid >= 2 && seenWords.size >= 15) break;
      await sleep(30);
    }
    const st2 = await status();
    check('lite mode reads with system voices', st2.engine === 'system' && lite?.sid >= 1, `engine ${st2.engine}, sentence ${lite?.sid + 1}`);
    check('lite mode highlights words from boundary events', seenWords.size >= 10, `${seenWords.size} words`);
    await call({ type: 'host', payload: { type: 'stop' } });

    // --- the chosen Lite voice is the one that speaks (not the system default)
    const local = env.host.voices.filter((v) => / \| en[-_]/i.test(v) && !/online|default/.test(v)).map((v) => v.split(' | ')[0]);
    const wanted = local[Math.min(3, local.length - 1)];
    if (wanted) {
      await setSettings({ engine: 'system', voice: 'af_heart', speed: 1.5, systemVoice: wanted });
      await page.goto(`${base}/article`);
      await page.bringToFront();
      await call({ type: 'extract', mode: 'page', tabId });
      const vs = await waitFor(async () => { const x = await status(); return x.voice && x; }, 20000);
      check('lite mode uses the chosen system voice', vs?.voice === wanted, `chose "${wanted}", speaking "${vs?.voice}"`);
      await call({ type: 'host', payload: { type: 'stop' } });
    }

    // --- Auto on a GPU too slow for natural voices switches to Lite voices and remembers it.
    // This GPU is fast, so the test raises the bar (testSlowRealtime) instead.
    await ext.evaluate(() => chrome.storage.local.set({ testSlowRealtime: 100 }));
    await ext.evaluate(() => chrome.storage.local.remove(['gpuSlow', 'stSlow', 'positions']));
    await setSettings({ engine: 'auto', voice: 'af_heart', speed: 1.5 });
    await page.goto(`${base}/article`);
    await page.bringToFront();
    await call({ type: 'extract', mode: 'page', tabId });
    const slowSt = await waitFor(async () => { const x = await status(); return x.engine === 'piper' && x.sid != null && x; }, 240000);
    const flags = await ext.evaluate(async () => chrome.storage.local.get(['gpuSlow', 'stSlow']));
    check('Auto steps down Kokoro → Supertonic → Piper when each is too slow', !!slowSt && !!flags.gpuSlow?.realtime && !!flags.stSlow?.realtime,
      `engine ${slowSt?.engine} (${slowSt?.voice}); Kokoro measured ${flags.gpuSlow?.realtime}×, Supertonic ${flags.stSlow?.realtime}× real time`);
    await call({ type: 'host', payload: { type: 'stop' } });
    await ext.evaluate(() => chrome.storage.local.remove(['testSlowRealtime', 'gpuSlow', 'stSlow']));
  }
  await setSettings({ engine, voice: 'af_heart', speed: 2.5 });

  // --- Supertonic (CPU): reads with word highlighting, faster than real time
  {
    await ext.evaluate(() => chrome.storage.local.remove('positions'));
    await setSettings({ engine: 'supertonic', voice: 'af_heart', supertonicVoice: 'F1', speed: 1 });
    await page.goto(`${base}/article`);
    await page.bringToFront();
    await call({ type: 'extract', mode: 'page', tabId });
    const sw2 = new Set();
    const endS = Date.now() + 180000;
    while (Date.now() < endS) {
      const x = await state();
      if (x.word) sw2.add(`${x.sid}:${x.word}`);
      if (sw2.size >= 15) break;
      await sleep(40);
    }
    const ss = await status();
    const srt = ss?.stats?.genMs ? ss.stats.audioSec / (ss.stats.genMs / 1000) : 0;
    check('Supertonic reads with word highlighting', ss?.engine === 'supertonic' && sw2.size >= 15, `${sw2.size} words, voice ${ss?.voice}`);
    check('Supertonic runs faster than real time on the CPU', srt > 2, `${srt.toFixed(1)}× real time`);
    await call({ type: 'host', payload: { type: 'stop' } });
    await setSettings({ engine, voice: 'af_heart', speed: 2.5 });
  }

  // --- Piper (CPU voices): reads with word highlighting, faster than real time
  {
    await ext.evaluate(() => chrome.storage.local.remove('positions'));
    await setSettings({ engine: 'piper', voice: 'af_heart', piperVoice: 'en_US-lessac-medium', speed: 1 });
    await page.goto(`${base}/article`);
    await page.bringToFront();
    await call({ type: 'extract', mode: 'page', tabId });
    const pw = new Set();
    let ps;
    const endP = Date.now() + 90000;
    while (Date.now() < endP) {
      const x = await state();
      if (x.word) pw.add(`${x.sid}:${x.word}`);
      if (pw.size >= 15) break;
      await sleep(40);
    }
    ps = await status();
    const rt = ps?.stats?.genMs ? ps.stats.audioSec / (ps.stats.genMs / 1000) : 0;
    check('Piper reads with word highlighting', ps?.engine === 'piper' && pw.size >= 15, `${pw.size} words, voice ${ps?.voice}`);
    check('Piper runs faster than real time on the CPU', rt > 2, `${rt.toFixed(1)}× real time`);
    await call({ type: 'host', payload: { type: 'stop' } });
    await setSettings({ engine, voice: 'af_heart', speed: 2.5 });
  }

  // --- PDF viewer (PDF printed by Chrome from the test article)
  const pdfUrl = `${base}/doc.pdf`;
  const pdfPage = await browser.newPage();
  await pdfPage.goto(`chrome-extension://${extId}/pdf.html?file=${encodeURIComponent(pdfUrl)}&autoplay=1`);
  const pdfState = () => pdfPage.evaluate(() => {
    const d = document.documentElement.dataset.ttsReader;
    const h = (n) => (CSS.highlights.get(n) ? [...CSS.highlights.get(n)][0].toString() : null);
    return { ...(d ? JSON.parse(d) : {}), pages: document.querySelectorAll('.page').length, sentence: h('tts-sentence'), word: h('tts-word') };
  });
  const p1 = await waitFor(async () => { const x = await pdfState(); return x.sentence && x; }, 60000);
  check('PDF viewer renders and starts reading', !!p1 && p1.pages >= 1, p1 ? `${p1.pages} page(s), "${p1.sentence?.slice(0, 40)}…"` : 'no sentence');
  const pdfWords = new Set();
  const endPdf = Date.now() + 20000;
  while (Date.now() < endPdf && pdfWords.size < 15) {
    const x = await pdfState();
    if (x.word) pdfWords.add(`${x.sid}:${x.word}`);
    await sleep(40);
  }
  const pdfSentences = p1?.total ?? 0;
  check('PDF text joins lines into sentences', pdfSentences >= 8 && pdfSentences <= 14, `${pdfSentences} segments`);
  check('PDF word highlighting advances', pdfWords.size >= 10, `${pdfWords.size} words`);
  await call({ type: 'host', payload: { type: 'stop' } });

  // --- PDF: a sentence across a page break is read as one; page-number footers are skipped
  const segsOf = () =>
    ext.evaluate(() => new Promise((ok) => chrome.runtime.onMessage.addListener(function l(m) {
      if (m.target === 'host' && m.type === 'read') {
        chrome.runtime.onMessage.removeListener(l);
        ok(m.segments.map((s) => s.text));
      }
    })));
  const longSegs = segsOf();
  const longPage = await browser.newPage();
  await longPage.goto(`chrome-extension://${extId}/pdf.html?file=${encodeURIComponent(`${base}/long.pdf`)}&autoplay=1`);
  const ls = await Promise.race([longSegs, sleep(30000).then(() => [])]);
  const pageCount = await longPage.evaluate(() => document.querySelectorAll('.page').length);
  check('PDF sentence across a page break is read whole; page numbers skipped',
    // The sentence (longer than one chunk) may be cut at its comma, but never at the page break.
    pageCount >= 2 && ls.join(' ').includes(CROSS) && !ls.some((t) => /next page$/.test(t)) && !ls.some((t) => /\b\d+$/.test(t)),
    `${pageCount} pages: ${JSON.stringify(ls.map((t) => t.slice(0, 32)))}`);
  await call({ type: 'host', payload: { type: 'stop' } });
  await longPage.close();

  // --- Google Docs reader (local fixture in place of Google's export)
  const gdocPage = await browser.newPage();
  await gdocPage.goto(`chrome-extension://${extId}/docs.html?` + new URLSearchParams({ export: `${base}/gdoc`, title: 'Quarterly plan - Google Docs', autoplay: '1' }));
  const gdocState = () => gdocPage.evaluate(() => {
    const d = document.documentElement.dataset.ttsReader;
    const h = (n) => (CSS.highlights.get(n) ? [...CSS.highlights.get(n)][0].toString() : null);
    const doc = document.getElementById('doc');
    return { ...(d ? JSON.parse(d) : {}), text: doc.textContent, cls: doc.className, title: document.title, sentence: h('tts-sentence'), word: h('tts-word'), padding: getComputedStyle(doc).paddingLeft };
  });
  const g1 = await waitFor(async () => { const x = await gdocState(); return x.sentence && x; }, 60000);
  check('Google Docs reader renders the export and starts reading', !!g1 && g1.title === 'Quarterly plan' && g1.cls.includes('doc-content') && g1.padding === '96px', g1 ? `"${g1.sentence?.slice(0, 40)}…", padding ${g1.padding}` : 'no sentence');
  check('Google Docs comments and footnote markers are not read', !!g1 && !/Reviewer comment|\[a\]|\[1\]/.test(g1.text) && g1.text.includes('Docs draws text on a canvas') && g1.text.includes('Our team will ship') && g1.total === 8, g1 ? `${g1.total} segments` : '');
  const gdocWords = new Set();
  const endGdoc = Date.now() + 20000;
  while (Date.now() < endGdoc && gdocWords.size < 12) {
    const x = await gdocState();
    if (x.word) gdocWords.add(`${x.sid}:${x.word}`);
    await sleep(40);
  }
  check('Google Docs word highlighting advances', gdocWords.size >= 10, `${gdocWords.size} words`);
  await call({ type: 'host', payload: { type: 'stop' } });

  // --- a page of repeated entries is read from the first entry, not just the longest one
  {
    const relSegs = segsOf();
    await page.goto(`${base}/releases`);
    await page.bringToFront();
    await call({ type: 'extract', mode: 'page', tabId });
    const rs = await Promise.race([relSegs, sleep(30000).then(() => [])]);
    check('lists of entries (e.g. GitHub releases) are read from the first entry', rs[0] === 'Releases' && rs[1] === 'Version three' && rs.includes('Version one'), JSON.stringify(rs.slice(0, 3)));
    await call({ type: 'host', payload: { type: 'stop' } });
  }

  // --- e-learning style page: headings read, hidden accordion text skipped, inner panel scrolls along
  {
    await setSettings({ engine: 'system', voice: 'af_heart', speed: 2 });
    const cSegs = segsOf();
    await page.goto(`${base}/course`);
    await page.bringToFront();
    await call({ type: 'extract', mode: 'page', tabId });
    const cs = await Promise.race([cSegs, sleep(30000).then(() => [])]);
    check('lesson pages read every block (deep tab panels too) and skip hidden and screen-reader-only text',
      cs[0] === 'Introduction to agents' && cs.filter((t) => t === 'Introduction to agents').length === 1 && cs.includes('Key takeaway') && cs.includes('Agents versus chatbots') && !cs.some((t) => /Speaker|opens in a new tab|Hidden tab/.test(t))
        && cs.some((t) => /like Agent Designer and visual/.test(t)),
      JSON.stringify(cs));
    const tabOrder = ['Overview', 'The overview tab says what agents do.', 'Pricing', 'The pricing tab explains what agents cost to run.'].map((t) => cs.indexOf(t));
    check('closed tabs are read, each after its tab name', tabOrder.every((i, k) => i >= 0 && (k === 0 || i === tabOrder[k - 1] + 1)), JSON.stringify(tabOrder));
    const scrolled = await waitFor(() => page.evaluate(() => document.getElementById('scroller').scrollTop > 500), 20000);
    check('auto-scroll follows text inside a scrolling panel', !!scrolled, `panel scrollTop ${await page.evaluate(() => Math.round(document.getElementById('scroller').scrollTop))}`);
    const atPricing = await waitFor(async () => /pricing tab explains/.test((await state()).sentence ?? ''), 60000);
    const shown = await page.evaluate(() => ({ selected: document.getElementById('tab-b').getAttribute('aria-selected'), visible: document.getElementById('panel-b').checkVisibility(), other: document.getElementById('panel-a').hidden }));
    check('reading switches to a closed tab when it gets there', !!atPricing && shown.selected === 'true' && shown.visible && shown.other, JSON.stringify({ atPricing: !!atPricing, ...shown }));
    check('hidden carousel slides are read in order', cs.indexOf('Step two is to connect the tools.') === cs.indexOf('Step one is to plan the task.') + 1, JSON.stringify(cs.filter((t) => /^Step/.test(t))));
    const atStep2 = await waitFor(async () => /Step two/.test((await state()).sentence ?? ''), 30000);
    const slideShown = await waitFor(() => page.evaluate(() => !document.querySelectorAll('[aria-roledescription=slide]')[1].hidden), 3000);
    check('reading moves the carousel to a hidden slide when it gets there', !!atStep2 && !!slideShown, JSON.stringify({ atStep2: !!atStep2, slideShown: !!slideShown }));
    // Word highlights stay on whole words after collapsed double spaces.
    await waitFor(async () => /^Agents\s+plan/.test((await state()).sentence ?? ''), 30000);
    const words = new Set();
    for (const end = Date.now() + 8000; Date.now() < end && /^Agents\s+plan/.test((await state()).sentence ?? '');) {
      const w = (await state()).word;
      if (w) words.add(w);
      await sleep(30);
    }
    const bad = [...words].filter((w) => !/^[\p{L}\p{N}][\p{L}\p{N},.]*$/u.test(w) || !'Agents plan, use tools, and carry a task through to the end, within the limits you set.'.split(' ').includes(w.replace(/[,.]$/, '')) && !'Agents plan, use tools, and carry a task through to the end, within the limits you set.'.includes(w));
    check('word highlights stay on whole words after double spaces', words.size >= 5 && !bad.length, JSON.stringify({ words: [...words], bad }));
    await call({ type: 'host', payload: { type: 'stop' } });
    await setSettings({ engine, voice: 'af_heart', speed: 2.5 });
  }

  // --- welcome page
  const welcome = await browser.newPage();
  await welcome.goto(`chrome-extension://${extId}/welcome.html`);
  const wText = await waitFor(() => welcome.$eval('#engineText', (e) => (e.textContent.includes('Checking') ? '' : e.textContent)), 10000);
  const voiceCount = await welcome.$eval('#voice', (e) => e.options.length);
  check('welcome page detects the engine and lists voices', !!wText && voiceCount > 5, `${voiceCount} voices`);

  // --- voice quality: the default engine must sound like the CPU reference (catches garbled output,
  // e.g. WebGPU fp16, which is fast and well-timed but unintelligible).
  const rendered = await welcome.evaluate(async () => {
    const text = 'Hi! I can read any web page or PDF to you, and highlight each word as I go.';
    const w = new Worker(new URL('worker.js', location.href), { type: 'module' });
    let n = 0;
    const call = (method, params) =>
      new Promise((ok, no) => {
        const id = ++n;
        const h = ({ data }) => {
          if (data.id !== id) return;
          w.removeEventListener('message', h);
          data.error ? no(new Error(data.error)) : ok(data.result);
        };
        w.addEventListener('message', h);
        w.postMessage({ id, method, params });
      });
    const out = {};
    for (const engine of ['auto', 'wasm-q8']) {
      const r = await call('generate', { text, words: [], voice: 'af_heart', speed: 1, engine });
      out[engine] = { engine: r.engine, samples: Array.from(r.samples) };
    }
    w.terminate();
    return out;
  });
  const similarity = spectralSimilarity(rendered.auto.samples, rendered['wasm-q8'].samples);
  check(`default voice (${rendered.auto.engine}) matches the CPU reference`, similarity > 0.6, `spectral similarity ${similarity.toFixed(2)}`);

  const r = await call({ type: 'host', payload: { type: 'env' } });
  console.log('engine:', JSON.stringify(r.worker?.loaded), 'last session stats:', JSON.stringify(st.stats));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
