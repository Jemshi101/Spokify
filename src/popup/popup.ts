import { ENGINES, PIPER_VOICES, SUPERTONIC_VOICES, VOICES, loadSettings, saveSettings, type EngineChoice } from '../shared/settings';
import { sortedSystemVoices, voiceLabel } from '../host/voices';
import type { HostStatus, UiEvent } from '../shared/messages';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const sw = (msg: object) => chrome.runtime.sendMessage({ target: 'sw', ...msg });
const host = (type: string) => sw({ type: 'host', payload: { type } });

function renderStatus(s: HostStatus | undefined) {
  const active = !!s?.active;
  $('controls').hidden = !active;
  $('toggle').textContent = s?.paused ? 'Resume' : 'Pause';
  if (active && s) {
    const rt = s.stats?.genMs ? ` · ${(s.stats.audioSec / (s.stats.genMs / 1000)).toFixed(1)}× realtime` : '';
    const piperLabel = PIPER_VOICES.find((v) => v.id === s.voice)?.label;
    const stLabel = SUPERTONIC_VOICES.find((v) => v.id === s.voice)?.label;
    const engine =
      s.engine === 'system'
        ? `Lite · ${s.voice ?? 'system voice'}`
        : s.engine === 'piper'
          ? `Piper · ${piperLabel ?? s.voice}`
          : s.engine === 'supertonic'
            ? `Supertonic · ${stLabel ?? s.voice}`
            : s.engine;
    $('msg').textContent = `Reading ${(s.sid ?? 0) + 1} of ${s.total}${engine ? ` · ${engine}` : ''}${rt}`;
  }
}

async function init() {
  const s = await loadSettings();
  $<HTMLSelectElement>('voice').innerHTML = VOICES.map((v) => `<option value="${v.id}">Kokoro · ${v.label}</option>`).join('');
  $<HTMLSelectElement>('piperVoice').innerHTML = PIPER_VOICES.map((v) => `<option value="${v.id}">Piper · ${v.label}</option>`).join('');
  $<HTMLSelectElement>('piperVoice').value = s.piperVoice;
  $<HTMLSelectElement>('stVoice').innerHTML = SUPERTONIC_VOICES.map((v) => `<option value="${v.id}">Supertonic · ${v.label}</option>`).join('');
  $<HTMLSelectElement>('stVoice').value = s.supertonicVoice;
  $<HTMLSelectElement>('engine').innerHTML =
    '<option value="auto">Auto (Kokoro on a fast GPU, else Supertonic or Piper)</option>' +
    Object.entries(ENGINES).map(([id, e]) => `<option value="${id}">${e.label}</option>`).join('') +
    '<option value="system">Lite · system voices</option>';
  const sys = await sortedSystemVoices();
  $<HTMLSelectElement>('systemVoice').innerHTML =
    '<option value="">Best available English voice</option>' + sys.map((v) => `<option value="${v.voiceURI}">${voiceLabel(v)}</option>`).join('');
  $<HTMLSelectElement>('systemVoice').value = s.systemVoice;
  const gpu = await (navigator as any).gpu?.requestAdapter().catch(() => null);
  let { gpuSlow, stSlow } = (await chrome.storage.local.get(['gpuSlow', 'stSlow'])) as {
    gpuSlow?: { realtime: number } | null;
    stSlow?: { realtime: number } | null;
  };
  const showVoices = () => {
    const e = $<HTMLSelectElement>('engine').value;
    // Which voices apply: Auto means Kokoro on a fast GPU, else Supertonic on a fast CPU, else Piper.
    const autoFamily = gpu && !gpuSlow ? 'kokoro' : !stSlow ? 'supertonic' : 'piper';
    const family =
      e === 'system' ? 'system' : e === 'auto' ? autoFamily : e === 'piper' ? 'piper' : e === 'supertonic' ? 'supertonic' : 'kokoro';
    $('voice').hidden = family !== 'kokoro';
    $('stVoice').hidden = family !== 'supertonic';
    $('piperVoice').hidden = family !== 'piper';
    $('systemVoice').hidden = family !== 'system';
    const why = [
      gpuSlow ? `Kokoro ran at ${gpuSlow.realtime}× real time on this computer's graphics` : !gpu ? 'this browser has no WebGPU for Kokoro' : '',
      stSlow ? `Supertonic ran at ${stSlow.realtime}× real time on this processor` : '',
    ].filter(Boolean);
    const note = $('engineNote');
    note.hidden = !(e === 'auto' && why.length);
    note.textContent = why.length
      ? `Using ${autoFamily === 'supertonic' ? 'Supertonic' : 'Piper'} voices: ${why.join('; ')}, too slow to keep up. Pick an engine above to use it anyway.`
      : '';
  };
  showVoices();
  $<HTMLSelectElement>('voice').value = s.voice;
  $<HTMLSelectElement>('engine').value = s.engine;
  $<HTMLInputElement>('speed').value = String(s.speed);
  $('speedVal').textContent = `${s.speed}×`;

  $<HTMLInputElement>('selBtn').checked = s.selectionButton;
  $('selBtn').onchange = () => saveSettings({ selectionButton: $<HTMLInputElement>('selBtn').checked });
  $('voice').onchange = () => saveSettings({ voice: $<HTMLSelectElement>('voice').value });
  $('piperVoice').onchange = () => saveSettings({ piperVoice: $<HTMLSelectElement>('piperVoice').value });
  $('stVoice').onchange = () => saveSettings({ supertonicVoice: $<HTMLSelectElement>('stVoice').value });
  $('engine').onchange = async () => {
    const engine = $<HTMLSelectElement>('engine').value as EngineChoice;
    // Choosing Auto again re-tests the GPU on the next read.
    if (engine === 'auto' && (gpuSlow || stSlow)) {
      gpuSlow = stSlow = null;
      await chrome.storage.local.remove(['gpuSlow', 'stSlow']);
    }
    showVoices();
    saveSettings({ engine });
  };
  $('systemVoice').onchange = () => saveSettings({ systemVoice: $<HTMLSelectElement>('systemVoice').value });
  $('speed').oninput = () => {
    const v = +$<HTMLInputElement>('speed').value;
    $('speedVal').textContent = `${v}×`;
    saveSettings({ speed: v });
  };

  const read = (mode: 'page' | 'selection') => async () => {
    const r = await sw({ type: 'extract', mode });
    $('msg').textContent = r?.error
      ? `Can't read this page: ${r.error}`
      : r?.pdf
        ? 'Opening the PDF reader…'
        : r?.docs
          ? 'Opening the Google Docs reader…'
        : r?.count
          ? r.startAt ? `Resuming at sentence ${r.startAt + 1} of ${r.count}…` : `Starting ${r.count} sentences…`
          : 'Nothing to read here';
    if (r?.count || r?.pdf || r?.docs) setTimeout(() => window.close(), 700);
  };
  $('readPage').onclick = read('page');
  $('readSel').onclick = read('selection');
  for (const a of ['prev', 'toggle', 'next', 'stop']) $(a).onclick = () => host(a);
  $('diag').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('diag.html') });
  $('shortcuts').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });

  renderStatus(await host('status'));
  sw({ type: 'host', payload: { type: 'warmup' } }); // start loading the model while the user decides
}

chrome.runtime.onMessage.addListener((msg: UiEvent) => {
  if (msg.target !== 'ui') return;
  if (msg.type === 'progress' && msg.total > 5e6) {
    $('msg').textContent = `Downloading voice model: ${Math.round((msg.loaded / msg.total) * 100)}%`;
  }
  if (msg.type === 'status') renderStatus(msg.status);
});

init();
