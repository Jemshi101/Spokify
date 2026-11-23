// Pure text helpers shared by the content script and tests.

export const MAX_CHUNK_CHARS = 160;

/**
 * Splits a long sentence into chunks: well under Kokoro's ~510 phoneme limit, and short enough that
 * each GPU job stays short (long jobs on weak GPUs can trigger a driver reset on Windows).
 * Prefers clause punctuation, then spaces. Returns [start, end) offsets into `text`.
 */
export function chunkSentence(text: string, max = MAX_CHUNK_CHARS): [number, number][] {
  const out: [number, number][] = [];
  let s = 0;
  while (text.length - s > max) {
    const window = text.slice(s, s + max);
    let cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(': '), window.lastIndexOf(' — '));
    if (cut < max / 3) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = max - 1;
    out.push([s, s + cut + 1]);
    s += cut + 1;
    while (text[s] === ' ') s++;
  }
  if (s < text.length) out.push([s, text.length]);
  return out;
}

const ABBREVIATIONS = /(?:^|[\s(])(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|etc|e\.g|i\.e|Inc|Ltd|Co|Corp|Gen|Gov|Sen|Rep|Rev|No|Fig|approx|[A-Z])\.\s*$/;

/** Words that usually begin a sentence: after one, a single capital letter + "." ends the sentence. */
const SENTENCE_STARTERS = new Set(
  (
    'the a an it its he she they we you i this that these those there here his her their our my your in on at ' +
    'for from to with by after before during when while if as but and or so yet however then also meanwhile ' +
    'although though because since today now later finally first next still instead thus therefore one some ' +
    'many most all both each every no not what why how who where which'
  ).split(' '),
);

/** Words followed by a Roman numeral ("World War I", "Chapter V"), not by someone's initial. */
const NUMBERED = /\b(?:War|Chapter|Part|Act|Scene|Book|Volume|Vol|Phase|Stage|Level|Type|Class|Section|Article|Appendix|Title|Round|Season|Episode|Grade|Tier|Category|Schedule|Annex|Unit)\s+[IVX]\.\s*$/;

/**
 * Is the break after a single capital letter ("F." in "John F. Kennedy") really an initial?
 * Not when the next word usually starts a sentence ("World War I. The war…", "Plan B. It worked"),
 * or when the letter is a Roman numeral after a numbered word ("World War I. Germany lost").
 */
function isInitial(before: string, after: string): boolean {
  if (NUMBERED.test(before)) return false;
  const next = after.trim().match(/^[\p{L}']+/u)?.[0];
  if (!next) return true;
  if (/^[A-Z]\.?$/.test(next)) return true; // another initial: "J. R. R. Tolkien"
  return !SENTENCE_STARTERS.has(next.toLowerCase());
}

/**
 * Intl.Segmenter breaks after abbreviations ("Dr. Smith" → "Dr." | "Smith").
 * Merges such breaks back. Input/output are [start, end) offsets.
 */
export function mergeAbbreviationBreaks(text: string, spans: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const span of spans) {
    const prev = out[out.length - 1];
    const before = prev ? text.slice(prev[0], prev[1]) : '';
    const abbreviation = !!prev && ABBREVIATIONS.test(before);
    const single = abbreviation && /(?:^|[\s(])[A-Z]\.\s*$/.test(before);
    if (abbreviation && (!single || isInitial(before, text.slice(span[0], span[1])))) prev![1] = span[1];
    else out.push([...span]);
  }
  return out;
}
