// Audio host (offscreen document, or a pinned tab where chrome.offscreen is missing).
// Owns speech generation and playback, so reading continues while the user switches tabs.
//
// Two playback paths behind one session:
//  - kokoro: the TTS worker renders sentences ahead of time; <audio> plays them.
//  - system: the browser's speechSynthesis (lite mode for machines without WebGPU);
//            word highlighting comes from its boundary events.
import { splitSpeed, type Settings } from '../shared/settings';
import type { HostCommand, HostStatus, LoadInfo, ReadingStats, SpeechSegment, TabEvent } from '../shared/messages';
import { floatWav } from './wav';
import { pickSystemVoice, systemVoices } from './voices';

const LOOKAHEAD = 3;
/** Below this many seconds of audio per second of work, Auto uses Lite voices instead of the GPU. */
const SLOW_REALTIME = 1.3;

/**
 * Set when Auto found the GPU too slow; cleared by choosing Auto again in the popup. Offscreen
 * documents can't use chrome.storage, so the service worker stores it and sends updates ('machine').
 * `slowLimit` lets tests raise the bar on fast machines.
 */
let gpuSlow: { realtime: number; at: number } | null = null;
let slowLimit = SLOW_REALTIME;
function applyMachine(m: { gpuSlow?: typeof gpuSlow; testSlowRealtime?: number }) {
  gpuSlow = m.gpuSlow ?? null;
  slowLimit = typeof m.testSlowRealtime === 'number' ? m.testSlowRealtime : SLOW_REALTIME;
}
const gpuSlowLoaded = chrome.runtime.sendMessage({ target: 'sw', type: 'machineState' }).then(applyMachine, () => {});

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

let gpuCheck: Promise<boolean> | null = null;
function hasWebGPU(): Promise<boolean> {
  gpuCheck ??= (async () => {
    try {
      return !!(await (navigator as any).gpu?.requestAdapter());
    } catch {
      return false;
    }
  })();
  return gpuCheck;
}

async function resolveKind(settings: Settings): Promise<'kokoro' | 'system'> {
  if (settings.engine === 'system') return 'system';
  if (settings.engine === 'auto') {
    await gpuSlowLoaded;
    return (await hasWebGPU()) && !gpuSlow ? 'kokoro' : 'system';
  }
  return 'kokoro';
}

// ---------- session ----------

interface Clip {
  url: string;
  audioSec: number;
  wordTimes: number[];
  exact: boolean;
  modelSpeed: number;
}

interface Session {
  kind: 'kokoro' | 'system';
  /** Lite mode: name of the system voice in use. */
  voiceName?: string;
  tabId: number;
  title: string;
  segments: SpeechSegment[];
  settings: Settings;
  idx: number;
  paused: boolean;
  t0: number;
  engine: HostStatus['engine'];
  stats: ReadingStats;
  // kokoro
  genIdx: number;
  epoch: number;
  clips: Map<number, Clip>;
  audio: HTMLAudioElement | null;
  waiting: boolean;
  pumping: boolean;
  // system
  utter: SpeechSynthesisUtterance | null;
  wordIdx: number;
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
    voice: s?.kind === 'system' ? (s.voiceName ?? null) : (s?.settings.voice ?? null),
    stats: s?.stats ?? null,
  };
}

function emit(s: Session, payload: TabEvent) {
  toTab(s.tabId, payload);
  if (payload.type !== 'word') chrome.runtime.sendMessage({ target: 'ui', type: 'status', status: status() }).catch(() => {});
}

