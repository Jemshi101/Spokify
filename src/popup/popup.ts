import { ENGINES, VOICES, loadSettings, saveSettings, type EngineChoice } from '../shared/settings';
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
    $('msg').textContent = `Reading ${(s.sid ?? 0) + 1} of ${s.total}${s.engine ? ` · ${s.engine}` : ''}${rt}`;
  }
}

async function init() {
  const s = await loadSettings();
  $<HTMLSelectElement>('voice').innerHTML = VOICES.map((v) => `<option value="${v.id}">${v.label}</option>`).join('');
  $<HTMLSelectElement>('engine').innerHTML =
    '<option value="auto">Auto (WebGPU fp16, CPU fallback)</option>' +
    Object.entries(ENGINES).map(([id, e]) => `<option value="${id}">${e.label}</option>`).join('');
  $<HTMLSelectElement>('voice').value = s.voice;
  $<HTMLSelectElement>('engine').value = s.engine;
  $<HTMLInputElement>('speed').value = String(s.speed);
  $('speedVal').textContent = `${s.speed}×`;

  $('voice').onchange = () => saveSettings({ voice: $<HTMLSelectElement>('voice').value });
  $('engine').onchange = () => saveSettings({ engine: $<HTMLSelectElement>('engine').value as EngineChoice });
  $('speed').oninput = () => {
    const v = +$<HTMLInputElement>('speed').value;
    $('speedVal').textContent = `${v}×`;
    saveSettings({ speed: v });
  };

  const read = (mode: 'page' | 'selection') => async () => {
    const r = await sw({ type: 'extract', mode });
    $('msg').textContent = r?.error ? `Can't read this page: ${r.error}` : r?.count ? `Starting ${r.count} sentences…` : 'Nothing to read here';
    if (r?.count) setTimeout(() => window.close(), 600);
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
