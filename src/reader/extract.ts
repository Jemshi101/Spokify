// Finds readable text on the live page and splits it into sentences and words with DOM ranges.
import { chunkSentence, mergeAbbreviationBreaks } from '../shared/text';

export interface Word {
  text: string;
  range: Range;
  /** Offset within the sentence text, used when exact timings are unavailable. */
  charStart: number;
}

export interface Sentence {
  text: string;
  range: Range;
  words: Word[];
}

/** Never read these elements (or anything inside them). */
const SKIP_SELECTOR = [
  'script', 'style', 'noscript', 'template', 'svg', 'math', 'canvas', 'video', 'audio', 'iframe',
  'nav', 'footer', 'aside', 'button', 'select', 'textarea', 'input', 'form', 'dialog', 'sup',
  'header:not(article header):not(main header)',
  '[role=navigation]', '[role=banner]', '[role=contentinfo]', '[role=complementary]', '[role=dialog]',
  '[aria-hidden=true]', '[hidden]', '[contenteditable=true]', '[data-nosnippet]', '.nocontent', '[role=tooltip]',
  // Collapsed sections: their content isn't on screen (e.g. GitHub's "Assets … Loading").
  'details:not([open])',
].join(',');

/** Readability-style class/id hints for boilerplate inside an article. */
const UNLIKELY = /\b(comment|share|social|related|promo|advert|ads?|sponsor|sidebar|newsletter|subscribe|signup|footnote|references|reflist|navbox|infobox|metadata|breadcrumb|toc|editsection|noprint|cookie|banner|popup|modal|tooltip|byline-tools|skip-link)\b/i;

const sentSeg = new Intl.Segmenter('en', { granularity: 'sentence' });
const wordSeg = new Intl.Segmenter('en', { granularity: 'word' });

/**
 * Screen-reader-only text ("sr-only", "visually-hidden"): positioned out of flow and clipped to
 * nothing or 1px. It isn't on screen, and it says things like "(opens in a new tab)" mid-sentence.
 */
function visuallyHidden(cs: CSSStyleDeclaration): boolean {
  if (cs.position !== 'absolute' && cs.position !== 'fixed') return false;
  if (/^inset\(50%/.test(cs.clipPath) || /^rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)$/.test(cs.clip) || /^rect\(1px,? 1px,? 1px,? 1px\)$/.test(cs.clip)) return true;
  return cs.overflow === 'hidden' && parseFloat(cs.width) <= 1 && parseFloat(cs.height) <= 1;
}

function isUnlikely(el: Element): boolean {
  const hint = `${typeof el.className === 'string' ? el.className : ''} ${el.id}`;
  return UNLIKELY.test(hint) && !/\b(article|body|content|main|post)\b/i.test(el.tagName);
}

function innerTextLen(el: Element): number {
  return (el as HTMLElement).innerText?.length ?? el.textContent?.length ?? 0;
}

function linkDensity(el: Element): number {
  const total = innerTextLen(el) || 1;
  let links = 0;
  el.querySelectorAll('a').forEach((a) => (links += innerTextLen(a)));
  return links / total;
}

/**
 * Readability-style scoring on the live DOM: text containers give points to their parent and
 * half to the grandparent. If the winner has strong siblings (e.g. Wikipedia's per-section
 * <section> wrappers), their common parent is used instead.
 */
