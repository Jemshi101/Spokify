// Supertonic (Supertone Inc.): a flow-matching TTS that reads plain characters (no phonemizer).
// Pipeline ported from the MIT-licensed browser example in supertone-inc/supertonic (web/helper.js);
// model weights are OpenRAIL-M. Files come from the supertone-oss-archive Hugging Face mirror.
import * as ort from 'onnxruntime-web';

export const SUPERTONIC_REPOS = {
  3: { repo: 'supertone-oss-archive/supertonic-3', rev: 'aafc6e32416a594460b32413efc49d7fe4ce6d46' },
  2: { repo: 'supertone-oss-archive/supertonic-2', rev: '7edbcd0bba8cd579100a353a9e0b2b49cad7c875' },
} as const;
export type SupertonicVersion = keyof typeof SUPERTONIC_REPOS;

const fileUrl = (v: SupertonicVersion, path: string) => `https://huggingface.co/${SUPERTONIC_REPOS[v].repo}/resolve/${SUPERTONIC_REPOS[v].rev}/${path}`;

interface Config {
  ae: { sample_rate: number; base_chunk_size: number };
  ttl: { chunk_compress_factor: number; latent_dim: number };
}

/** Text clean-up from the reference implementation, then the language tag the model expects. */
export function preprocess(text: string, lang = 'en'): string {
  let t = text.normalize('NFKD');
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu, '');
  const map: Record<string, string> = {
    '–': '-', '‑': '-', '—': '-', _: ' ', '“': '"', '”': '"', '‘': "'", '’': "'", '´': "'", '`': "'",
    '[': ' ', ']': ' ', '|': ' ', '/': ' ', '#': ' ', '→': ' ', '←': ' ',
  };
  for (const [k, v] of Object.entries(map)) t = t.replaceAll(k, v);
  t = t.replace(/[♥☆♡©\\]/g, '');
  t = t.replaceAll('@', ' at ').replaceAll('e.g.,', 'for example, ').replaceAll('i.e.,', 'that is, ');
  t = t.replace(/ ([,.!?;:'])/g, '$1');
  t = t.replace(/"{2,}/g, '"').replace(/'{2,}/g, "'");
  t = t.replace(/\s+/g, ' ').trim();
  if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(t)) t += '.';
  return `<${lang}>${t}</${lang}>`;
}

/** Start offset of each word in `text`, found in order (-1 if a word can't be found). */
export function wordOffsets(text: string, words: string[]): number[] {
  const out: number[] = [];
  let from = 0;
  for (const w of words) {
    const i = text.indexOf(w, from);
    out.push(i);
    if (i >= 0) from = i + w.length;
  }
  return out;
}

type Progress = (file: string, loaded: number, total: number) => void;

async function cachedFetch(url: string, onProgress?: Progress): Promise<ArrayBuffer> {
  const cache = await caches.open('spokify-supertonic');
  const hit = await cache.match(url);
  if (hit) return hit.arrayBuffer();
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`Couldn't download the Supertonic voice (${r.status})`);
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
  await cache.put(url, new Response(blob));
  return blob.arrayBuffer();
}

const json = async (url: string) => JSON.parse(new TextDecoder().decode(await cachedFetch(url)));

/** Standard normal samples (Box–Muller). */
function gaussian(n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u1 = Math.max(1e-4, Math.random());
    const u2 = Math.random();
    const r = Math.sqrt(-2 * Math.log(u1));
    out[i] = r * Math.cos(2 * Math.PI * u2);
    if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * u2);
  }
  return out;
}

export class SupertonicVoice {
  private styles = new Map<string, { ttl: ort.Tensor; dp: ort.Tensor }>();

  private constructor(
    readonly version: SupertonicVersion,
    private cfg: Config,
    private indexer: number[],
    private dp: ort.InferenceSession,
    private enc: ort.InferenceSession,
    private est: ort.InferenceSession,
    private voc: ort.InferenceSession,
  ) {}

  get sampleRate() {
    return this.cfg.ae.sample_rate;
  }

