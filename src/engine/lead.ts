// Audio output can drop the first ~100 ms of a clip while the device wakes up (common on Windows,
// and with Bluetooth headsets). Supertonic starts speaking 0–50 ms in, so the first sound was lost.

/** Quiet time each clip gets before its first sound. */
export const LEAD_SEC = 0.15;

/** Seconds of near-silence at the start of `samples`. */
export function leadingSilence(samples: Float32Array, sampleRate: number): number {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  const floor = Math.max(peak * 0.05, 1e-4);
  const i = samples.findIndex((v) => Math.abs(v) > floor);
  return (i < 0 ? samples.length : i) / sampleRate;
}

/** Prepends silence so the clip has at least LEAD_SEC before its first sound; word times shift with it. */
export function padLead<T extends { samples: Float32Array; sampleRate: number; audioSec: number; wordTimes: number[] }>(clip: T): T {
  const add = Math.round((LEAD_SEC - leadingSilence(clip.samples, clip.sampleRate)) * clip.sampleRate);
  if (add <= 0) return clip;
  const samples = new Float32Array(add + clip.samples.length);
  samples.set(clip.samples, add);
  const shift = add / clip.sampleRate;
  return { ...clip, samples, audioSec: clip.audioSec + shift, wordTimes: clip.wordTimes.map((t) => t + shift) };
}
