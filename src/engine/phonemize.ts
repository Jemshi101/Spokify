// Text normalization + phonemization, ported from kokoro-js 1.2.1 (Apache-2.0, hexgrad / Xenova).
// We own this step so we can map every original word to its phonemes for exact word timing.
import { phonemize as espeak } from 'phonemizer';

const PUNCT = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCT_RUN = new RegExp(`(\\s*[${PUNCT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]+\\s*)+`, 'g');

function splitNum(e: string): string {
  if (e.includes('.')) return e;
  if (e.includes(':')) {
    const [h, m] = e.split(':').map(Number);
    return m === 0 ? `${h} o'clock` : m < 10 ? `${h} oh ${m}` : `${h} ${m}`;
  }
  const year = parseInt(e.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) return e;
  const left = e.slice(0, 2);
  const right = parseInt(e.slice(2, 4), 10);
  const s = e.endsWith('s') ? 's' : '';
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${s}`;
    if (right < 10) return `${left} oh ${right}${s}`;
  }
  return `${left} ${right}${s}`;
}

function flipMoney(e: string): string {
  const unit = e[0] === '$' ? 'dollar' : 'pound';
  if (isNaN(Number(e.slice(1)))) return `${e.slice(1)} ${unit}s`;
  if (!e.includes('.')) return `${e.slice(1)} ${unit}${e.slice(1) === '1' ? '' : 's'}`;
  const [b, c] = e.slice(1).split('.');
  const cents = parseInt(c.padEnd(2, '0'), 10);
  const small = e[0] === '$' ? (cents === 1 ? 'cent' : 'cents') : cents === 1 ? 'penny' : 'pence';
  return `${b} ${unit}${b === '1' ? '' : 's'} and ${cents} ${small}`;
}

function pointNum(e: string): string {
  const [a, b] = e.split('.');
  return `${a} point ${b.split('').join(' ')}`;
}

export function normalizeText(text: string): string {
  return (
    text
      // Our addition: split letter-hyphen-letter compounds so each written word gets its own phoneme word.
      .replace(/(?<=[A-Za-z])-(?=[A-Za-z])/g, ' ')
      .replace(/[‘’]/g, "'")
      .replace(/«/g, '“')
      .replace(/»/g, '”')
      .replace(/[“”]/g, '"')
      .replace(/\(/g, '«')
      .replace(/\)/g, '»')
      .replace(/[^\S \n]/g, ' ')
      .replace(/  +/g, ' ')
      .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor')
      .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister')
      .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss')
      .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
      .replace(/\betc\.(?! [A-Z])/gi, 'etc')
      .replace(/\b(y)eah?\b/gi, "$1e'a")
      .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNum)
      .replace(/(?<=\d),(?=\d)/g, '')
      .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, flipMoney)
      .replace(/\d*\.\d+/g, pointNum)
      .replace(/(?<=\d)-(?=\d)/g, ' to ')
      .replace(/(?<=\d)S/g, ' S')
      .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
      .replace(/(?<=X')S\b/g, 's')
      .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, '-'))
      .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-')
      .trim()
  );
}

/** Same pipeline as kokoro-js `phonemize(text, "a"|"b")`. */
export async function phonemizeText(text: string, lang: 'a' | 'b'): Promise<string> {
  const norm = normalizeText(text);
  const pieces: { punct: boolean; text: string }[] = [];
  let last = 0;
  for (const m of norm.matchAll(PUNCT_RUN)) {
    if (last < m.index!) pieces.push({ punct: false, text: norm.slice(last, m.index) });
    if (m[0].length) pieces.push({ punct: true, text: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < norm.length) pieces.push({ punct: false, text: norm.slice(last) });

  const voice = lang === 'a' ? 'en-us' : 'en';
  const joined = (
    await Promise.all(pieces.map(async (p) => (p.punct ? p.text : (await espeak(p.text, voice)).join(' '))))
  ).join('');

  let ps = joined
    .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ')
    .replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
    .replace(/ʲ/g, 'j')
    .replace(/r/g, 'ɹ')
    .replace(/x/g, 'k')
    .replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ')
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z');
  if (lang === 'a') ps = ps.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di');
  return ps.trim();
}

const wordCache = new Map<string, string>();

/** Phonemes of a single written word, cached (common words repeat constantly). */
export async function phonemizeWord(word: string, lang: 'a' | 'b'): Promise<string> {
  const key = `${lang}|${word}`;
  let ps = wordCache.get(key);
  if (ps === undefined) {
    ps = await phonemizeText(word, lang);
    if (wordCache.size > 5000) wordCache.clear();
    wordCache.set(key, ps);
  }
  return ps;
}
