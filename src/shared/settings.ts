export type EngineId = 'webgpu-fp32' | 'wasm-q8' | 'piper' | 'supertonic';
/**
 * 'auto' = Kokoro on a fast GPU, else Supertonic on a fast CPU, else Piper.
 * 'system' = the browser's built-in voices (lite mode).
 */
export type EngineChoice = 'auto' | 'system' | EngineId;

export interface Settings {
  engine: EngineChoice;
  /** Kokoro voice id. */
  voice: string;
  /** Piper voice id (rhasspy/piper-voices name). */
  piperVoice: string;
  /** Supertonic voice style (F1–F5, M1–M5). */
  supertonicVoice: string;
  /** Show a "Read" button next to selected text. */
  selectionButton: boolean;
  /** speechSynthesis voiceURI for lite mode ('' = browser default English voice). */
  systemVoice: string;
  speed: number;
}

export const DEFAULT_PIPER_VOICE = 'en_US-lessac-medium';
export const DEFAULT_SUPERTONIC_VOICE = 'F1';
export const DEFAULT_SETTINGS: Settings = {
  engine: 'auto',
  voice: 'af_heart',
  piperVoice: DEFAULT_PIPER_VOICE,
  supertonicVoice: DEFAULT_SUPERTONIC_VOICE,
  selectionButton: true,
  systemVoice: '',
  speed: 1,
};

export const SPEED_STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 3;

/** Kokoro renders up to this speed itself; anything faster is pitch-preserving playback rate. */
export const MAX_MODEL_SPEED = 1.5;

export const ENGINES: Record<EngineId, { family: 'kokoro' | 'piper' | 'supertonic'; device: 'webgpu' | 'wasm'; dtype: 'fp32' | 'q8'; label: string }> = {
  'webgpu-fp32': { family: 'kokoro', device: 'webgpu', dtype: 'fp32', label: 'Kokoro · WebGPU (best, ~330 MB)' },
  supertonic: { family: 'supertonic', device: 'wasm', dtype: 'fp32', label: 'Supertonic · CPU (natural, ~263 MB)' },
  piper: { family: 'piper', device: 'wasm', dtype: 'fp32', label: 'Piper · CPU (light, ~63 MB per voice)' },
  'wasm-q8': { family: 'kokoro', device: 'wasm', dtype: 'q8', label: 'Kokoro · CPU (~90 MB, slow)' },
};

/** Piper voices offered (single-speaker, medium quality, ~63 MB each) from rhasspy/piper-voices. */
export const PIPER_VOICES: { id: string; label: string }[] = [
  { id: 'en_US-lessac-medium', label: 'Lessac · US female' },
  { id: 'en_US-amy-medium', label: 'Amy · US female' },
  { id: 'en_US-hfc_female-medium', label: 'HFC · US female' },
  { id: 'en_US-kristin-medium', label: 'Kristin · US female' },
  { id: 'en_US-ljspeech-medium', label: 'LJ · US female' },
  { id: 'en_US-ryan-medium', label: 'Ryan · US male' },
  { id: 'en_US-hfc_male-medium', label: 'HFC · US male' },
  { id: 'en_US-joe-medium', label: 'Joe · US male' },
  { id: 'en_US-bryce-medium', label: 'Bryce · US male' },
  { id: 'en_GB-alba-medium', label: 'Alba · Scottish female' },
  { id: 'en_GB-cori-medium', label: 'Cori · UK female' },
  { id: 'en_GB-jenny_dioco-medium', label: 'Jenny · UK female' },
  { id: 'en_GB-alan-medium', label: 'Alan · UK male' },
  { id: 'en_GB-northern_english_male-medium', label: 'Northern English · UK male' },
];

/** Supertonic 2 voice styles (one model for all of them; each style is a ~0.3 MB file). */
export const SUPERTONIC_VOICES: { id: string; label: string }[] = [
  ...[1, 2, 3, 4, 5].map((n) => ({ id: `F${n}`, label: `Female ${n}` })),
  ...[1, 2, 3, 4, 5].map((n) => ({ id: `M${n}`, label: `Male ${n}` })),
];

/** Where a Piper voice's model and config download from. */
export function piperUrls(id: string): { model: string; config: string } {
  const [locale, name, quality] = id.split('-');
  const base = `https://huggingface.co/rhasspy/piper-voices/resolve/main/${locale.split('_')[0]}/${locale}/${name}/${quality}/${id}`;
  return { model: `${base}.onnx`, config: `${base}.onnx.json` };
}

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
  if (!PIPER_VOICES.some((v) => v.id === s.piperVoice)) s.piperVoice = DEFAULT_PIPER_VOICE;
  if (!SUPERTONIC_VOICES.some((v) => v.id === s.supertonicVoice)) s.supertonicVoice = DEFAULT_SUPERTONIC_VOICE;
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
