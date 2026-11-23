import { describe, expect, it } from 'vitest';
import { estimateWordTimes, phonemeIds } from '../../src/engine/piper';
import { DEFAULT_PIPER_VOICE, PIPER_VOICES, piperUrls } from '../../src/shared/settings';

const MAP = { _: [0], '^': [1], $: [2], ' ': [3], h: [20], ə: [59], l: [24], ˈ: [120], o: [27], ʊ: [100], ',': [8] };

describe('phonemeIds', () => {
  it('wraps in BOS/EOS and pads after every phoneme, like Piper', () => {
    expect(phonemeIds('həl', MAP)).toEqual([1, 20, 0, 59, 0, 24, 0, 2]);
  });
  it('skips phonemes the voice does not know', () => {
    expect(phonemeIds('hXl', MAP)).toEqual([1, 20, 0, 24, 0, 2]);
  });
  it('splits combined characters (NFD) the way Piper does', () => {
    // "é" composed → e + combining acute; neither is in this map except via NFD pieces
    expect(phonemeIds('hé', { ...MAP, e: [5], '́': [6] })).toEqual([1, 20, 0, 5, 0, 6, 0, 2]);
  });
});

describe('estimateWordTimes', () => {
  const ps = 'həlˈoʊ wˈɜːld, ænd ɡʊdbˈaɪ.';
  it('starts near zero, stays inside the audio and increases', () => {
    const t = estimateWordTimes([0, 7, 15, 19], ps, 2);
    expect(t[0]).toBeLessThan(0.15);
    expect(t.at(-1)!).toBeLessThan(2);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
  });
  it('gives commas a pause', () => {
    const t = estimateWordTimes([0, 7, 15], ps, 2);
    // "and" comes after "world," — its gap includes the comma's pause
    expect(t[2] - t[1]).toBeGreaterThan(t[1] - t[0]);
  });
  it('unmatched words reuse the previous time', () => {
    const t = estimateWordTimes([0, -1, 15], ps, 2);
    expect(t[1]).toBe(t[0]);
  });
});

describe('Piper voices', () => {
  it('builds Hugging Face URLs from voice ids', () => {
    expect(piperUrls('en_GB-alba-medium').model).toBe('https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx');
    expect(piperUrls('en_US-hfc_female-medium').config).toBe(
      'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx.json',
    );
  });
  it('includes the default voice', () => {
    expect(PIPER_VOICES.some((v) => v.id === DEFAULT_PIPER_VOICE)).toBe(true);
  });
});