export function findArticleRoot(doc: Document = document): Element {
  const scores = new Map<Element, number>();
  for (const el of doc.body.querySelectorAll('p,pre,td,blockquote,div,section,article')) {
    if (el.closest(SKIP_SELECTOR)) continue;
    // Text that isn't rendered (closed accordions, inactive tabs) must not decide what gets read.
    if (!el.checkVisibility({ visibilityProperty: true })) continue;
    // Only score elements that hold text directly (not just through child containers).
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE || (n as Element).matches?.('a,b,i,em,strong,span,code,font,br,small,abbr,q,cite,mark,u,s,sub')) own += n.textContent;
    own = own.trim();
    if (own.length < 25) continue;
    const score = 1 + own.split(',').length + Math.min(Math.floor(own.length / 100), 3);
    const parent = el.parentElement;
    const grand = parent?.parentElement;
    if (parent) scores.set(parent, (scores.get(parent) ?? 0) + score);
    if (grand) scores.set(grand, (scores.get(grand) ?? 0) + score / 2);
  }
  const adjusted = (el: Element) => (scores.get(el) ?? 0) * (1 - linkDensity(el));
  let best: Element | null = null;
  let bestScore = 0;
  for (const el of scores.keys()) {
    const s = adjusted(el);
    if (s > bestScore) {
      best = el;
      bestScore = s;
    }
  }
  if (!best) return doc.querySelector('article,main,[role=main]') ?? doc.body;

  // Pages of repeated entries (release notes, blog indexes, forum threads): the best block is just
  // one entry. If an ancestor has siblings shaped like it (same tag and classes) that also hold real
  // text, read the whole list. Otherwise only the longest entry would be read.
  const signature = (el: Element) => `${el.tagName}.${[...el.classList].sort().join('.')}`;
  const weight = (el: Element) => {
    let w = 0;
    for (const [k, v] of scores) if (el.contains(k)) w += v;
    return w;
  };
  // Deep enough for course builders (Articulate Rise nests a tab's text 13 levels below its lesson block).
  for (let entry: Element = best, level = 0; level < 16; level++) {
    const parent: Element | null = entry.parentElement;
    if (!parent || parent === doc.body || parent === doc.documentElement) break;
    const sig = signature(entry);
    const min = weight(entry) * 0.1;
    const current = entry;
    const alike = [...parent.children].filter((c) => c !== current && signature(c) === sig && weight(c) > Math.max(min, 3));
    if (alike.length) return parent;
    entry = parent;
  }

  let root: Element = best;
  for (let level = 0; level < 2; level++) {
    const parent: Element | null = root.parentElement;
    if (!parent || parent === doc.body || parent === doc.documentElement) break;
    const current = root;
    const strongSiblings = [...parent.children].filter((c) => c !== current && adjusted(c) >= bestScore * 0.2).length;
    if (strongSiblings === 0) break;
    root = parent;
  }
  return root;
}

// ---------- text collection ----------

interface Part {
  node: Text;
  start: number;
  from: number;
}

export interface TextMap {
  text: string;
  parts: Part[];
}

interface Paragraph extends TextMap {
  block: Element;
}

export interface CollectOptions {
  /** Overrides block detection (the PDF viewer treats each page's text layer as one block). */
  blockOf?: (el: Element) => Element;
  /** Text inserted for a <br> (default newline = sentence break). The PDF viewer decides per element. */
  brText?: string | ((br: Element) => string);
}

// ---------- tabs, expandable sections and carousels ----------

/** The tab button that shows this panel (ARIA tabs: aria-controls on the tab, or aria-labelledby on the panel). */
export function tabFor(panel: Element): HTMLElement | null {
  const doc = panel.ownerDocument;
  const byControls = panel.id ? doc.querySelector<HTMLElement>(`[role=tab][aria-controls="${CSS.escape(panel.id)}"]`) : null;
  if (byControls) return byControls;
  const by = panel.getAttribute('aria-labelledby');
  const tab = by ? doc.getElementById(by.split(/\s+/)[0]) : null;
  return tab?.getAttribute('role') === 'tab' ? tab : null;
}

const isTabPanel = (el: Element) => el.getAttribute('role') === 'tabpanel' && !!tabFor(el);

/**
 * The button that expands this section (WAI-ARIA disclosure / accordion: aria-expanded + aria-controls).
 * Pop-up menus and lists are not sections.
 */
export function disclosureFor(panel: Element): HTMLElement | null {
  if (!panel.id || panel.matches('[role=menu],[role=listbox],[role=dialog],[role=tooltip],[role=tree],[role=grid]')) return null;
  const btn = panel.ownerDocument.querySelector<HTMLElement>(`[aria-expanded][aria-controls~="${CSS.escape(panel.id)}"]:not([role=tab]):not([role=combobox])`);
  const popup = btn?.getAttribute('aria-haspopup');
  return btn && (popup == null || popup === 'false') ? btn : null;
}

/** The control that names this panel and opens it: its tab, or its expand button. */
const labelFor = (el: Element) => (el.getAttribute('role') === 'tabpanel' ? tabFor(el) : null) ?? disclosureFor(el);

