// PDF viewer: renders a PDF with pdf.js (canvas + text layer) and reads it with the shared reader.
// Chrome's built-in PDF viewer can't be scripted by extensions, so PDFs are reopened here.
import * as pdfjs from 'pdfjs-dist';
import { extractPage, extractSelection } from '../reader/extract';
import { createReader } from '../reader/reader';
import { pageKey } from '../reader/positions';

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdfjs/pdf.worker.mjs');

const params = new URLSearchParams(location.search);
const fileUrl = params.get('file') ?? '';
const autoplay = params.get('autoplay') === '1';

const $ = (id: string) => document.getElementById(id)!;
const pagesEl = $('pages');

/** A page that continues the previous page's sentence → the first page of that run. */
const continues = new WeakMap<Element, Element>();

/**
 * Each page's text layer is one block, except that a page continuing a sentence from the previous
 * page joins its block (see joinPages). Line breaks become spaces; paragraph breaks (marked by
 * markLines) become newlines, which end a sentence.
 */
const pdfOptions = {
  root: pagesEl,
  blockOf: (el: Element) => {
    const layer = el.closest('.textLayer');
    return (layer && continues.get(layer)) ?? layer ?? el;
  },
  brText: (br: Element) => (br.classList.contains('tts-para') ? '\n' : ' '),
};

/**
 * pdf.js only marks some line ends. Rebuild line and paragraph breaks from geometry:
 * a new line gets a <br>; a big vertical gap or a font-size change gets a paragraph <br>.
 */
function markLines(textLayer: HTMLElement) {
  let prev: DOMRect | null = null;
  for (const span of [...textLayer.querySelectorAll<HTMLElement>(':scope > span, .markedContent span')]) {
    if (!span.textContent?.trim()) continue;
    const r = span.getBoundingClientRect();
    if (prev) {
      const h = Math.max(r.height, 1);
      const nextColumn = r.top < prev.top - h; // jumped back up: next column
      const newLine = nextColumn || r.top > prev.top + h * 0.5 || r.left < prev.left - h;
      if (newLine) {
        const gap = r.top - prev.bottom;
        const sizeChange = Math.abs(r.height - prev.height) > 0.2 * h;
        const br = document.createElement('br');
        if (gap > h * 0.8 || sizeChange) br.className = 'tts-para';
        span.before(br);
      }
    }
    prev = r;
  }
}

