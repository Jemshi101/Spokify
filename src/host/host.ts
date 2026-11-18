// Audio host (offscreen document, or a pinned tab where chrome.offscreen is missing).
// Owns the TTS worker and playback, so reading continues while the user switches tabs.
import { splitSpeed, type EngineChoice, type Settings } from '../shared/settings';
import type { HostCommand, HostStatus, LoadInfo, ReadingStats, SpeechSegment, TabEvent } from '../shared/messages';
import { floatWav } from './wav';

const LOOKAHEAD = 3;

// ---------- worker RPC ----------

const worker = new Worker('worker.js', { type: 'module' });
const pending = new Map<number, { resolve(v: any): void; reject(e: Error): void }>();
let nextId = 1;
const downloads = new Map<string, { loaded: number; total: number }>();

function rpc<T = any>(method: string, params?: unknown): Promise<T> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, method, params });
  });
}

worker.onmessage = ({ data }) => {
  if (data.type === 'progress') {
    downloads.set(data.file, { loaded: data.loaded, total: data.total });
    chrome.runtime.sendMessage({ target: 'ui', ...data }).catch(() => {});
    if (session) {
      let loaded = 0, total = 0;
      for (const d of downloads.values()) { loaded += d.loaded; total += d.total; }
      toTab(session.tabId, { type: 'loading', percent: total ? Math.round((loaded / total) * 100) : null });
    }
    return;
  }
  const p = pending.get(data.id);
  if (!p) return;
  pending.delete(data.id);
  data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
};

// ---------- session ----------

interface Clip {
  url: string;
  audioSec: number;
  wordTimes: number[];
  exact: boolean;
  modelSpeed: number;
}

interface Session {
  tabId: number;
  segments: SpeechSegment[];
  settings: Settings;
  idx: number;
  genIdx: number;
  epoch: number;
  clips: Map<number, Clip>;
  audio: HTMLAudioElement | null;
  paused: boolean;
  waiting: boolean;
  pumping: boolean;
  t0: number;
  engine: LoadInfo['engine'] | null;
  stats: ReadingStats;
}

let session: Session | null = null;

function toTab(tabId: number, payload: TabEvent) {
  chrome.runtime.sendMessage({ target: 'sw', type: 'toTab', tabId, payload }).catch(() => {});
}

function status(): HostStatus {
  const s = session;
  return {
    active: !!s,
    paused: !!s?.paused,
    tabId: s?.tabId ?? null,
    sid: s?.idx ?? null,
    total: s?.segments.length ?? 0,
    engine: s?.engine ?? null,
    stats: s?.stats ?? null,
  };
}

function emit(s: Session, payload: TabEvent) {
  toTab(s.tabId, payload);
  chrome.runtime.sendMessage({ target: 'ui', type: 'status', status: status() }).catch(() => {});
}

function dropClip(s: Session, i: number) {
  const c = s.clips.get(i);
  if (c) URL.revokeObjectURL(c.url);
  s.clips.delete(i);
}

function sync(s: Session) {
  if (!s.audio) return;
  emit(s, { type: 'sync', sid: s.idx, pos: s.audio.currentTime, rate: s.audio.playbackRate, paused: s.paused });
}

async function read({ tabId, segments, settings, startAt = 0 }: { tabId: number; segments: SpeechSegment[]; settings: Settings; startAt?: number }) {
  stop();
  const s: Session = {
    tabId,
    segments,
    settings,
    idx: startAt,
    genIdx: startAt,
    epoch: 0,
    clips: new Map(),
    audio: null,
    paused: false,
    waiting: true,
    pumping: false,
    t0: performance.now(),
    engine: null,
    stats: { generated: 0, genMs: 0, audioSec: 0, exactWords: 0, firstAudioMs: null },
  };
  session = s;
  emit(s, { type: 'buffering', sid: s.idx, total: segments.length });
  pump(s);
}

async function pump(s: Session) {
  if (s.pumping) return;
  s.pumping = true;
  try {
    while (session === s && s.genIdx < s.segments.length && s.genIdx - s.idx < LOOKAHEAD) {
      const i = s.genIdx++;
      if (i < s.idx || s.clips.has(i)) continue;
      const epoch = s.epoch;
      const { modelSpeed } = splitSpeed(s.settings.speed);
      const seg = s.segments[i];
      const r = await rpc('generate', {
        text: seg.text,
        words: seg.words,
        voice: s.settings.voice,
        speed: modelSpeed,
        engine: s.settings.engine as EngineChoice,
      });
      if (session !== s) return;
      s.engine = r.engine;
      if (epoch !== s.epoch || i < s.idx) continue;
      s.clips.set(i, { url: URL.createObjectURL(floatWav(r.samples, r.sampleRate)), audioSec: r.audioSec, wordTimes: r.wordTimes, exact: r.exact, modelSpeed });
      s.stats.generated++;
      s.stats.genMs += r.genMs;
      s.stats.audioSec += r.audioSec;
      if (r.exact) s.stats.exactWords++;
      if (s.waiting && i === s.idx) playCurrent(s);
    }
  } catch (e) {
    if (session === s) {
      emit(s, { type: 'error', message: String((e as Error).message ?? e) });
      teardown(s);
    }
  } finally {
    s.pumping = false;
  }
}