  static async load(version: SupertonicVersion, onProgress?: Progress): Promise<SupertonicVoice> {
    const cfg = (await json(fileUrl(version, 'onnx/tts.json'))) as Config;
    const indexer = (await json(fileUrl(version, 'onnx/unicode_indexer.json'))) as number[];
    const opts: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'] };
    const session = async (name: string) =>
      ort.InferenceSession.create(new Uint8Array(await cachedFetch(fileUrl(version, `onnx/${name}.onnx`), onProgress)), opts);
    const dp = await session('duration_predictor');
    const enc = await session('text_encoder');
    const est = await session('vector_estimator');
    const voc = await session('vocoder');
    return new SupertonicVoice(version, cfg, indexer, dp, enc, est, voc);
  }

  private async style(name: string) {
    let s = this.styles.get(name);
    if (!s) {
      const v = (await json(fileUrl(this.version, `voice_styles/${name}.json`))) as {
        style_ttl: { dims: number[]; data: unknown[] };
        style_dp: { dims: number[]; data: unknown[] };
      };
      s = {
        ttl: new ort.Tensor('float32', Float32Array.from(v.style_ttl.data.flat(Infinity) as number[]), v.style_ttl.dims),
        dp: new ort.Tensor('float32', Float32Array.from(v.style_dp.data.flat(Infinity) as number[]), v.style_dp.dims),
      };
      this.styles.set(name, s);
    }
    return s;
  }

  /** Text → audio. `steps` trades speed for quality (reference default 8); `speed` > 1 is faster. */
  async synthesize(text: string, voice: string, speed = 1, steps = 8): Promise<{ samples: Float32Array; sampleRate: number }> {
    const style = await this.style(voice);
    const processed = preprocess(text);
    const n = processed.length;
    const ids = new BigInt64Array(n);
    for (let i = 0; i < n; i++) {
      const cp = processed.codePointAt(i)!;
      ids[i] = BigInt(cp < this.indexer.length ? this.indexer[cp] : -1);
    }
    const textIds = new ort.Tensor('int64', ids, [1, n]);
    const textMask = new ort.Tensor('float32', new Float32Array(n).fill(1), [1, 1, n]);

    const dur = (await this.dp.run({ text_ids: textIds, style_dp: style.dp, text_mask: textMask })).duration.data as Float32Array;
    // The reference default speaks at 1.05×; keep that as Spokify's 1×.
    const seconds = dur[0] / (speed * 1.05);
    const textEmb = (await this.enc.run({ text_ids: textIds, style_ttl: style.ttl, text_mask: textMask })).text_emb;

    const { sample_rate, base_chunk_size } = this.cfg.ae;
    const chunk = base_chunk_size * this.cfg.ttl.chunk_compress_factor;
    const latentDim = this.cfg.ttl.latent_dim * this.cfg.ttl.chunk_compress_factor;
    const wavLen = Math.floor(seconds * sample_rate);
    const latentLen = Math.floor((wavLen + chunk - 1) / chunk);
    let xt = gaussian(latentDim * latentLen);
    const latentMask = new ort.Tensor('float32', new Float32Array(latentLen).fill(1), [1, 1, latentLen]);
    const total = new ort.Tensor('float32', Float32Array.of(steps), [1]);
    for (let step = 0; step < steps; step++) {
      const out = await this.est.run({
        noisy_latent: new ort.Tensor('float32', xt, [1, latentDim, latentLen]),
        text_emb: textEmb,
        style_ttl: style.ttl,
        latent_mask: latentMask,
        text_mask: textMask,
        current_step: new ort.Tensor('float32', Float32Array.of(step), [1]),
        total_step: total,
      });
      xt = Float32Array.from(out.denoised_latent.data as Float32Array);
    }
    const wav = (await this.voc.run({ latent: new ort.Tensor('float32', xt, [1, latentDim, latentLen]) })).wav_tts.data as Float32Array;
    // The vocoder pads to whole latent chunks; trim to the predicted length.
    return { samples: Float32Array.from(wav.subarray(0, Math.min(wav.length, wavLen))), sampleRate: sample_rate };
  }

  async dispose() {
    for (const s of [this.dp, this.enc, this.est, this.voc]) await s.release().catch(() => {});
  }
}
