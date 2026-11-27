import { describe, expect, it } from 'vitest';
import { chunkSentences, outputLanguage, parseSummary } from '../../src/shared/summarize';

describe('chunkSentences', () => {
  it('groups whole sentences up to the limit', () => {
    expect(chunkSentences(['One two.', 'Three four.', 'Five six.'], 20)).toEqual(['One two. Three four.', 'Five six.']);
  });
  it('cuts a sentence longer than the limit', () => {
    expect(chunkSentences(['Short.', 'x'.repeat(25)], 10)).toEqual(['Short.', 'x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
  });
  it('keeps every character', () => {
    const s = Array.from({ length: 50 }, (_, i) => `Sentence ${i} says something.`);
    expect(chunkSentences(s, 120).join(' ')).toBe(s.join(' '));
  });
});

describe('parseSummary', () => {
  it('reads list items and paragraphs, dropping markdown markers', () => {
    const md = '## Overview\nAgents act **on their own**.\n\n* First _point_\n- Second `point`\n1. Third point';
    expect(parseSummary(md)).toEqual([
      { list: false, text: 'Overview' },
      { list: false, text: 'Agents act on their own.' },
      { list: true, text: 'First point' },
      { list: true, text: 'Second point' },
      { list: true, text: 'Third point' },
    ]);
  });
  it('keeps snake_case words and lone asterisks', () => {
    expect(parseSummary('Use max_tokens and 5 * 3.')).toEqual([{ list: false, text: 'Use max_tokens and 5 * 3.' }]);
  });
});

describe('outputLanguage', () => {
  it('uses the page language when the summarizer supports it, else English', () => {
    expect(outputLanguage('es-MX')).toBe('es');
    expect(outputLanguage('ja')).toBe('ja');
    expect(outputLanguage('de-DE')).toBe('de');
    expect(outputLanguage('ml-IN')).toBe('en');
    expect(outputLanguage('')).toBe('en');
  });
});
