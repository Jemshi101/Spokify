import { PIPER_VOICES, VOICES, loadSettings, saveSettings } from '../shared/settings';
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

type Family = 'kokoro' | 'piper' | 'system';

async function fillVoices(family: Family) {
  const s = await loadSettings();
  const select = $<HTMLSelectElement>('voice');
  if (family === 'system') {
    const voices = await sortedSystemVoices();
    select.innerHTML = '<option value="">Best available English voice</option>' + voices.map((v) => `<option value="${v.voiceURI}">${voiceLabel(v)}</option>`).join('');
    if (s.systemVoice) select.value = s.systemVoice;
    select.onchange = () => saveSettings({ systemVoice: select.value });
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
  const family: Family = s.engine === 'system' ? 'system' : s.engine === 'piper' || (s.engine === 'auto' && !gpu) ? 'piper' : 'kokoro';

  if (family === 'system') {
    $('engineText').textContent = "Spokify is set to your system's built-in voices (lite mode). Pick Auto in the toolbar popup for natural voices.";
  } else {
    $('engineText').textContent =
      family === 'piper'
        ? "This browser has no WebGPU, so Spokify uses Piper: natural voices that run on the processor. Each voice downloads once (~63 MB) and is cached; then everything works offline."
        : 'The Kokoro voice model downloads once (~330 MB) and is cached; then everything works offline. If your graphics turn out too slow for it, Spokify switches to the lighter Piper voices (~63 MB).';
    $('get').textContent = family === 'piper' ? 'Download voice (~63 MB)' : 'Download voice (~330 MB)';
    $('download').hidden = false;
  }
  await fillVoices(family);

  $('get').onclick = async () => {
    $<HTMLButtonElement>('get').disabled = true;
    note('engineNote', 'Downloading…');
    await host({ type: 'warmup' });
    let slowNoted = false;
    const poll = setInterval(async () => {
      const env = await host({ type: 'env' });
      const loaded = env?.worker?.loaded;
      if (!loaded) return;
      if (loaded.engine === 'webgpu-fp32' && s.engine === 'auto' && loaded.realtime != null && loaded.realtime < 1.3) {
        // Too slow for Kokoro: the host now loads Piper; keep polling until it's ready.
        if (!slowNoted) {
          slowNoted = true;
          $('progress').style.width = '0%';
          note('engineNote', `Your graphics ran Kokoro at ${loaded.realtime}× real time, too slow to keep up. Getting the lighter Piper voice instead…`, 'warn');
          await fillVoices('piper');
        }
        return;
      }
      clearInterval(poll);
      $('progress').style.width = '100%';
      $('get').textContent = 'Voice ready';
      const name = loaded.engine === 'piper' ? 'Piper' : 'Kokoro';
      if (loaded.engine === 'piper') await fillVoices('piper');
      note(
        'engineNote',
        loaded.fallbackReason
          ? `Ready · ${name} (WebGPU failed: ${loaded.fallbackReason})`
          : `Ready · ${name}${loaded.realtime ? ` · ${loaded.realtime}× real time` : ''}${slowNoted ? ' (your graphics were too slow for Kokoro)' : ''}`,
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
    note('playNote', r?.error ? `Error: ${r.error}` : r?.engine === 'system' ? `Playing with ${r.voice}` : `Playing · ${r.engine === 'piper' ? 'Piper' : 'Kokoro'} · generated ${r.speedVsRealtime}× faster than real time`, r?.error ? 'warn' : '');
  };
}

chrome.runtime.onMessage.addListener((msg: UiEvent) => {
  if (msg.target === 'ui' && msg.type === 'progress' && msg.total > 5e6) {
    $('progress').style.width = `${Math.round((msg.loaded / msg.total) * 100)}%`;
    note('engineNote', `Downloading… ${Math.round(msg.loaded / 1e6)} of ${Math.round(msg.total / 1e6)} MB`);
  }
});

init();
