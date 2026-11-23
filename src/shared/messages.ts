import type { EngineChoice, EngineId, Settings } from './settings';

/** One unit of speech: a sentence (or a chunk of a long one) plus the words to highlight. */
export interface SpeechSegment {
  text: string;
  words: string[];
}

/** Host → content script (relayed by the service worker). */
export type TabEvent =
  /** live = word positions arrive as 'word' events (system voices) instead of a timing table. */
  | { type: 'sentence'; sid: number; total: number; wordTimes: number[]; duration: number; rate: number; live?: boolean }
  | { type: 'word'; sid: number; wi: number }
  | { type: 'sync'; sid: number; pos: number; rate: number; paused: boolean }
  | { type: 'buffering'; sid: number; total: number }
  | { type: 'loading'; percent: number | null }
  | { type: 'ended' }
  | { type: 'stopped' }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string };

/** Commands the host understands. */
export type HostCommand =
  | { type: 'ping' }
  | { type: 'machine'; gpuSlow?: { realtime: number; at: number } | null; testSlowRealtime?: number; testMute?: boolean }
  | { type: 'warmup'; settings: Settings }
  | { type: 'read'; tabId: number; segments: SpeechSegment[]; settings: Settings; startAt?: number; title?: string }
  | { type: 'settings'; settings: Settings }
  | { type: 'toggle' | 'pause' | 'resume' | 'next' | 'prev' | 'stop' | 'status' | 'env' }
  | { type: 'jump'; sid: number }
  | { type: 'benchmark'; engine: EngineId }
  | { type: 'speakSample'; text: string; settings: Settings };

export type PlayerAction = 'toggle' | 'next' | 'prev' | 'stop';

/** Where the host delivers TabEvents for viewer pages (extension pages can't receive tabs.sendMessage). */
export interface TabRelay {
  target: 'tab';
  tabId: number;
  payload: TabEvent | { type: 'extract'; mode: 'page' | 'selection' };
}

export interface HostStatus {
  active: boolean;
  paused: boolean;
  tabId: number | null;
  sid: number | null;
  total: number;
  engine: EngineId | 'system' | null;
  /** The voice actually speaking (Lite: the system voice's name). */
  voice: string | null;
  stats: ReadingStats | null;
}

export interface ReadingStats {
  generated: number;
  genMs: number;
  audioSec: number;
  exactWords: number;
  firstAudioMs: number | null;
}

export interface LoadInfo {
  engine: EngineId;
  /** Piper: the loaded voice id. */
  voice?: string;
  requested: EngineChoice;
  loadMs: number;
  cached: boolean;
  fallbackReason?: string;
  /** Audio seconds generated per second on a reference sentence (WebGPU only). */
  realtime?: number;
}

/** Host/UI broadcast (popup, diagnostics page). */
export type UiEvent =
  | { target: 'ui'; type: 'progress'; file: string; loaded: number; total: number }
  | { target: 'ui'; type: 'status'; status: HostStatus };
