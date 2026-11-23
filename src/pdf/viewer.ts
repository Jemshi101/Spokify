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

/**
 * Each page's text layer is one block. Line breaks become spaces; paragraph breaks
 * (marked by markLines) become newlines, which end a sentence.
 */
const pdfOptions = {
  root: pagesEl,
  blockOf: (el: Element) => el.closest('.textLayer') ?? el,
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