/** Accessible carousels (WAI-ARIA pattern): slides marked aria-roledescription="slide" inside a "carousel". */
const SLIDE = '[aria-roledescription="slide" i]';
const CAROUSEL = '[aria-roledescription="carousel" i]';
const isSlide = (el: Element) => el.matches(SLIDE) && !!el.parentElement?.closest(CAROUSEL);
const slideShown = (el: Element) => !(el as HTMLElement).hidden && !(el as HTMLElement).inert && el.getAttribute('aria-hidden') !== 'true';

/** Panels hidden by a widget that the reader can open: read them, and reveal them when reading gets there. */
const isRevealable = (el: Element) => isTabPanel(el) || isSlide(el) || (!!el.id && !!disclosureFor(el));

function elementOf(range: Range): Element | null {
  const n = range.startContainer;
  return n instanceof Element ? n : n.parentElement;
}

/** Switches to the tab this range is in (or names). Returns true when it clicked a tab. */
function revealTab(el: Element): boolean {
  const tab = (el.closest('[role=tab]') as HTMLElement | null) ?? (() => {
    const panel = el.closest('[role=tabpanel]');
    return panel ? tabFor(panel) : null;
  })();
  if (!tab || tab.getAttribute('aria-selected') === 'true') return false;
  tab.click();
  return true;
}

/** Expands every collapsed section around `el` (outermost first), or the one whose title `el` is. */
function revealSections(el: Element): boolean {
  const toOpen: HTMLElement[] = [];
  // Reading a section's title: open it now so its content shows next.
  const own = el.closest<HTMLElement>('[aria-expanded=false][aria-controls]');
  const target = own && own.ownerDocument.getElementById(own.getAttribute('aria-controls')!.split(/\s+/)[0]);
  if (own && target && disclosureFor(target) === own) toOpen.push(own);
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (!e.id) continue;
    const btn = disclosureFor(e);
    if (btn?.getAttribute('aria-expanded') === 'false') toOpen.unshift(btn);
  }
  for (const btn of toOpen) if (btn.getAttribute('aria-expanded') === 'false') btn.click();
  return toOpen.length > 0;
}

/** Steps a carousel with its next/previous buttons until the slide holding `el` is the one shown. */
async function revealSlide(el: Element): Promise<boolean> {
  const slide = el.closest(SLIDE);
  const carousel = slide?.parentElement?.closest(CAROUSEL);
  if (!slide || !carousel || slideShown(slide)) return false;
  const slides = [...carousel.querySelectorAll(SLIDE)].filter((s) => s.parentElement?.closest(CAROUSEL) === carousel);
  const button = (dir: 'next' | 'prev') =>
    carousel.querySelector<HTMLElement>(dir === 'next' ? 'button[aria-label*="next" i], [class*="next" i] button, button[class*="next" i]' : 'button[aria-label*="prev" i], [class*="prev" i] button, button[class*="prev" i]');
  for (let guard = slides.length; guard > 0 && !slideShown(slide); guard--) {
    const shown = slides.findIndex(slideShown);
    const btn = button(shown >= 0 && shown > slides.indexOf(slide) ? 'prev' : 'next');
    if (!btn) return false;
    btn.click();
    // Wait for the slide change (carousels animate before updating hidden/inert).
    for (let t = 0; t < 30 && slides.findIndex(slideShown) === shown; t++) await new Promise((r) => setTimeout(r, 50));
  }
  return slideShown(slide);
}

/**
 * If the range is in a closed tab or a carousel slide that isn't shown, switches to it so it can be
 * seen and highlighted. Resolves true when something was switched.
 */
export async function reveal(range: Range): Promise<boolean> {
  const el = elementOf(range);
  if (!el) return false;
  const opened = revealSections(el);
  if (revealTab(el)) return true;
  return (await revealSlide(el)) || opened;
}

const INLINE = new Set(['inline', 'inline-block', 'inline-flex', 'inline-grid', 'contents', 'ruby']);

/**
 * Walks visible text under `root` in document order and groups it into paragraphs:
 * a new paragraph starts whenever the nearest block-level ancestor changes. <br> becomes a newline,
 * which Intl.Segmenter treats as a sentence break.
 */