function playCurrent(s: Session) {
  if (session !== s) return;
  if (s.idx >= s.segments.length) {
    emit(s, { type: 'ended' });
    session = null;
    return;
  }
  const clip = s.clips.get(s.idx);
  if (!clip) {
    s.waiting = true;
    emit(s, { type: 'buffering', sid: s.idx, total: s.segments.length });
    if (s.genIdx > s.idx + LOOKAHEAD || s.genIdx < s.idx) s.genIdx = s.idx;
    pump(s);
    return;
  }
  s.waiting = false;
  const audio = new Audio(clip.url);
  audio.preservesPitch = true;
  audio.playbackRate = s.settings.speed / clip.modelSpeed;
  audio.onended = () => {
    if (session !== s || s.audio !== audio) return;
    dropClip(s, s.idx);
    s.idx++;
    playCurrent(s);
  };
  s.audio = audio;
  const started = () => {
    if (session !== s || s.audio !== audio) return;
    s.stats.firstAudioMs ??= Math.round(performance.now() - s.t0);
    emit(s, { type: 'sentence', sid: s.idx, total: s.segments.length, wordTimes: clip.wordTimes, duration: clip.audioSec, rate: audio.playbackRate });
    if (s.paused) sync(s);
  };
  if (s.paused) {
    started();
  } else {
    audio.play().then(started, (e) => emit(s, { type: 'error', message: `Playback failed: ${e.message}` }));
  }
  pump(s);
}

function stopAudio(s: Session) {
  if (!s.audio) return;
  s.audio.onended = null;
  s.audio.pause();
  s.audio = null;
}

function pause() {
  const s = session;
  if (!s || s.paused) return;
  s.paused = true;
  s.audio?.pause();
  sync(s);
  if (!s.audio) emit(s, { type: 'sync', sid: s.idx, pos: 0, rate: 1, paused: true });
}

function resume() {
  const s = session;
  if (!s || !s.paused) return;
  s.paused = false;
  if (s.audio) s.audio.play().then(() => sync(s), () => {});
  else emit(s, { type: 'sync', sid: s.idx, pos: 0, rate: 1, paused: false });
}

function jump(target: number) {
  const s = session;
  if (!s) return;
  target = Math.max(0, Math.min(s.segments.length - 1, target));
  stopAudio(s);
  for (const k of [...s.clips.keys()]) if (k < target || k > target + LOOKAHEAD) dropClip(s, k);
  s.idx = target;
  s.genIdx = target;
  playCurrent(s);
}

function teardown(s: Session) {
  if (session === s) session = null;
  stopAudio(s);
  for (const k of [...s.clips.keys()]) dropClip(s, k);
}

function stop() {
  const s = session;
  if (!s) return;
  teardown(s);
  emit(s, { type: 'stopped' });
}

function applySettings(next: Settings) {
  const s = session;
  if (!s) return;
  const prev = s.settings;
  s.settings = next;
  const needsRegen =
    prev.voice !== next.voice || prev.engine !== next.engine || splitSpeed(prev.speed).modelSpeed !== splitSpeed(next.speed).modelSpeed;
  if (needsRegen) {
    // Keep the sentence that's playing; regenerate everything queued after it.
    s.epoch++;
    for (const k of [...s.clips.keys()]) if (k !== s.idx || !s.audio) dropClip(s, k);
    s.genIdx = s.clips.has(s.idx) ? s.idx + 1 : s.idx;
    pump(s);
  }
  if (s.audio) {
    const clip = s.clips.get(s.idx);
    if (clip) s.audio.playbackRate = next.speed / clip.modelSpeed;
    sync(s);
  }
}

async function speakSample({ text, settings }: { text: string; settings: Settings }) {
  stop();
  const { modelSpeed, rate } = splitSpeed(settings.speed);
  const r = await rpc('generate', { text, words: [], voice: settings.voice, speed: modelSpeed, engine: settings.engine });
  const audio = new Audio(URL.createObjectURL(floatWav(r.samples, r.sampleRate)));
  audio.playbackRate = rate;
  await audio.play();
  return { genMs: r.genMs, audioSec: +r.audioSec.toFixed(2), speedVsRealtime: +(r.audioSec / (r.genMs / 1000)).toFixed(2) };
}

const actions: Record<HostCommand['type'], (m: any) => unknown> = {
  ping: () => ({ ok: true, kind: chrome.tabs ? 'tab' : 'offscreen' }),
  warmup: (m) => (rpc('load', { engine: m.settings.engine }).catch(() => {}), { ok: true }),
  read: (m) => (read(m), { ok: true }),
  settings: (m) => applySettings(m.settings),
  pause,
  resume,
  toggle: () => (session?.paused ? resume() : pause()),
  next: () => session && jump(session.idx + 1),
  prev: () => session && jump(session.idx - 1),
  jump: (m) => jump(m.sid),
  stop,
  status,
  env: async () => ({ host: { crossOriginIsolated: self.crossOriginIsolated }, worker: await rpc('envReport') }),
  benchmark: (m) => rpc('benchmark', { engine: m.engine }),
  speakSample,
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'host') return;
  const fn = actions[msg.type as HostCommand['type']];
  if (!fn) return;
  Promise.resolve()
    .then(() => fn(msg))
    .then((r) => sendResponse(r ?? { ok: true }), (e) => sendResponse({ error: String(e?.message ?? e) }));
  return true;
});
