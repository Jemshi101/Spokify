import { describe, expect, it } from 'vitest';
import { alignPhonemes, positionsToTimes } from '../../src/engine/align';
import { phonemizeText, phonemizeWord } from '../../src/engine/phonemize';
import { chunkSentence, mergeAbbreviationBreaks } from '../../src/shared/text';
import { splitSpeed } from '../../src/shared/settings';

const words = (s: string) => [...new Intl.Segmenter('en', { granularity: 'word' }).segment(s)].filter((w) => w.isWordLike).map((w) => w.segment);

async function align(sentence: string) {
  const ws = words(sentence);
  const ps = await phonemizeText(sentence, 'a');
  const wordPs = await Promise.all(ws.map((w) => phonemizeWord(w, 'a')));
  return { ws, ps, ...alignPhonemes(wordPs, ps) };
}

describe('alignPhonemes', () => {
  it('finds words inside espeak-merged function words', async () => {
    const r = await align('state-of-the-art voices');
    expect(r.ps.slice(r.wordStarts[r.ws.indexOf('the')])).toMatch(/^ð/);
    expect(r.ps.slice(r.wordStarts[r.ws.indexOf('voices')])).toMatch(/^v/);
  });

  it('handles numbers and money that expand in context', async () => {
    const r = await align('It costs $5.99 per month.');
    expect(r.ps.slice(r.wordStarts[r.ws.indexOf('per')])).toMatch(/^p/);
    expect(r.ps.slice(r.wordStarts[r.ws.indexOf('month')])).toMatch(/^m/);
  });

  const corpus = [
    'Listening to text while following along can improve focus.',
    'In 2024, small speech models became good enough to run inside a browser tab.',
    "Dr. Smith's team tested state-of-the-art voices on 1,000 sentences; the results were close to human recordings.",
    'It costs $5.99 per month, or £50 a year.',
    'The meeting starts at 10:30 and ends around 12 o’clock.',
    'U.S. officials said the e-mail was sent on March 3rd.',
    'She said, “It’s not what you think — it’s better.”',
    'Version 3.5 is 20% faster than version 3.4 (according to the changelog).',
    'Mr. and Mrs. Jones moved to New York in the 1990s.',
    'Kokoro is an 82 million parameter text-to-speech model.',
  ];

  it('aligns every corpus sentence well, monotonically', async () => {
    let words = 0;
    let matched = 0;
    for (const s of corpus) {
      const r = await align(s);
      expect(r.quality, s).toBeGreaterThanOrEqual(0.6);
      const found = r.wordStarts.filter((p) => p >= 0);
      expect(found, s).toEqual([...found].sort((x, y) => x - y));
      words += r.wordStarts.length;
      matched += found.length;
    }
    expect(matched / words).toBeGreaterThan(0.97);
  });
});

describe('positionsToTimes', () => {
  it('converts phoneme positions to seconds, skipping the leading pad token', () => {
    // phonemes "ab cd" → tokens [pad,a,b,space,c,d,pad]; 10 units = 1 s
    expect(positionsToTimes([0, 3], [2, 1, 1, 1, 1, 1, 3], 1)).toEqual([0.2, 0.5]);
  });
  it('fills unmatched words with the next time and keeps times monotonic', () => {
    expect(positionsToTimes([0, -1, 3], [2, 1, 1, 1, 1, 1, 3], 1)).toEqual([0.2, 0.5, 0.5]);
  });
});

describe('chunkSentence', () => {
  it('leaves short sentences alone', () => {
    expect(chunkSentence('Short one.')).toEqual([[0, 10]]);
  });
  it('splits long sentences at clause punctuation under the limit', () => {
    const s = Array.from({ length: 40 }, (_, i) => `clause number ${i}`).join(', ');
    const chunks = chunkSentence(s, 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const [a, b] of chunks) expect(b - a).toBeLessThanOrEqual(120);
    expect(chunks.map(([a, b]) => s.slice(a, b)).join(' ').replace(/\s+/g, ' ')).toBe(s.replace(/\s+/g, ' '));
  });
});

describe('splitSpeed', () => {
  it('lets the model handle up to 1.5× and playback the rest', () => {
    expect(splitSpeed(1.25)).toEqual({ modelSpeed: 1.25, rate: 1 });
    expect(splitSpeed(3)).toEqual({ modelSpeed: 1.5, rate: 2 });
  });
});

describe('mergeAbbreviationBreaks', () => {
  const split = (t: string) =>
    mergeAbbreviationBreaks(t, [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(t)].map((s): [number, number] => [s.index, s.index + s.segment.length]))
      .map(([a, b]) => t.slice(a, b).trim());
  it('keeps titles and initials attached', () => {
    expect(split("Dr. Smith's team won. Mr. J. Jones agreed, e.g. on Friday.")).toEqual(["Dr. Smith's team won.", 'Mr. J. Jones agreed, e.g. on Friday.']);
  });
  it('still splits normal sentences', () => {
    expect(split('It works. Then it stops.')).toEqual(['It works.', 'Then it stops.']);
  });
  it('ends a sentence at a single letter before a sentence starter', () => {
    expect(split('He fought in World War I. The war ended in 1918.')).toEqual(['He fought in World War I.', 'The war ended in 1918.']);
    expect(split('We tried Plan B. It worked.')).toEqual(['We tried Plan B.', 'It worked.']);
    expect(split('This is Henry V. He was king of England.')).toEqual(['This is Henry V.', 'He was king of England.']);
  });
  it('ends a sentence at a Roman numeral after a numbered word', () => {
    expect(split('Read Chapter V. Germany appears later.')).toEqual(['Read Chapter V.', 'Germany appears later.']);
    expect(split('After World War I. Germany lost land.')).toEqual(['After World War I.', 'Germany lost land.']);
  });
  it('keeps initials attached', () => {
    expect(split('John F. Kennedy was president.')).toEqual(['John F. Kennedy was president.']);
    expect(split('J. R. R. Tolkien wrote it. Then he rested.')).toEqual(['J. R. R. Tolkien wrote it.', 'Then he rested.']);
    expect(split('U. S. Grant won.')).toEqual(['U. S. Grant won.']);
  });
});