async function read(m: { tabId: number; segments: SpeechSegment[]; settings: Settings; startAt?: number; title?: string }, restart = false) {
  // Same tab (restart, engine switch): replace silently. Another tab: tell the old one it stopped.
  if (session) restart || session.tabId === m.tabId ? teardown(session) : stop();
  const kind = await resolveKind(m.settings);
  const s: Session = {
    kind,
    tabId: m.tabId,
    title: m.title ?? '',
    segments: m.segments,
    settings: m.settings,
    idx: m.startAt ?? 0,
    paused: false,
    t0: performance.now(),
    engine: kind === 'system' ? 'system' : null,
    stats: { generated: 0, genMs: 0, audioSec: 0, exactWords: 0, firstAudioMs: null },
    genIdx: m.startAt ?? 0,
    epoch: 0,
    clips: new Map(),
    audio: null,
    waiting: true,
    pumping: false,
    utter: null,
    wordIdx: 0,
  };
  session = s;
  updateMediaSession(s);
  emit(s, { type: 'buffering', sid: s.idx, total: s.segments.length });
  if (kind === 'system') speakSystem(s, 0);
  else pump(s);
}

function finish(s: Session) {
  emit(s, { type: 'ended' });
  if (session === s) session = null;
  updateMediaSession(null);
}

// ---------- kokoro path ----------

function dropClip(s: Session, i: number) {
  const c = s.clips.get(i);
  if (c) URL.revokeObjectURL(c.url);
  s.clips.delete(i);
}

function sync(s: Session) {
  if (s.kind === 'system') {
    emit(s, { type: 'sync', sid: s.idx, pos: 0, rate: 1, paused: s.paused });
    return;
  }
  emit(s, { type: 'sync', sid: s.idx, pos: s.audio?.currentTime ?? 0, rate: s.audio?.playbackRate ?? 1, paused: s.paused });
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
        engine: s.settings.engine === 'system' ? 'auto' : s.settings.engine,
      });
      if (session !== s) return;
      s.engine = r.engine;
      if (await tooSlow(s.settings, r.realtime)) return void switchToLite(s, r.realtime);
      if (epoch !== s.epoch || i < s.idx) continue;
      s.clips.set(i, { url: URL.createObjectURL(floatWav(r.samples, r.sampleRate)), audioSec: r.audioSec, wordTimes: r.wordTimes, exact: r.exact, modelSpeed });
      s.stats.generated++;
      s.stats.genMs += r.genMs;
      s.stats.audioSec += r.audioSec;
      if (r.exact) s.stats.exactWords++;
      if (s.waiting && i === s.idx) playClip(s);
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

/** True (and remembered, and the GPU model freed) when Auto's GPU measured too slow for natural voices. */
async function tooSlow(settings: Settings, realtime: number | undefined): Promise<boolean> {
  await gpuSlowLoaded;
  if (settings.engine !== 'auto' || realtime == null || realtime >= slowLimit) return false;
  gpuSlow = { realtime, at: Date.now() };
  await chrome.runtime.sendMessage({ target: 'sw', type: 'saveMachine', gpuSlow }).catch(() => {});
  rpc('unload').catch(() => {});
  return true;
}

/** Auto found the GPU too slow for natural voices: continue this sentence with Lite voices. */
async function switchToLite(s: Session, realtime: number) {
  if (session !== s) return;
  const { tabId, segments, idx, title, settings } = s;
  await read({ tabId, segments, settings, startAt: idx, title }, true);
  if (session) emit(session, { type: 'notice', message: `Natural voice too slow here (${realtime}× real time). Using Lite voices.` });
}

function playClip(s: Session) {
  if (session !== s) return;
  if (s.idx >= s.segments.length) return finish(s);
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
    playClip(s);
  };
  s.audio = audio;
  const started = () => {
    if (session !== s || s.audio !== audio) return;
    s.stats.firstAudioMs ??= Math.round(performance.now() - s.t0);
    emit(s, { type: 'sentence', sid: s.idx, total: s.segments.length, wordTimes: clip.wordTimes, duration: clip.audioSec, rate: audio.playbackRate });
    if (s.paused) sync(s);
  };
  if (s.paused) started();
  else audio.play().then(started, (e) => emit(s, { type: 'error', message: `Playback failed: ${e.message}` }));
  pump(s);
}