/** Lines of a text layer: its spans, split at the <br>s markLines inserted. */
function linesOf(textLayer: Element): HTMLElement[][] {
  const lines: HTMLElement[][] = [];
  let cur: HTMLElement[] = [];
  for (const span of textLayer.querySelectorAll<HTMLElement>(':scope > span, .markedContent span')) {
    if (!span.textContent?.trim()) continue;
    if (cur.length && span.previousSibling?.nodeName === 'BR') {
      lines.push(cur);
      cur = [];
    }
    cur.push(span);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

const lineText = (line: HTMLElement[]) => line.map((s) => s.textContent).join('').replace(/\s+/g, ' ').trim();
const PAGE_NUMBER = /^(page\s*)?(\d{1,4}|[ivxlc]{1,6})(\s*(of|\/)\s*\d{1,4})?$/i;
const ENDS_SENTENCE = /[.!?:;]["'”’)\]]*$/;
/** A page starting like this begins something new even if the previous page stopped mid-sentence. */
const STARTS_NEW = /^(\d+(\.\d+)*\.?\s+\p{Lu}|(figure|fig\.|table|algorithm|listing)\s*\d)/iu;
const lineHeight = (line: HTMLElement[]) => Math.max(...line.map((s) => s.getBoundingClientRect().height));

/**
 * Lets sentences run across page breaks. Running headers and footers (page numbers, or edge lines
 * repeated on many pages) are skipped; then a page whose last line doesn't end a sentence is
 * continued by the next page, joined with a space.
 */
function joinPages(layers: HTMLElement[]) {
  const pages = layers.map(linesOf);
  const key = (line: HTMLElement[]) => lineText(line).replace(/\d+/g, '#').toLowerCase();
  const seen = new Map<string, number>();
  for (const lines of pages) {
    for (const k of new Set([lines[0], lines.at(-1)].filter(Boolean).map((l) => key(l!)))) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const repeated = (line: HTMLElement[]) => layers.length >= 3 && (seen.get(key(line)) ?? 0) >= Math.max(3, Math.ceil(layers.length / 3));
  const skip = (line: HTMLElement[]) => line.forEach((s) => s.setAttribute('data-nosnippet', ''));
  const kept = pages.map((lines) => {
    const out = [...lines];
    for (const edge of [0, -1]) {
      const line = out.at(edge);
      if (line && (PAGE_NUMBER.test(lineText(line)) || repeated(line))) {
        skip(line);
        out.splice(edge === 0 ? 0 : out.length - 1, 1);
        // Its line break goes too: a footer's paragraph break would otherwise still end the page's
        // last sentence (for a header, the break is the one before the next line).
        const brOf = edge === 0 ? out[0]?.[0] : line[0];
        if (brOf?.previousSibling?.nodeName === 'BR') brOf.previousSibling.remove();
      }
    }
    return out;
  });
  for (let i = 1; i < layers.length; i++) {
    const last = kept[i - 1].at(-1);
    const first = kept[i][0];
    if (!last || !first || ENDS_SENTENCE.test(lineText(last)) || STARTS_NEW.test(lineText(first))) continue;
    // Only clear continuations: the next page goes on in lowercase, or this one stopped on , - ( etc.
    if (!/^\p{Ll}/u.test(lineText(first)) && !/[,\-–—(]$/.test(lineText(last))) continue;
    // Body text continues in the same size; headings, captions and margin notes don't.
    const h = lineHeight(last);
    if (Math.abs(lineHeight(first) - h) > 0.15 * h) continue;
    continues.set(layers[i], continues.get(layers[i - 1]) ?? layers[i - 1]);
    layers[i].prepend(document.createElement('br')); // a space between the pages' words
  }
}

function setStatus(text: string, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.hidden = !text;
}

async function render() {
  if (!fileUrl) {
    setStatus('No PDF given.', true);
    return false;
  }
  $('open').setAttribute('href', fileUrl);
  const name = decodeURIComponent(fileUrl.split(/[?#]/)[0].split('/').pop() || 'PDF');
  document.title = name;
  $('name').textContent = name;
  setStatus('Loading PDF…');

  const assets = chrome.runtime.getURL('pdfjs/');
  let doc: pdfjs.PDFDocumentProxy;
  try {
    doc = await pdfjs.getDocument({
      url: fileUrl,
      cMapUrl: `${assets}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${assets}standard_fonts/`,
      wasmUrl: `${assets}wasm/`,
      iccUrl: `${assets}iccs/`,
      isEvalSupported: false,
    }).promise;
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    const hint = fileUrl.startsWith('file:') ? ' For local files, enable "Allow access to file URLs" for Spokify in chrome://extensions.' : '';
    setStatus(`Couldn't open this PDF: ${msg}.${hint}`, true);
    return false;
  }

  const meta = await doc.getMetadata().catch(() => null);
  const title = (meta?.info as { Title?: string } | undefined)?.Title?.trim();
  if (title) {
    document.title = title;
    $('name').textContent = title;
  }
  $('pagecount').textContent = `${doc.numPages} page${doc.numPages === 1 ? '' : 's'}`;

  const width = Math.min(900, document.documentElement.clientWidth - 32);
  const canvases: { canvas: HTMLCanvasElement; page: pdfjs.PDFPageProxy; viewport: pdfjs.PageViewport; drawn: boolean }[] = [];
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const c = canvases.find((x) => x.canvas === entry.target);
        if (!c || c.drawn) continue;
        c.drawn = true;
        const ratio = window.devicePixelRatio || 1;
        c.canvas.width = Math.floor(c.viewport.width * ratio);
        c.canvas.height = Math.floor(c.viewport.height * ratio);
        c.page.render({ canvas: c.canvas, viewport: c.viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined }).promise.catch(() => {});
      }
    },
    { rootMargin: '800px 0px' },
  );

  // Text layers for every page are built up front: reading needs all the text.
  for (let n = 1; n <= doc.numPages; n++) {
    setStatus(`Preparing page ${n} of ${doc.numPages}…`);
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = width / base.width;
    const viewport = page.getViewport({ scale });

    const pageEl = document.createElement('div');
    pageEl.className = 'page';
    pageEl.style.width = `${viewport.width}px`;
    pageEl.style.height = `${viewport.height}px`;
    pageEl.style.setProperty('--scale-factor', String(scale));
    pageEl.style.setProperty('--total-scale-factor', String(scale));
    pageEl.dataset.page = String(n);

    const canvas = document.createElement('canvas');
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const textLayer = document.createElement('div');
    textLayer.className = 'textLayer';
    pageEl.append(canvas, textLayer);
    pagesEl.appendChild(pageEl);

    await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textLayer, viewport }).render();
    markLines(textLayer);
    canvases.push({ canvas, page, viewport, drawn: false });
    io.observe(canvas);
  }
  joinPages([...pagesEl.querySelectorAll<HTMLElement>('.textLayer')]);
  setStatus('');
  return true;
}

async function main() {
  const tab = await chrome.tabs.getCurrent();
  const reader = createReader({
    tabId: tab?.id,
    extract: (mode, fromEl) => (mode === 'selection' ? extractSelection(pdfOptions) : extractPage(fromEl, pdfOptions)),
    positionKey: () => pageKey(fileUrl),
  });
  $('read').onclick = () => reader.start('page');
  const ok = await render();
  if (ok && autoplay) {
    history.replaceState(null, '', location.pathname + `?file=${encodeURIComponent(fileUrl)}`);
    reader.start('page');
  }
}

main();
