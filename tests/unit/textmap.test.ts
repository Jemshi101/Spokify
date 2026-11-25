import { describe, expect, it } from 'vitest';
import { appendText, type TextMap } from '../../src/reader/extract';

/** Raw offset for a map position, the way rangeFor locates a range start. */
function rawAt(map: TextMap, pos: number) {
  for (let i = map.parts.length - 1; i >= 0; i--) {
    const p = map.parts[i];
    if (pos >= p.start || i === 0) return { node: p.node, offset: p.from + (pos - p.start) };
  }
  throw new Error('empty');
}

const text = (s: string) => ({ nodeValue: s }) as unknown as Text;

describe('appendText', () => {
  it('collapses whitespace runs but keeps later positions on the right letters', () => {
    const node = text('Gemini  functions as a hub,\n   to provide a comprehensive response.');
    const map: TextMap = { text: '', parts: [] };
    appendText(map, node, 0, node.nodeValue!.length);
    expect(map.text).toBe('Gemini functions as a hub, to provide a comprehensive response.');
    for (let pos = 0; pos < map.text.length; pos++) {
      const { offset } = rawAt(map, pos);
      const raw = node.nodeValue![offset];
      if (map.text[pos] === ' ') expect(raw).toMatch(/\s/);
      else expect(raw).toBe(map.text[pos]);
    }
    const w = map.text.indexOf('comprehensive');
    expect(rawAt(map, w).offset).toBe(node.nodeValue!.indexOf('comprehensive'));
  });

  it('handles a slice of a node and text across several nodes', () => {
    const a = text('  Hello   big ');
    const b = text('world  again');
    const map: TextMap = { text: '', parts: [] };
    appendText(map, a, 2, a.nodeValue!.length);
    appendText(map, b, 0, b.nodeValue!.length);
    expect(map.text).toBe('Hello big world again');
    const at = (word: string) => rawAt(map, map.text.indexOf(word));
    expect(at('big')).toEqual({ node: a, offset: 10 });
    expect(at('world')).toEqual({ node: b, offset: 0 });
    expect(at('again')).toEqual({ node: b, offset: 7 });
  });
});
