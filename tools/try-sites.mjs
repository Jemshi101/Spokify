// Dev tool: shows what the extension would read on real pages (first/last sentences, count).
// Usage: node tools/try-sites.mjs <url> [url...]   (PDF URLs open in the extension's viewer)
import puppeteer from 'puppeteer';
import path from 'node:path';

const urls = process.argv.slice(2);
const browser = await puppeteer.launch({ headless: true, pipe: true, protocolTimeout: 90000, enableExtensions: [path.resolve('dist')], args: ['--mute-audio'] });
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what} timed out after ${ms / 1000}s`)), ms))]);
try {
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('sw.js'));
  const ext = await browser.newPage();
  await ext.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
  // Silence the engine: we only want extraction.
  await ext.evaluate(() => chrome.storage.sync.set({ settings: { engine: 'system', voice: 'af_heart', systemVoice: '', speed: 1 } }));
  for (const url of urls) {
    const page = await browser.newPage();
    try {
    const isPdf = /\.pdf($|[?#])|arxiv\.org\/pdf\//i.test(url);
    const target = isPdf ? `chrome-extension://${new URL(sw.url()).host}/pdf.html?file=${encodeURIComponent(url)}` : url;
    await page.goto(target, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    if (isPdf) await page.waitForFunction(() => document.querySelector('.page') && !document.getElementById('status').textContent, { timeout: 120000 });
    // The segments are read from the 'read' message the service worker forwards to the host.
    const out = await page.evaluate(() => document.title);
    const tabId = await ext.evaluate(async (u, pdf) => (await chrome.tabs.query({}))?.find((t) => (pdf ? t.url?.includes('/pdf.html') : t.url?.startsWith(u.slice(0, 30))))?.id, target, isPdf);
    const segs = await withTimeout(ext.evaluate(
      (id) =>
        new Promise((resolve) => {
          chrome.runtime.onMessage.addListener(function l(m) {
            if (m.target === 'host' && m.type === 'read') {
              chrome.runtime.onMessage.removeListener(l);
              resolve(m.segments.map((s) => s.text));
            }
          });
          chrome.runtime.sendMessage({ target: 'sw', type: 'extract', mode: 'page', tabId: id });
        }),
      tabId,
    ), 30000, 'extraction');
    await ext.evaluate(() => chrome.runtime.sendMessage({ target: 'sw', type: 'host', payload: { type: 'stop' } }));
    console.log(`\n== ${out} (${segs.length} segments)`);
    if (process.env.GREP) for (const t of segs.filter((x) => new RegExp(process.env.GREP).test(x))) console.log("  ≈", t.slice(0, 160));
    for (const t of segs.slice(0, 4)) console.log('  ▸', t.slice(0, 110));
    console.log('  …');
    for (const t of segs.slice(-3)) console.log('  ▸', t.slice(0, 110));
    } catch (e) {
      console.log(`\n== ${url}\n  ✖ ${e.message}`);
    }
    await page.close().catch(() => {});
  }
} finally {
  await browser.close();
}