function stopAudio(s: Session) {
  if (!s.audio) return;
  s.audio.onended = null;
  s.audio.pause();
  s.audio = null;
}

// ---------- system path ----------

function wordCharStarts(seg: SpeechSegment): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const w of seg.words) {
    const i = seg.text.indexOf(w, cursor);
    starts.push(i < 0 ? cursor : i);
    if (i >= 0) cursor = i + w.length;
  }
  return starts;
}

async function speakSystem(s: Session, fromWord: number) {
  if (session !== s) return;
  if (s.idx >= s.segments.length) return finish(s);
  const seg = s.segments[s.idx];
  const starts = wordCharStarts(seg);
  const offset = fromWord > 0 ? (starts[fromWord] ?? 0) : 0;
  const u = new SpeechSynthesisUtterance(seg.text.slice(offset));
  const voice = await pickSystemVoice(s.settings.systemVoice);
  if (session !== s) return;
  s.voiceName = voice?.name ?? 'browser default';
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  } else {
    u.lang = 'en-US';
  }
  u.rate = s.settings.speed;
  const stale = () => session !== s || s.utter !== u;
  u.onstart = () => {
    if (stale()) return;
    s.stats.firstAudioMs ??= Math.round(performance.now() - s.t0);
    if (fromWord === 0) emit(s, { type: 'sentence', sid: s.idx, total: s.segments.length, wordTimes: [], duration: 0, rate: 1, live: true });
    else sync(s);
    s.wordIdx = fromWord;
    emit(s, { type: 'word', sid: s.idx, wi: fromWord });
  };
  u.onboundary = (e) => {
    if (stale() || e.name !== 'word') return;
    const pos = offset + e.charIndex;
    let wi = s.wordIdx;
    while (wi + 1 < starts.length && starts[wi + 1] <= pos) wi++;
    if (wi !== s.wordIdx) {
      s.wordIdx = wi;
      emit(s, { type: 'word', sid: s.idx, wi });
    }
  };
  u.onend = () => {
    if (stale()) return;
    s.utter = null;
    s.idx++;
    speakSystem(s, 0);
  };
  u.onerror = (e) => {
    if (stale() || e.error === 'interrupted' || e.error === 'canceled') return;
    emit(s, { type: 'error', message: `System voice error: ${e.error}` });
    teardown(s);
  };
  s.utter = u;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function silenceSystem(s: Session) {
  s.utter = null;
  speechSynthesis.cancel();
}

// ---------- controls ----------

function pause() {
  const s = session;
  if (!s || s.paused) return;
  s.paused = true;
  if (s.kind === 'system') silenceSystem(s); // speechSynthesis.pause() is unreliable; resume restarts at the current word
  else s.audio?.pause();
  sync(s);
  updateMediaSession(s);
}

function resume() {
  const s = session;
  if (!s || !s.paused) return;
  s.paused = false;
  if (s.kind === 'system') speakSystem(s, s.wordIdx);
  else if (s.audio) s.audio.play().then(() => sync(s), () => {});
  else sync(s);
  updateMediaSession(s);
}

function jump(target: number) {
  const s = session;
  if (!s) return;
  target = Math.max(0, Math.min(s.segments.length - 1, target));
  s.idx = target;
  if (s.kind === 'system') {
    silenceSystem(s);
    s.wordIdx = 0;
    if (s.paused) emit(s, { type: 'sentence', sid: s.idx, total: s.segments.length, wordTimes: [], duration: 0, rate: 1, live: true });
    else speakSystem(s, 0);
    return;
  }
  stopAudio(s);
  for (const k of [...s.clips.keys()]) if (k < target || k > target + LOOKAHEAD) dropClip(s, k);
  s.genIdx = target;
  playClip(s);
}

function teardown(s: Session) {
  if (session === s) session = null;
  stopAudio(s);
  if (s.kind === 'system') silenceSystem(s);
  for (const k of [...s.clips.keys()]) dropClip(s, k);
  updateMediaSession(null);
}

