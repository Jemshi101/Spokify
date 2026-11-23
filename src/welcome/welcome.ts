import { PIPER_VOICES, SUPERTONIC_VOICES, VOICES, loadSettings, saveSettings } from '../shared/settings';
import { sortedSystemVoices, voiceLabel } from '../host/voices';
import type { UiEvent } from '../shared/messages';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const host = (payload: object) => chrome.runtime.sendMessage({ target: 'sw', type: 'host', payload });

function note(id: string, text: string, kind: '' | 'ok' | 'warn' = '') {
  const el = $(id);
  el.textContent = text;
  el.className = `note ${kind}`;
}

async function hasWebGPU() {
  try {
    return !!(await (navigator as any).gpu?.requestAdapter());
  } catch {
    return false;
  }
}

type Family = 'kokoro' | 'supertonic' | 'piper' | 'system';

async function fillVoices(family: Family) {
  const s = await loadSettings();
  const select = $<HTMLSelectElement>('voice');
  if (family === 'system') {
    const voices = await sortedSystemVoices();
    select.innerHTML = '<option value="">Best available English voice</option>' + voices.map((v) => `<option value="${v.voiceURI}">${voiceLabel(v)}</option>`).join('');
    if (s.systemVoice) select.value = s.systemVoice;
    select.onchange = () => saveSettings({ systemVoice: select.value });
  } else if (family === 'supertonic') {
    select.innerHTML = SUPERTONIC_VOICES.map((v) => `<option value="${v.id}">${v.label}</option>`).join('');
    select.value = s.supertonicVoice;
    select.onchange = () => saveSettings({ supertonicVoice: select.value });
  } else if (family === 'piper') {
    select.innerHTML = PIPER_VOICES.map((v) => `<option value="${v.id}">${v.label}</option>`).join('');
    select.value = s.piperVoice;
    select.onchange = () => saveSettings({ piperVoice: select.value });
  } else {
    select.innerHTML = VOICES.map((v) => `<option value="${v.id}">${v.label}</option>`).join('');
    select.value = s.voice;
    select.onchange = () => saveSettings({ voice: select.value });
  }
}

async function init() {
  const gpu = await hasWebGPU();
  const s = await loadSettings();
  const family: Family =
    s.engine === 'system'
      ? 'system'
      : s.engine === 'piper'
        ? 'piper'
        : s.engine === 'supertonic' || (s.engine === 'auto' && !gpu)
          ? 'supertonic'
          : 'kokoro';
  const SIZE: Record<Family, string> = { kokoro: '~330 MB', supertonic: '~263 MB', piper: '~63 MB', system: '' };

  if (family === 'system') {
    $('engineText').textContent = "Spokify is set to your system's built-in voices (lite mode). Pick Auto in the toolbar popup for natural voices.";
  } else {
    $('engineText').textContent =
      family === 'kokoro'
        ? 'The Kokoro voice model downloads once (~330 MB) and is cached; then everything works offline. If your graphics turn out too slow for it, Spokify uses Supertonic, which runs on the processor, or the lighter Piper voices.'
        : family === 'supertonic'
          ? "This browser has no WebGPU, so Spokify uses Supertonic: natural voices that run on the processor. It downloads once (~263 MB) and is cached; then everything works offline. If your processor is too slow for it, Spokify uses the lighter Piper voices."
          : 'Piper voices run on the processor. Each voice downloads once (~63 MB) and is cached; then everything works offline.';
    $('get').textContent = `Download voice (${SIZE[family]})`;
    $('download').hidden = false;
  }
  await fillVoices(family);

  $('get').onclick = async () => {
    $<HTMLButtonElement>('get').disabled = true;
    note('engineNote', 'Downloading…');
    await host({ type: 'warmup' });
    const slowNoted = new Set<string>();
    const NAME: Record<string, string> = { 'webgpu-fp32': 'Kokoro', supertonic: 'Supertonic', piper: 'Piper' };
    const poll = setInterval(async () => {
      const env = await host({ type: 'env' });
      const loaded = env?.worker?.loaded;
      if (!loaded) return;
      const steppable = loaded.engine === 'webgpu-fp32' || loaded.engine === 'supertonic';
      if (steppable && s.engine === 'auto' && loaded.realtime != null && loaded.realtime < 1.3) {
        // Too slow here: the host now loads the next lighter engine; keep polling until it's ready.
        if (!slowNoted.has(loaded.engine)) {
          slowNoted.add(loaded.engine);
          $('progress').style.width = '0%';
          const next = loaded.engine === 'webgpu-fp32' ? 'supertonic' : 'piper';
          const where = loaded.engine === 'webgpu-fp32' ? 'graphics' : 'processor';
          note('engineNote', `Your ${where} ran ${NAME[loaded.engine]} at ${loaded.realtime}× real time, too slow to keep up. Getting ${NAME[next]} (${SIZE[next as Family]}) instead…`, 'warn');
          await fillVoices(next as Family);
        }
        return;
      }
      clearInterval(poll);
      $('progress').style.width = '100%';
      $('get').textContent = 'Voice ready';
      const name = NAME[loaded.engine] ?? loaded.engine;
      if (loaded.engine === 'piper' || loaded.engine === 'supertonic') await fillVoices(loaded.engine);
      note(
        'engineNote',
        loaded.fallbackReason
          ? `Ready · ${name} (WebGPU failed: ${loaded.fallbackReason})`
          : `Ready · ${name}${loaded.realtime ? ` · ${loaded.realtime}× real time` : ''}`,
        'ok',
      );
    }, 700);
  };

  $('play').onclick = async () => {
    note('playNote', 'Generating…');
    const r = await host({
      type: 'speakSample',
      text: 'Hi! I can read any web page or PDF to you, and highlight each word as I go.',
    });
    note('playNote', r?.error ? `Error: ${r.error}` : r?.engine === 'system' ? `Playing with ${r.voice}` : `Playing · ${({ piper: 'Piper', supertonic: 'Supertonic' } as Record<string, string>)[r.engine] ?? 'Kokoro'} · generated ${r.speedVsRealtime}× faster than real time`, r?.error ? 'warn' : '');
  };
}

chrome.runtime.onMessage.addListener((msg: UiEvent) => {
  if (msg.target === 'ui' && msg.type === 'progress' && msg.total > 5e6) {
    $('progress').style.width = `${Math.round((msg.loaded / msg.total) * 100)}%`;
    note('engineNote', `Downloading… ${Math.round(msg.loaded / 1e6)} of ${Math.round(msg.total / 1e6)} MB`);
  }
});

init();
