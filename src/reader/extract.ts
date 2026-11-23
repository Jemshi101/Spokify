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
  for (let entry: Element = best, level = 0; level < 10; level++) {
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

interface TextMap {
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
      d = cs.visibility === 'hidden' ? 'none' : cs.display;
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
        if (el !== root && (el.matches(SKIP_SELECTOR) || isUnlikely(el) || styleOf(el) === 'none')) return NodeFilter.FILTER_REJECT;
        return el.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      if (!n.nodeValue) return NodeFilter.FILTER_SKIP;
      if (range && !range.intersectsNode(n)) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
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
    cur.parts.push({ node: t, start: cur.text.length, from });
    cur.text += t.nodeValue!.slice(from, to).replace(/\s+/g, ' ');
  }
  return paragraphs.filter((p) => /[\p{L}\p{N}]/u.test(p.text));
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
