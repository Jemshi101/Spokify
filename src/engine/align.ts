// Maps written words to audio times. Pure functions (unit tested).
//
// Each written word is phonemized on its own; the concatenation is aligned against the sentence's
// phoneme string with an edit-distance alignment. A word's start time is the start time of the
// sentence phoneme its first character maps to. This survives espeak merging function words
// ("of the" → "ʌvðɪ"), numbers, money and abbreviations expanding differently in context.

const IGNORE = new Set([...'ˈˌ ;:,.!?¡¿—…"«»“”(){}[]\'']);

export interface Alignment {
  /** Index into the sentence phoneme string where each word starts, or -1 if unmatched. */
  wordStarts: number[];
  /** 1 = identical phoneme sequences, 0 = nothing in common. */
  quality: number;
}

export function alignPhonemes(wordPhonemes: string[], sentence: string): Alignment {
  const a: string[] = [];
  const aWord: number[] = [];
  wordPhonemes.forEach((ps, w) => {
    for (const ch of ps) if (!IGNORE.has(ch) && !/\s/.test(ch)) { a.push(ch); aWord.push(w); }
  });
  const b: string[] = [];
  const bPos: number[] = [];
  for (let i = 0; i < sentence.length; i++) {
    const ch = sentence[i];
    if (!IGNORE.has(ch) && !/\s/.test(ch)) { b.push(ch); bPos.push(i); }
  }

  const n = a.length;
  const m = b.length;
  const wordStarts = wordPhonemes.map(() => -1);
  if (!n || !m) return { wordStarts, quality: 0 };

  const W = m + 1;
  const d = new Uint16Array((n + 1) * W);
  for (let i = 0; i <= n; i++) d[i * W] = i;
  for (let j = 0; j <= m; j++) d[j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = d[(i - 1) * W + j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      const del = d[(i - 1) * W + j] + 1;
      const ins = d[i * W + j - 1] + 1;
      d[i * W + j] = sub < del ? (sub < ins ? sub : ins) : del < ins ? del : ins;
    }
  }

  // Backtrace: record, for each char of `a`, the sentence position it lines up with.
  const mapped = new Int32Array(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const here = d[i * W + j];
    if (here === d[(i - 1) * W + j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      mapped[i - 1] = bPos[j - 1];
      i--; j--;
    } else if (here === d[(i - 1) * W + j] + 1) {
      i--;
    } else {
      j--;
    }
  }

  for (let k = 0; k < n; k++) {
    const w = aWord[k];
    if (wordStarts[w] === -1 && mapped[k] >= 0) wordStarts[w] = mapped[k];
  }
  return { wordStarts, quality: 1 - d[n * W + m] / Math.max(n, m) };
}

/**
 * Converts sentence phoneme positions to seconds using the model's per-token durations.
 * Token i+1 is phoneme char i (token 0 and the last token are padding).
 * Unmatched words (-1) inherit the next matched word's time, so highlighting stays monotonic.
 */
export function positionsToTimes(positions: number[], durations: ArrayLike<number>, audioSeconds: number): number[] {
  let total = 0;
  for (let k = 0; k < durations.length; k++) total += durations[k];
  const tokenStart = new Float64Array(durations.length + 1);
  for (let k = 0; k < durations.length; k++) tokenStart[k + 1] = tokenStart[k] + durations[k];
  const secPerUnit = total ? audioSeconds / total : 0;

  const times = positions.map((p) => (p < 0 ? NaN : tokenStart[Math.min(p + 1, durations.length)] * secPerUnit));
  let next = audioSeconds;
  for (let k = times.length - 1; k >= 0; k--) {
    if (Number.isNaN(times[k])) times[k] = next;
    else next = times[k];
  }
  for (let k = 1; k < times.length; k++) if (times[k] < times[k - 1]) times[k] = times[k - 1];
  return times;
}
