export type EngineId = 'webgpu-fp32' | 'wasm-q8';
/** 'system' = the browser's built-in voices (lite mode, for machines without WebGPU). */
export type EngineChoice = 'auto' | 'system' | EngineId;

export interface Settings {
  engine: EngineChoice;
  /** Kokoro voice id. */
  voice: string;
  /** speechSynthesis voiceURI for lite mode ('' = browser default English voice). */
  systemVoice: string;
  speed: number;
}

export const DEFAULT_SETTINGS: Settings = { engine: 'auto', voice: 'af_heart', systemVoice: '', speed: 1 };

export const SPEED_STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 3;

/** Kokoro renders up to this speed itself; anything faster is pitch-preserving playback rate. */
export const MAX_MODEL_SPEED = 1.5;

export const ENGINES: Record<EngineId, { device: 'webgpu' | 'wasm'; dtype: 'fp32' | 'q8'; label: string }> = {
  'webgpu-fp32': { device: 'webgpu', dtype: 'fp32', label: 'WebGPU · fp32 (~330 MB)' },
  'wasm-q8': { device: 'wasm', dtype: 'q8', label: 'CPU · q8 (~90 MB, slow)' },
};

export const VOICES: { id: string; label: string }[] = [
  { id: 'af_heart', label: 'Heart · US female' },
  { id: 'af_bella', label: 'Bella · US female' },
  { id: 'af_nicole', label: 'Nicole · US female (soft)' },
  { id: 'af_sarah', label: 'Sarah · US female' },
  { id: 'af_aoede', label: 'Aoede · US female' },
  { id: 'af_kore', label: 'Kore · US female' },
  { id: 'af_nova', label: 'Nova · US female' },
  { id: 'af_sky', label: 'Sky · US female' },
  { id: 'af_alloy', label: 'Alloy · US female' },
  { id: 'af_jessica', label: 'Jessica · US female' },
  { id: 'af_river', label: 'River · US female' },
  { id: 'am_michael', label: 'Michael · US male' },
  { id: 'am_fenrir', label: 'Fenrir · US male' },
  { id: 'am_puck', label: 'Puck · US male' },
  { id: 'am_adam', label: 'Adam · US male' },
  { id: 'am_echo', label: 'Echo · US male' },
  { id: 'am_eric', label: 'Eric · US male' },
  { id: 'am_liam', label: 'Liam · US male' },
  { id: 'am_onyx', label: 'Onyx · US male' },
  { id: 'bf_emma', label: 'Emma · UK female' },
  { id: 'bf_isabella', label: 'Isabella · UK female' },
  { id: 'bf_alice', label: 'Alice · UK female' },
  { id: 'bf_lily', label: 'Lily · UK female' },
  { id: 'bm_george', label: 'George · UK male' },
  { id: 'bm_fable', label: 'Fable · UK male' },
  { id: 'bm_lewis', label: 'Lewis · UK male' },
  { id: 'bm_daniel', label: 'Daniel · UK male' },
];

export function clampSpeed(speed: number): number {
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed * 100) / 100));
}

/** Splits the user's speed into the part Kokoro renders and the remaining playback rate. */
export function splitSpeed(speed: number): { modelSpeed: number; rate: number } {
  const modelSpeed = Math.min(speed, MAX_MODEL_SPEED);
  return { modelSpeed, rate: speed / modelSpeed };
}

/** Settings live in storage.sync so they follow the user across browsers. */
export async function loadSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.sync.get('settings');
  const s = { ...DEFAULT_SETTINGS, ...(settings as Partial<Settings> | undefined) };
  // 0.2.0 offered a WebGPU fp16 engine; its output is garbled, so old choices fall back to Auto.
  if (s.engine !== 'auto' && s.engine !== 'system' && !(s.engine in ENGINES)) s.engine = 'auto';
  return s;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  next.speed = clampSpeed(next.speed);
  await chrome.storage.sync.set({ settings: next });
  return next;
}

/** Calls back with fresh settings whenever they change anywhere. */
export function onSettingsChanged(cb: (s: Settings) => void) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) cb({ ...DEFAULT_SETTINGS, ...(changes.settings.newValue as Partial<Settings>) });
  });
}
