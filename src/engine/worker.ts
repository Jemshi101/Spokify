// TTS engine: a module Web Worker inside the audio host. Loads Kokoro (GPU) or a Piper voice (CPU)
// and generates audio + word timings.
import { KokoroTTS, env } from 'kokoro-js';
import { env as hfEnv } from '@huggingface/transformers';
import { DEFAULT_PIPER_VOICE, ENGINES, PIPER_VOICES, type EngineChoice, type EngineId } from '../shared/settings';
import type { LoadInfo } from '../shared/messages';
import { phonemizeEspeak, phonemizeText, phonemizeWord } from './phonemize';
import { alignPhonemes, positionsToTimes } from './align';
import { PiperVoice, estimateWordTimes } from './piper';

// Never load code from a CDN: ONNX Runtime's .mjs/.wasm ship inside the extension.
env.wasmPaths = new URL('ort/', self.location.href).href;
hfEnv.allowLocalModels = false;
// CPU engine threads: ONNX Runtime picks the count (more was slower on an M1, whose extra cores are
// efficiency cores). `?threads=N` on the worker URL overrides it for benchmarks.
const threadParam = Number(new URL(self.location.href).searchParams.get('threads'));
if (threadParam > 0) hfEnv.backends.onnx.wasm!.numThreads = threadParam;

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX-timestamped';

type Model = (inputs: Record<string, unknown>) => Promise<Record<string, { data: ArrayLike<number | bigint> }>>;

let tts: KokoroTTS | null = null;
let rawModel: (Model & { dispose(): Promise<void> }) | null = null;
let loaded: LoadInfo | null = null;
let loading: Promise<LoadInfo> | null = null;
let lastOutputs: Record<string, { data: ArrayLike<number | bigint> }> | null = null;
let piper: PiperVoice | null = null;

const isPiperVoice = (v?: string) => !!v && PIPER_VOICES.some((p) => p.id === v);

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

let gpuCheck: Promise<boolean> | null = null;
function hasWebGPU(): Promise<boolean> {
  gpuCheck ??= (async () => {
    try {
      return !!(await (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter());
    } catch {
      return false;
    }
  })();
  return gpuCheck;
}

/** One model in memory at a time: switching families frees the other one. */
async function disposeAll() {
  if (rawModel) {
    try { await rawModel.dispose(); } catch {}
  }
  await piper?.dispose();
  tts = null;
  rawModel = null;
  piper = null;
  loaded = null;
}

async function loadPiper(voice: string): Promise<void> {
  await disposeAll();
  piper = await PiperVoice.load(voice, (file, loaded, total) => post({ type: 'progress', file, loaded, total }));
}

async function loadEngine(engine: EngineId): Promise<void> {
  await disposeAll();
  const instance = await KokoroTTS.from_pretrained(MODEL_ID, {
    device: ENGINES[engine].device,
    dtype: ENGINES[engine].dtype,
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress') post({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
    },
  });
  // Wrap the model so the timestamped export's `durations` output is captured on every call.
  const model = instance.model as unknown as Model & { dispose(): Promise<void> };
  rawModel = model;
  (instance as unknown as { model: Model }).model = async (inputs) => {
    const out = await model(inputs);
    lastOutputs = out;
    return out;
  };
  tts = instance;
}

/** Frees the ~165 MB fp16 model that 0.2.0 downloaded; nothing uses it any more. */
async function dropUnusedModels() {
  try {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) if (/model_fp16\.onnx/.test(req.url)) await cache.delete(req);
    }
  } catch {}
}

const CALIBRATION = 'This short sentence measures how quickly your computer can speak.';

/** Frees the model (and its GPU memory), e.g. when the host switches engines. */
async function unload() {
  await disposeAll();
  return { ok: true };
}

