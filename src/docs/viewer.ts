// Google Docs reader: shows a Doc's HTML export and reads it with the shared reader.
// The Docs editor draws text on a canvas, which extensions can't read or highlight.
import { extractPage, extractSelection } from '../reader/extract';
import { createReader } from '../reader/reader';
import { pageKey } from '../reader/positions';
import { docTitle, editUrl, exportUrl, parseDocUrl, scopeSelector } from './gdoc';

const params = new URLSearchParams(location.search);
const ref = parseDocUrl(params.get('doc') ?? '');
const autoplay = params.get('autoplay') === '1';
const autoSummarize = params.get('summarize') === '1';
// Tests serve a fixture instead of Google's export; only loopback URLs are accepted.
const fixture = params.get('export');
const source = fixture && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(fixture) ? fixture : ref ? exportUrl(ref) : null;

const $ = (id: string) => document.getElementById(id)!;
const docEl = $('doc');
const readOptions = { root: docEl };

function setStatus(text: string, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.hidden = !text;
}

class LoadError extends Error {}

async function fetchExport(url: string): Promise<Document> {
  let r: Response;
  try {
    r = await fetch(url, { credentials: 'include' });
  } catch (e) {
    throw new LoadError(`Couldn't reach Google Docs (${(e as Error).message}). Check your connection.`);
  }
  if (/accounts\.google\.com/.test(new URL(r.url).host)) {
    throw new LoadError('Sign in to Google in this browser with an account that can open this document, then try again.');
  }
  if (r.status === 403) {
    throw new LoadError("Google won't export this document. The owner may have turned off downloading and copying for viewers.");
  }
  if (r.status === 404) throw new LoadError("This document doesn't exist, or your Google account can't open it.");
  if (!r.ok) throw new LoadError(`Google Docs answered with an error (${r.status}).`);
  const html = await r.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (doc.querySelector('form[action*="ServiceLogin"], #gaia_loginform')) {
    throw new LoadError('Sign in to Google in this browser with an account that can open this document, then try again.');
  }
  return doc;
}

/** The export's stylesheet, scoped to #doc so it can't restyle the reader around it. */
function adoptStyles(src: Document, bodyClasses: string[]) {
  const scope = (rules: CSSRuleList) => {
    for (const rule of [...rules]) {
      if (rule instanceof CSSStyleRule) rule.selectorText = scopeSelector(rule.selectorText, '#doc', bodyClasses);
      else if (rule instanceof CSSMediaRule) scope(rule.cssRules);
    }
  };
  for (const style of src.querySelectorAll('style')) {
    const sheet = new CSSStyleSheet();
    // @import (web fonts) is dropped: cross-origin isolation would block it anyway.
    sheet.replaceSync((style.textContent ?? '').replace(/@import[^;]+;/g, ''));
    scope(sheet.cssRules);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
}

/** Removes what shouldn't be read aloud or can't work here: comments, footnote markers, active content. */
function clean(body: HTMLElement) {
  body.querySelectorAll('script, style, link, meta, iframe, object, embed, form, input, button').forEach((el) => el.remove());
  for (const el of body.querySelectorAll('*')) {
    for (const a of [...el.attributes]) if (a.name.startsWith('on')) el.removeAttribute(a.name);
  }
  // Comments: the marker in the text links to the thread (#cmnt1); the thread, a <div> at the end,
  // links back (#cmnt_ref1). Match on the link direction: the marker's own id also starts with "cmnt".
  body.querySelectorAll('a[href^="#cmnt_ref"]').forEach((a) => (a.closest('body > div') ?? a.closest('p') ?? a).remove());
  body.querySelectorAll('a[href^="#cmnt"]').forEach((a) => (a.closest('sup') ?? a).remove());
  // Footnotes: drop the [1] markers in the text and the labels in the list; keep the footnote text.
  body.querySelectorAll('a[href^="#ftnt"]').forEach((a) => (a.getAttribute('href')!.startsWith('#ftnt_ref') ? a : (a.closest('sup') ?? a)).remove());
  // Links: unwrap Google's redirector and open outside the reader.
  for (const a of body.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#')) continue;
    try {
      const u = new URL(href);
      if (u.host === 'www.google.com' && u.pathname === '/url' && u.searchParams.get('q')) a.href = u.searchParams.get('q')!;
    } catch {}
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
}

/** Images load through the extension (host permission) as blobs: cross-origin isolation blocks them otherwise. */
function loadImages(root: HTMLElement) {
  for (const img of root.querySelectorAll<HTMLImageElement>('img[src]')) {
    const src = img.getAttribute('src')!;
    if (!/^https?:/.test(src)) continue;
    img.removeAttribute('src');
    fetch(src, { credentials: 'include' })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => (img.src = URL.createObjectURL(b)))
      .catch(() => (img.alt ||= '[image]'));
  }
}

async function render(): Promise<boolean> {
  const name = docTitle(params.get('title') ?? '') || 'Google Doc';
  document.title = name;
  $('name').textContent = name;
  if (ref) $('open').setAttribute('href', editUrl(ref));
  else $('open').hidden = true;
  if (!source) {
    setStatus('No Google Doc given.', true);
    return false;
  }
  setStatus('Loading document…');
  let src: Document;
  try {
    src = await fetchExport(source);
  } catch (e) {
    setStatus(e instanceof LoadError ? e.message : `Couldn't open this document: ${(e as Error).message}`, true);
    return false;
  }
  const bodyClasses = [...src.body.classList];
  adoptStyles(src, bodyClasses);
  clean(src.body);
  docEl.className = ['doc', ...bodyClasses].join(' ');
  docEl.replaceChildren(...src.body.childNodes);
  loadImages(docEl);
  docEl.hidden = false;
  setStatus(docEl.textContent?.trim() ? '' : 'This document is empty.');
  return true;
}

async function main() {
  const tab = await chrome.tabs.getCurrent();
  const reader = createReader({
    tabId: tab?.id,
    extract: (mode, fromEl) => (mode === 'selection' ? extractSelection() : extractPage(fromEl, readOptions)),
    positionKey: () => pageKey(ref ? editUrl(ref) : (source ?? location.href)),
  });
  $('read').onclick = () => reader.start('page');
  const ok = await render();
  if (ok && (autoplay || autoSummarize)) {
    const p = new URLSearchParams(location.search);
    p.delete('autoplay');
    p.delete('summarize');
    history.replaceState(null, '', `${location.pathname}?${p}`);
    if (autoSummarize) reader.summarize();
    else reader.start('page');
  }
}

main();