function collectParagraphs(root: Element, range?: Range, opts: CollectOptions = {}): Paragraph[] {
  const display = new Map<Element, string>();
  const styleOf = (el: Element) => {
    let d = display.get(el);
    if (d === undefined) {
      const cs = getComputedStyle(el);
      d = cs.visibility === 'hidden' || visuallyHidden(cs) ? 'none' : cs.display;
      display.set(el, d);
    }
    return d;
  };
  const blockOf = opts.blockOf ?? ((el: Element): Element => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      if (e === root || !INLINE.has(styleOf(e))) return e;
    }
    return root;
  });
  const brText = typeof opts.brText === 'function' ? opts.brText : () => (opts.brText as string | undefined) ?? '\n';

  const paragraphs: Paragraph[] = [];
  let cur: Paragraph | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as Element;
        // Closed tabs and hidden carousel slides are read too (the reader opens them as it reaches them).
        if (el !== root && !range && isRevealable(el)) return NodeFilter.FILTER_ACCEPT;
        if (el !== root && (el.matches(SKIP_SELECTOR) || isUnlikely(el) || styleOf(el) === 'none')) return NodeFilter.FILTER_REJECT;
        return el.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      if (!n.nodeValue) return NodeFilter.FILTER_SKIP;
      if (range && !range.intersectsNode(n)) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName !== 'BR') {
      // A tab panel or expandable section: its tab or title comes first, as a heading. A slide: just a new paragraph.
      const control = labelFor(n as Element);
      const label = control && !root.contains(control) ? null : control && textMap(control);
      if (control && label && /[\p{L}\p{N}]/u.test(label.text)) paragraphs.push({ block: control, ...label });
      cur = null;
      continue;
    }
    if (n.nodeType === Node.ELEMENT_NODE) {
      const t = brText(n as Element); // <br>
      if (cur && t && !cur.text.endsWith(t)) cur.text = cur.text.replace(/ $/, '') + t;
      continue;
    }
    const t = n as Text;
    const block = blockOf(t.parentElement!);
    if (!cur || cur.block !== block) {
      // A different block that sits *inside* the current one (e.g. a quote in a table cell)
      // still starts a new paragraph; text after it resumes in yet another paragraph.
      if (cur && !/\S/.test(t.nodeValue!)) continue;
      cur = { block, text: '', parts: [] };
      paragraphs.push(cur);
    }
    let from = 0;
    let to = t.nodeValue!.length;
    if (range) {
      if (t === range.startContainer) from = range.startOffset;
      if (t === range.endContainer) to = range.endOffset;
    }
    appendText(cur, t, from, to);
  }
  return paragraphs.filter((p) => /[\p{L}\p{N}]/u.test(p.text));
}

/**
 * Appends node text [from, to) to the map with whitespace runs collapsed to one space. Each collapsed
 * run starts a new part, so positions after it still point at the right characters in the node
 * (otherwise "Gemini  functions" would shift every later highlight by a letter).
 */
export function appendText(map: TextMap, node: Text, from: number, to: number) {
  const raw = node.nodeValue!;
  const runs = /\s{2,}/g;
  runs.lastIndex = from;
  let i = from;
  map.parts.push({ node, start: map.text.length, from: i });
  for (let m = runs.exec(raw); m && m.index < to; m = runs.exec(raw)) {
    map.text += raw.slice(i, m.index).replace(/\s/g, ' ') + ' ';
    i = Math.min(m.index + m[0].length, to);
    if (i < to) map.parts.push({ node, start: map.text.length, from: i });
  }
  if (i < to) map.text += raw.slice(i, to).replace(/\s/g, ' ');
}

/** All text under an element as one paragraph's text map. */
function textMap(el: Element): TextMap {
  const map: TextMap = { text: '', parts: [] };
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let t = w.nextNode() as Text | null; t; t = w.nextNode() as Text | null) {
    if (!t.nodeValue?.trim()) continue;
    if (map.text && !map.text.endsWith(' ')) map.text += ' ';
    appendText(map, t, 0, t.nodeValue.length);
  }
  map.text = map.text.trim() ? map.text : '';
  return map;
}

