import { describe, expect, it } from 'vitest';
import { maxDuration, preprocess, wordOffsets } from '../../src/engine/supertonic';
import { LEAD_SEC, leadingSilence, padLead } from '../../src/engine/lead';
import { SUPERTONIC_VOICES, DEFAULT_SUPERTONIC_VOICE } from '../../src/shared/settings';

describe('maxDuration', () => {
  it('caps the time for a short title', () => {
    expect(maxDuration('Step one', 1.34)).toBeCloseTo(0.3 + 8 / 13);
  });
  it('keeps the prediction for a normal sentence', () => {
    const s = 'Google has tools that empower business experts to build AI Agents directly.';
    expect(maxDuration(s, 5.45)).toBe(5.45);
  });
});

describe('padLead', () => {
  const sr = 1000;
  const clip = (quiet: number) => {
    const samples = new Float32Array(quiet + 500);
    samples.fill(0.5, quiet);
    return { samples, sampleRate: sr, audioSec: samples.length / sr, wordTimes: [0, 0.2] };
  };
  it('adds silence before speech that starts right away, and shifts word times', () => {
    const out = padLead(clip(20));
    expect(leadingSilence(out.samples, sr)).toBeCloseTo(LEAD_SEC, 2);
    expect(out.wordTimes[1]).toBeCloseTo(0.2 + LEAD_SEC - 0.02, 3);
    expect(out.audioSec).toBeCloseTo(out.samples.length / sr, 3);
  });
  it('leaves a clip that already starts quietly alone', () => {
    const c = clip(300);
    expect(padLead(c)).toBe(c);
  });
});

describe('wordOffsets', () => {
  it('finds each word in order, even when a word repeats', () => {
    const text = 'The cat saw the other cat.';
    expect(wordOffsets(text, ['The', 'cat', 'saw', 'the', 'other', 'cat'])).toEqual([0, 4, 8, 12, 16, 22]);
  });
  it('marks words it cannot find', () => {
    expect(wordOffsets('Hello world.', ['Hello', 'there', 'world'])).toEqual([0, -1, 6]);
  });
});

describe('Supertonic text preprocessing', () => {
  it('wraps the text in the language tag and ends it with punctuation', () => {
    expect(preprocess('Hello world')).toBe('<en>Hello world.</en>');
  });
  it('normalizes quotes and dashes and expands e.g.', () => {
    expect(preprocess('It’s “fine” — e.g., today')).toBe(`<en>It's "fine" - for example, today.</en>`);
  });
});

describe('Supertonic voices', () => {
  it('offers ten styles including the default', () => {
    expect(SUPERTONIC_VOICES).toHaveLength(10);
    expect(SUPERTONIC_VOICES.some((v) => v.id === DEFAULT_SUPERTONIC_VOICE)).toBe(true);
  });
});
