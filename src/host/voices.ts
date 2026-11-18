// speechSynthesis voice helpers (lite mode). Used by the audio host and the popup.

/** getVoices() is empty until the browser has loaded them; wait briefly for voiceschanged. */
export function systemVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, timeoutMs);
  });
}

/**
 * The chosen voice, or the best English default. Local voices are preferred because
 * network voices (e.g. "Google US English") don't send word boundary events.
 */
export async function pickSystemVoice(uri: string): Promise<SpeechSynthesisVoice | null> {
  const voices = await systemVoices();
  return (
    voices.find((v) => v.voiceURI === uri) ??
    voices.find((v) => v.localService && v.default && v.lang.startsWith('en')) ??
    voices.find((v) => v.localService && v.lang === 'en-US') ??
    voices.find((v) => v.localService && v.lang.startsWith('en')) ??
    voices.find((v) => v.lang.startsWith('en')) ??
    null
  );
}

/** English local voices first, for the voice picker. */
export async function sortedSystemVoices(): Promise<SpeechSynthesisVoice[]> {
  const rank = (v: SpeechSynthesisVoice) => (v.lang.startsWith('en') ? 0 : 2) + (v.localService ? 0 : 1);
  return [...(await systemVoices())].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
