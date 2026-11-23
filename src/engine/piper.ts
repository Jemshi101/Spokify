// Piper (VITS) voices on the CPU: small (~63 MB), fast, natural-sounding. The engine for computers
// whose graphics are too slow for Kokoro. Models and configs come from rhasspy/piper-voices.
import * as ort from 'onnxruntime-web';
import { piperUrls } from '../shared/settings';

export interface PiperConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference?: { noise_scale?: number; length_scale?: number; noise_w?: number };
  num_speakers: number;
  phoneme_id_map: Record<string, number[]>;
}

/**
 * Phonemes → model input ids, as Piper does it: BOS, then each phoneme followed by the pad id,
 * then EOS. Phonemes are Unicode code points after NFD; unknown ones are skipped.
 */
export function phonemeIds(phonemes: string, map: Record<string, number[]>): number[] {
  const ids = [...(map['^'] ?? [])];
  for (const p of phonemes.normalize('NFD')) {
    const id = map[p];
    if (!id) continue;
    ids.push(...id, ...(map['_'] ?? []));
  }
  ids.push(...(map['$'] ?? []));
  return ids;
}

/** How long each phoneme character takes, relative to an average sound (estimates for Piper). */
function weight(ch: string): number {
  if (ch === 'ˈ' || ch === 'ˌ') return 0; // stress marks
  if (ch === 'ː') return 0.6; // length mark
  if (ch === ' ') return 0.25;
  if (',;:—–'.includes(ch)) return 3;
  if ('.!?…'.includes(ch)) return 5;
  if ('"«»“”()'.includes(ch)) return 0.5;
  return 1;
}

/**
 * Word start times for Piper, which doesn't report durations: each word's aligned position in the
 * sentence's phonemes, spread over the audio by estimated phoneme lengths. `-1` positions (unmatched
 * words) take the previous word's time.
 */
export function estimateWordTimes(wordStarts: number[], phonemes: string, audioSec: number): number[] {
  const cum = [0];
  for (const ch of phonemes) cum.push(cum[cum.length - 1] + weight(ch));
  const total = cum[cum.length - 1] || 1;
  // Piper leaves a little silence at both ends.
  const lead = Math.min(0.12, audioSec * 0.05);
  const span = Math.max(0, audioSec - lead * 2);
  const times: number[] = [];
  let last = 0;
  for (const pos of wordStarts) {
    const t = pos >= 0 ? lead + (cum[Math.min(pos, cum.length - 1)] / total) * span : last;
    last = Math.max(last, t);
    times.push(last);
  }
  return times;
}

type Progress = (file: string, loaded: number, total: number) => void;

/** Downloads once into Cache Storage, reporting progress; later loads come from the cache. */
async function cachedFetch(url: string, onProgress?: Progress): Promise<ArrayBuffer> {
  const cache = await caches.open('spokify-piper');
  const hit = await cache.match(url);
  if (hit) return hit.arrayBuffer();
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`Couldn't download the Piper voice (${r.status})`);
  const total = Number(r.headers.get('content-length')) || 0;
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(url.split('/').pop()!, loaded, total);
  }
  const blob = new Blob(chunks as BlobPart[]);
  await cache.put(url, new Response(blob, { headers: { 'content-type': 'application/octet-stream' } }));
  return blob.arrayBuffer();
}

/** Keeps at most a few voices cached (each ~63 MB). */
async function trimCache(keep: string[]) {
  const cache = await caches.open('spokify-piper');
  const reqs = await cache.keys();
  const voices = [...new Set(reqs.map((r) => r.url.replace(/\.onnx(\.json)?$/, '')))];
  for (const v of voices.slice(0, Math.max(0, voices.length - 3))) {
    if (keep.some((k) => v.endsWith(k))) continue;
    for (const r of reqs) if (r.url.startsWith(v)) await cache.delete(r);
  }
}

export class PiperVoice {
  private constructor(
    readonly id: string,
    readonly config: PiperConfig,
    private session: ort.InferenceSession,
  ) {}

  static async load(id: string, onProgress?: Progress): Promise<PiperVoice> {
    const urls = piperUrls(id);
    const config = JSON.parse(new TextDecoder().decode(await cachedFetch(urls.config))) as PiperConfig;
    const model = await cachedFetch(urls.model, onProgress);
    const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] });
    trimCache([id]).catch(() => {});
    return new PiperVoice(id, config, session);
  }

  get espeakVoice() {
    return this.config.espeak.voice;
  }

  /** Phonemes → audio. speed > 1 is faster (Piper's length_scale is its inverse). */
  async synthesize(phonemes: string, speed: number): Promise<{ samples: Float32Array; sampleRate: number }> {
    const ids = phonemeIds(phonemes, this.config.phoneme_id_map);
    const inf = this.config.inference ?? {};
    const feeds: Record<string, ort.Tensor> = {
      input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) / speed, inf.noise_w ?? 0.8]), [3]),
    };
    if (this.config.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
    const out = await this.session.run(feeds);
    const samples = Float32Array.from(out[this.session.outputNames[0]].data as Float32Array);
    return { samples, sampleRate: this.config.audio.sample_rate };
  }

  async dispose() {
    await this.session.release().catch(() => {});
  }
}