async function load({ engine = 'auto', voice }: { engine?: EngineChoice; voice?: string }): Promise<LoadInfo> {
  const gpu = await hasWebGPU();
  // Kokoro fp32 on WebGPU (fp16 is faster but garbled); without WebGPU, Piper on the CPU.
  const target: EngineId = engine in ENGINES ? (engine as EngineId) : gpu ? 'webgpu-fp32' : 'piper';
  const piperVoice = isPiperVoice(voice) ? voice! : (piper?.id ?? DEFAULT_PIPER_VOICE);
  const ready = () => loaded && loaded.engine === target && (target !== 'piper' || loaded.voice === piperVoice || !isPiperVoice(voice));
  if (ready()) return { ...loaded!, cached: true };
  if (loading) await loading.catch(() => {});
  if (ready()) return { ...loaded!, cached: true };

  if (target === 'piper') {
    loading = (async () => {
      const t0 = performance.now();
      await loadPiper(piperVoice);
      const r = await synthPiper(CALIBRATION, [], 1);
      loaded = { engine: 'piper', voice: piperVoice, requested: engine, loadMs: Math.round(performance.now() - t0), cached: false, realtime: +(r.audioSec / (r.genMs / 1000)).toFixed(2) };
      return loaded;
    })();
    try {
      return await loading;
    } finally {
      loading = null;
    }
  }

  loading = (async () => {
    const t0 = performance.now();
    let used: EngineId = target;
    let fallbackReason: string | undefined;
    let realtime: number | undefined;
    try {
      if (ENGINES[target].device === 'webgpu' && !gpu) throw new Error('WebGPU is not available');
      await loadEngine(target);
      await synth('Ready.', ['Ready'], 'af_heart', 1); // compiles GPU shaders; also verifies the engine works
      if (ENGINES[target].device === 'webgpu') {
        // How fast is this GPU? Weak integrated GPUs can be slower than real time (and long GPU work
        // risks a driver reset on Windows); the host switches Auto to Lite voices then.
        const r = await synth(CALIBRATION, [], 'af_heart', 1);
        realtime = +(r.audioSec / (r.genMs / 1000)).toFixed(2);
      }
    } catch (e) {
      if (ENGINES[target].device !== 'webgpu') throw e;
      // WebGPU failed: Piper on the CPU is the light fallback (Kokoro on the CPU is too slow).
      fallbackReason = String((e as Error)?.message ?? e);
      used = 'piper';
      await loadPiper(DEFAULT_PIPER_VOICE);
    }
    loaded = { engine: used, voice: used === 'piper' ? DEFAULT_PIPER_VOICE : undefined, requested: engine, loadMs: Math.round(performance.now() - t0), cached: false, fallbackReason, realtime: used === target ? realtime : undefined };
    dropUnusedModels();
    return loaded;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

async function synth(text: string, words: string[], voice: string, speed: number) {
  if (!tts) throw new Error('Engine not loaded');
  const lang = voice.startsWith('b') ? 'b' : 'a';
  const ps = await phonemizeText(text, lang);
  const ids = tts.tokenizer(ps, { truncation: true }).input_ids;
  const t0 = performance.now();
  const audio = await tts.generate_from_ids(ids, { voice: voice as never, speed });
  const genMs = performance.now() - t0;
  const samples = audio.audio as Float32Array;
  const audioSec = samples.length / audio.sampling_rate;

  let wordTimes: number[] = [];
  let exact = false;
  const durKey = lastOutputs && Object.keys(lastOutputs).find((k) => k !== 'waveform');
  if (durKey && words.length) {
    const durations = Array.from(lastOutputs![durKey].data, Number);
    if (durations.length === ps.length + 2) {
      const wordPs = await Promise.all(words.map((w) => phonemizeWord(w, lang)));
      const aligned = alignPhonemes(wordPs, ps);
      wordTimes = positionsToTimes(aligned.wordStarts, durations, audioSec);
      exact = aligned.quality >= 0.6 && aligned.wordStarts.every((p) => p >= 0);
    }
  }
  return { samples, sampleRate: audio.sampling_rate, audioSec, genMs: Math.round(genMs), wordTimes, exact };
}

/** Piper: espeak phonemes → audio; word times estimated from the phoneme alignment. */
async function synthPiper(text: string, words: string[], speed: number) {
  if (!piper) throw new Error('Engine not loaded');
  const lang = piper.espeakVoice;
  const ps = await phonemizeEspeak(text, lang);
  const t0 = performance.now();
  const { samples, sampleRate } = await piper.synthesize(ps, speed);
  const genMs = performance.now() - t0;
  const audioSec = samples.length / sampleRate;
  let wordTimes: number[] = [];
  if (words.length) {
    const wordPs = await Promise.all(words.map((w) => phonemizeWord(w, lang)));
    wordTimes = estimateWordTimes(alignPhonemes(wordPs, ps).wordStarts, ps, audioSec);
  }
  return { samples, sampleRate, audioSec, genMs: Math.round(genMs), wordTimes, exact: false };
}

const synthWith = (engine: EngineId, text: string, words: string[], voice: string, speed: number) =>
  engine === 'piper' ? synthPiper(text, words, speed) : synth(text, words, voice, speed);

async function generate(p: { text: string; words: string[]; voice: string; speed: number; engine: EngineChoice }) {
  const info = await load({ engine: p.engine, voice: p.voice });
  return { ...(await synthWith(info.engine, p.text, p.words, p.voice, p.speed)), engine: info.engine, voice: info.voice, realtime: info.realtime };
}

const BENCH = [
  'The quick brown fox jumps over the lazy dog, and then it takes a well deserved nap in the warm afternoon sun.',
  'Reading long articles out loud should feel natural, with steady pacing and clear pronunciation.',
  'In 2024, researchers released an eighty two million parameter model that runs comfortably inside a web browser.',
];

async function benchmark({ engine }: { engine: EngineId }) {
  const info = await load({ engine });
  let genMs = 0;
  let audioSec = 0;
  for (const text of BENCH) {
    const r = await synthWith(info.engine, text, [], 'af_heart', 1);
    genMs += r.genMs;
    audioSec += r.audioSec;
  }
  return { ...info, genMs, audioSec: +audioSec.toFixed(2), speedVsRealtime: +((audioSec * 1000) / genMs).toFixed(2) };
}

async function envReport() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: Record<string, string> } | null> } }).gpu;
  let adapter: Record<string, unknown> | null = null;
  try {
    const a = gpu && (await gpu.requestAdapter());
    if (a) adapter = { vendor: a.info?.vendor, architecture: a.info?.architecture };
  } catch (e) {
    adapter = { error: String(e) };
  }
  return {
    webgpu: !!gpu,
    adapter,
    crossOriginIsolated: self.crossOriginIsolated,
    hardwareConcurrency: navigator.hardwareConcurrency,
    loaded,
  };
}

const handlers: Record<string, (p: any) => Promise<unknown>> = { load, generate, benchmark, envReport, unload };

// One request at a time: ONNX Runtime can't run one session concurrently, and overlapping GPU work
// on a weak GPU makes driver resets more likely. envReport answers immediately (diagnostics).
let queue: Promise<unknown> = Promise.resolve();

self.onmessage = ({ data }: MessageEvent<{ id: number; method: string; params?: unknown }>) => {
  const { id, method, params } = data;
  const run = async () => {
    try {
      const result = (await handlers[method](params ?? {})) as { samples?: Float32Array } | undefined;
      post({ id, result }, result?.samples ? [result.samples.buffer] : []);
    } catch (e) {
      post({ id, error: String((e as Error)?.message ?? e) });
    }
  };
  if (method === 'envReport') run();
  else queue = queue.then(run);
};
