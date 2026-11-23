// speechSynthesis voice helpers (lite mode). Used by the audio host, the popup and the welcome page.

let cached: SpeechSynthesisVoice[] = [];
if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.addEventListener('voiceschanged', () => (cached = speechSynthesis.getVoices()));
}

/**
 * getVoices() is empty until the browser has loaded them, which can take seconds on Windows
 * (and longer in a hidden offscreen page). Waits for voiceschanged, polling as a fallback.
 */
export async function systemVoices(timeoutMs = 5000): Promise<SpeechSynthesisVoice[]> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const now = speechSynthesis.getVoices();
    if (now.length) return (cached = now);
    if (cached.length) return cached;
    if (Date.now() > end) return [];
    await new Promise<void>((r) => {
      const t = setTimeout(r, 250);
      speechSynthesis.addEventListener('voiceschanged', () => (clearTimeout(t), r()), { once: true });
    });
  }
}

/** Microsoft's online neural voices (Edge only: "Microsoft Aria Online (Natural) - English (United States)"). */
export const isNatural = (v: SpeechSynthesisVoice) => /\bnatural\b/i.test(v.name);

/**
 * The chosen voice (by id, then by name), or the best English default: natural voices first, then
 * local voices (network voices like "Google US English" don't always send word boundary events).
 */
export async function pickSystemVoice(chosen: string): Promise<SpeechSynthesisVoice | null> {
  const voices = await systemVoices();
  const en = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().startsWith('en');
  return (
    (chosen ? (voices.find((v) => v.voiceURI === chosen) ?? voices.find((v) => v.name === chosen)) : undefined) ??
    voices.find((v) => isNatural(v) && v.lang === 'en-US') ??
    voices.find((v) => v.localService && v.default && en(v)) ??
    voices.find((v) => v.localService && v.lang === 'en-US') ??
    voices.find((v) => v.localService && en(v)) ??
    voices.find(en) ??
    null
  );
}

/** For the voice pickers: English first; within it natural, then local, then network voices. */
export async function sortedSystemVoices(): Promise<SpeechSynthesisVoice[]> {
  const rank = (v: SpeechSynthesisVoice) => (v.lang.toLowerCase().startsWith('en') ? 0 : 4) + (isNatural(v) ? 0 : v.localService ? 1 : 2);
  return [...(await systemVoices())].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Short label for a voice picker. */
export const voiceLabel = (v: SpeechSynthesisVoice) =>
  `${v.name.replace(/^Microsoft\s+/, '').replace(/\s+-\s+.*$/, '')} (${v.lang})${isNatural(v) ? ' · natural' : v.localService ? '' : ' · online'}`;
