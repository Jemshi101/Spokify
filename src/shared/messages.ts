import type { EngineChoice, EngineId, Settings } from './settings';

/** One unit of speech: a sentence (or a chunk of a long one) plus the words to highlight. */
export interface SpeechSegment {
  text: string;
  words: string[];
}

/** Host → content script (relayed by the service worker). */
export type TabEvent =
  | { type: 'sentence'; sid: number; total: number; wordTimes: number[]; duration: number; rate: number }
  | { type: 'sync'; sid: number; pos: number; rate: number; paused: boolean }
  | { type: 'buffering'; sid: number; total: number }
  | { type: 'loading'; percent: number | null }
  | { type: 'ended' }
  | { type: 'stopped' }
  | { type: 'error'; message: string };

/** Commands the host understands. */
export type HostCommand =
  | { type: 'ping' }
  | { type: 'warmup'; settings: Settings }
  | { type: 'read'; tabId: number; segments: SpeechSegment[]; settings: Settings; startAt?: number }
  | { type: 'settings'; settings: Settings }
  | { type: 'toggle' | 'pause' | 'resume' | 'next' | 'prev' | 'stop' | 'status' | 'env' }
  | { type: 'jump'; sid: number }
  | { type: 'benchmark'; engine: EngineId }
  | { type: 'speakSample'; text: string; settings: Settings };

export type PlayerAction = 'toggle' | 'next' | 'prev' | 'stop';

export interface HostStatus {
  active: boolean;
  paused: boolean;
  tabId: number | null;
  sid: number | null;
  total: number;
  engine: EngineId | null;
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
  requested: EngineChoice;
  loadMs: number;
  cached: boolean;
  fallbackReason?: string;
}

/** Host/UI broadcast (popup, diagnostics page). */
export type UiEvent =
  | { target: 'ui'; type: 'progress'; file: string; loaded: number; total: number }
  | { target: 'ui'; type: 'status'; status: HostStatus };
