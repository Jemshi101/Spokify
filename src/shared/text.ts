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

/**
 * Intl.Segmenter breaks after abbreviations ("Dr. Smith" → "Dr." | "Smith").
 * Merges such breaks back. Input/output are [start, end) offsets.
 */
export function mergeAbbreviationBreaks(text: string, spans: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const span of spans) {
    const prev = out[out.length - 1];
    if (prev && ABBREVIATIONS.test(text.slice(prev[0], prev[1]))) prev[1] = span[1];
    else out.push([...span]);
  }
  return out;
}
