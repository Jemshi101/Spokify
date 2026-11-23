import { VOICES, loadSettings, saveSettings } from '../shared/settings';
import { sortedSystemVoices } from '../host/voices';
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

async function fillVoices(lite: boolean) {
  const s = await loadSettings();
  const select = $<HTMLSelectElement>('voice');
  if (lite) {
    const voices = await sortedSystemVoices();
    select.innerHTML = voices.map((v) => `<option value="${v.voiceURI}">${v.name} (${v.lang})</option>`).join('');
    if (s.systemVoice) select.value = s.systemVoice;
    select.onchange = () => saveSettings({ systemVoice: select.value });
  } else {
    select.innerHTML = VOICES.map((v) => `<option value="${v.id}">${v.label}</option>`).join('');
    select.value = s.voice;
    select.onchange = () => saveSettings({ voice: select.value });
  }
}

async function init() {
  const gpu = await hasWebGPU();
  const s = await loadSettings();
  const lite = !gpu || s.engine === 'system';

  if (!gpu) {
    $('engineText').textContent =
      "This browser doesn't expose WebGPU, which the natural voices need to run smoothly. Spokify will use your system's built-in voices instead (lite mode). Highlighting and everything else work the same.";
    note('engineNote', 'Lite mode is on. If you enable WebGPU later, switch the engine back to Auto in the toolbar popup.', 'warn');
    if (s.engine === 'auto') await saveSettings({ engine: 'system' });
  } else {
    $('engineText').textContent = 'The voice model downloads once and is cached. After that everything works offline.';
    $('download').hidden = false;
  }
  await fillVoices(lite);

  $('get').onclick = async () => {
    $<HTMLButtonElement>('get').disabled = true;
    note('engineNote', 'Downloading…');
    await host({ type: 'warmup' });
    const poll = setInterval(async () => {
      const env = await host({ type: 'env' });
      const loaded = env?.worker?.loaded;
      if (loaded) {
        clearInterval(poll);
        $('progress').style.width = '100%';
        $('get').textContent = 'Voice ready';
        if (s.engine === 'auto' && loaded.realtime != null && loaded.realtime < 1.3) {
          // The host switches Auto to Lite voices for this computer (see SLOW_REALTIME in host.ts).
          note('engineNote', `Your graphics ran the natural voice at ${loaded.realtime}× real time, too slow to keep up, so Spokify will use your system's voices (lite mode). You can still pick a Natural engine in the toolbar popup.`, 'warn');
          await fillVoices(true);
        } else {
          note('engineNote', loaded.fallbackReason ? `Ready (CPU fallback: ${loaded.fallbackReason})` : `Ready · ${loaded.engine}${loaded.realtime ? ` · ${loaded.realtime}× real time` : ''}`, 'ok');
        }
      }
    }, 700);
  };

  $('play').onclick = async () => {
    note('playNote', 'Generating…');
    const r = await host({
      type: 'speakSample',
      text: 'Hi! I can read any web page or PDF to you, and highlight each word as I go.',
    });
    note('playNote', r?.error ? `Error: ${r.error}` : r?.engine === 'system' ? `Playing with ${r.voice}` : `Playing · generated ${r.speedVsRealtime}× faster than real time`, r?.error ? 'warn' : '');
  };
}

chrome.runtime.onMessage.addListener((msg: UiEvent) => {
  if (msg.target === 'ui' && msg.type === 'progress' && msg.total > 5e6) {
    $('progress').style.width = `${Math.round((msg.loaded / msg.total) * 100)}%`;
    note('engineNote', `Downloading… ${Math.round(msg.loaded / 1e6)} of ${Math.round(msg.total / 1e6)} MB`);
  }
});

init();