function stop() {
  const s = session;
  if (!s) return;
  teardown(s);
  emit(s, { type: 'stopped' });
}

async function applySettings(next: Settings) {
  const s = session;
  if (!s) return;
  const prev = s.settings;
  s.settings = next;

  if ((await resolveKind(next)) !== s.kind) {
    // Engine family changed: restart this sentence with the other engine.
    const { tabId, segments, idx, title, paused } = s;
    await read({ tabId, segments, settings: next, startAt: idx, title }, true);
    if (paused) pause();
    return;
  }

  if (s.kind === 'system') {
    if ((prev.speed !== next.speed || prev.systemVoice !== next.systemVoice) && !s.paused) speakSystem(s, s.wordIdx);
    return;
  }

  const needsRegen = prev.voice !== next.voice || prev.engine !== next.engine || splitSpeed(prev.speed).modelSpeed !== splitSpeed(next.speed).modelSpeed;
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

// ---------- media keys / OS media controls ----------

function updateMediaSession(s: Session | null) {
  const ms = navigator.mediaSession;
  if (!ms) return;
  if (!s) {
    ms.metadata = null;
    ms.playbackState = 'none';
    return;
  }
  ms.metadata = new MediaMetadata({ title: s.title || 'Reading aloud', artist: 'Spokify' });
  ms.playbackState = s.paused ? 'paused' : 'playing';
}

if (navigator.mediaSession) {
  const handlers: [MediaSessionAction, () => void][] = [
    ['play', resume],
    ['pause', pause],
    ['stop', stop],
    ['nexttrack', () => session && jump(session.idx + 1)],
    ['previoustrack', () => session && jump(session.idx - 1)],
  ];
  for (const [action, fn] of handlers) {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch {}
  }
}

// ---------- diagnostics / samples ----------

async function speakSample({ text, settings }: { text: string; settings: Settings }): Promise<Record<string, unknown>> {
  stop();
  if ((await resolveKind(settings)) === 'system') {
    const u = new SpeechSynthesisUtterance(text);
    const v = await pickSystemVoice(settings.systemVoice);
    if (v) u.voice = v;
    u.rate = settings.speed;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    return { engine: 'system', voice: v?.name ?? 'default' };
  }
  const { modelSpeed, rate } = splitSpeed(settings.speed);
  const r = await rpc('generate', { text, words: [], voice: settings.voice, speed: modelSpeed, engine: settings.engine });
  if (await tooSlow(settings, r.realtime)) return { ...(await speakSample({ text, settings })), slow: gpuSlow };
  const audio = new Audio(URL.createObjectURL(floatWav(r.samples, r.sampleRate)));
  audio.playbackRate = rate;
  await audio.play();
  return { engine: r.engine, genMs: r.genMs, audioSec: +r.audioSec.toFixed(2), speedVsRealtime: +(r.audioSec / (r.genMs / 1000)).toFixed(2) };
}

const actions: Record<HostCommand['type'], (m: any) => unknown> = {
  ping: () => ({ ok: true, kind: chrome.tabs ? 'tab' : 'offscreen' }),
  machine: (m) => applyMachine(m),
  warmup: async (m) => {
    if ((await resolveKind(m.settings)) === 'kokoro') {
      rpc('load', { engine: m.settings.engine }).then((info) => tooSlow(m.settings, info?.realtime), () => {});
    }
    return { ok: true };
  },
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
  env: async () => ({
    host: {
      crossOriginIsolated: self.crossOriginIsolated,
      webgpu: await hasWebGPU(),
      systemVoices: (await systemVoices()).length,
      // What Lite mode can use here (the hidden audio page can see a different list than the popup).
      voices: (await systemVoices()).map((v) => `${v.name} | ${v.lang}${v.localService ? '' : ' | online'}${v.default ? ' | default' : ''}`),
      gpuSlow,
    },
    worker: await rpc('envReport'),
  }),
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

export type { LoadInfo };