function rangeFor(map: TextMap, start: number, end: number): Range {
  const locate = (pos: number, isEnd: boolean): [Text, number] => {
    for (let i = map.parts.length - 1; i >= 0; i--) {
      const p = map.parts[i];
      if (pos > p.start || (!isEnd && pos === p.start) || i === 0) {
        return [p.node, Math.min(p.from + Math.max(pos - p.start, 0), p.node.nodeValue!.length)];
      }
    }
    throw new Error('empty text map');
  };
  const r = document.createRange();
  r.setStart(...locate(start, false));
  r.setEnd(...locate(end, true));
  return r;
}

function segment(map: TextMap, out: Sentence[]) {
  const spans = mergeAbbreviationBreaks(
    map.text,
    [...sentSeg.segment(map.text)].map((s): [number, number] => [s.index, s.index + s.segment.length]),
  );
  for (const [from, to] of spans) {
    const raw = map.text.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const body = raw.trim();
    if (!/[\p{L}\p{N}]/u.test(body)) continue;
    if (/^(\d{1,4}|[ivxlc]{1,6})\.?$/i.test(body)) continue; // page numbers
    const base = from + lead;
    for (const [a, b] of chunkSentence(body)) {
      const text = body.slice(a, b).trim();
      if (!text) continue;
      const start = base + a + body.slice(a, b).indexOf(text);
      const words: Word[] = [];
      for (const w of wordSeg.segment(text)) {
        if (!w.isWordLike) continue;
        words.push({ text: w.segment, range: rangeFor(map, start + w.index, start + w.index + w.segment.length), charStart: w.index });
      }
      out.push({ text, range: rangeFor(map, start, start + text.length), words });
    }
  }
}

const END_SECTIONS = /^(references|external links|see also|further reading|notes|footnotes|citations|sources|bibliography|works cited|related (articles|posts|stories)|comments?)$/i;

/** Headings, including wrappers like Wikipedia's <div class="mw-heading"><h2>…</h2></div>. */
function isHeading(el: Element): boolean {
  return /^H[1-6]$/.test(el.tagName) || el.matches('[role=heading]') || !!el.querySelector(':scope > :is(h1,h2,h3,h4,h5,h6)');
}

/** Drops trailing reference-style sections ("References", "External links", …) in the last part of the text. */
function dropEndSections(paragraphs: Paragraph[]): Paragraph[] {
  const cut = paragraphs.findIndex(
    (p, i) => i >= paragraphs.length * 0.3 && isHeading(p.block) && END_SECTIONS.test(p.text.trim().replace(/\[edit\]$/i, '').trim()),
  );
  return cut > 0 ? paragraphs.slice(0, cut) : paragraphs;
}

export interface ExtractOptions extends CollectOptions {
  /** Read this element instead of detecting the article. */
  root?: Element;
}

export function extractPage(fromEl?: Element | null, opts: ExtractOptions = {}): Sentence[] {
  let root = opts.root ?? findArticleRoot();
  if (fromEl && !root.contains(fromEl)) root = document.body;
  let paragraphs = collectParagraphs(root, undefined, opts);

  // Include the page title when it sits above the article container.
  const h1 = opts.root ? null : document.querySelector('h1');
  if (h1 && !root.contains(h1) && !h1.closest(SKIP_SELECTOR) && root.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_PRECEDING) {
    const title = collectParagraphs(h1);
    // Skip it when the article starts with the same heading (e.g. a course's top bar repeats the lesson title).
    const norm = (t?: string) => (t ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (title.length && norm(title[0].text) !== norm(paragraphs[0]?.text)) paragraphs = [...title, ...paragraphs];
  }
  paragraphs = dropEndSections(paragraphs);

  if (fromEl) {
    const i = paragraphs.findIndex((p) => p.parts.some((part) => fromEl.contains(part.node)) || p.block.contains(fromEl));
    if (i >= 0) paragraphs = paragraphs.slice(i);
  }
  const out: Sentence[] = [];
  for (const p of paragraphs) segment(p, out);
  return out;
}

export function extractSelection(opts: CollectOptions = {}): Sentence[] {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return [];
  const range = sel.getRangeAt(0);
  const c = range.commonAncestorContainer;
  const root = (c.nodeType === Node.ELEMENT_NODE ? c : c.parentElement) as Element;
  const out: Sentence[] = [];
  for (const p of collectParagraphs(root, range, opts)) segment(p, out);
  return out;
}
