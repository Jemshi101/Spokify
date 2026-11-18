// Renders the extension icon SVG to PNGs with Chrome for Testing.
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';

const svg = readFileSync('tools/icon.svg', 'utf8');
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `static/icons/${size}.png`, omitBackground: true });
}
await browser.close();
console.log('icons written');
