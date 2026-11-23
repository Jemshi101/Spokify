// Audio comparison for tests: are two renderings of the same sentence the same voice?
// Compares log-magnitude spectra frame by frame (Pearson correlation, averaged).
// Two healthy engines score ~0.85; the garbled WebGPU fp16 output scored 0.16.

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(ang * k), s = Math.sin(ang * k);
        const a = i + k, b = a + len / 2;
        const vr = re[b] * c - im[b] * s, vi = re[b] * s + im[b] * c;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] += vr; im[a] += vi;
      }
    }
  }
}

function logSpectra(x, length, size = 1024, hop = 256) {
  const frames = [];
  for (let i = 0; i + size < length; i += hop) {
    const re = new Float64Array(size), im = new Float64Array(size);
    for (let k = 0; k < size; k++) re[k] = x[i + k] * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / size));
    fft(re, im);
    frames.push(Array.from({ length: size / 2 }, (_, k) => Math.log(Math.hypot(re[k], im[k]) + 1e-6)));
  }
  return frames;
}

function pearson(x, y) {
  const mx = x.reduce((s, v) => s + v, 0) / x.length, my = y.reduce((s, v) => s + v, 0) / y.length;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

export function spectralSimilarity(a, b) {
  const length = Math.min(a.length, b.length);
  const sa = logSpectra(a, length), sb = logSpectra(b, length);
  return sa.reduce((s, f, i) => s + pearson(f, sb[i]), 0) / sa.length;
}
