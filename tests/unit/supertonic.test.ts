import { describe, expect, it } from 'vitest';
import { preprocess, wordOffsets } from '../../src/engine/supertonic';
import { SUPERTONIC_VOICES, DEFAULT_SUPERTONIC_VOICE } from '../../src/shared/settings';

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
