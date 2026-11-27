import { PIPER_VOICES, SUPERTONIC_VOICES } from '../shared/settings';
import type { HostStatus, UiEvent } from '../shared/messages';
import { $, bindVoiceControls } from './voiceControls';

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
  await bindVoiceControls();

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
  $('summarize').onclick = async () => {
    $('msg').textContent = 'Summarizing…';
    const r = await sw({ type: 'summarize', mode: 'auto' });
    // The summary (or why there isn't one) shows on the page itself.
    if (r?.error) $('msg').textContent = `Can't summarize this page: ${r.error}`;
    else window.close();
  };
  for (const a of ['prev', 'toggle', 'next', 'stop']) $(a).onclick = () => host(a);
  $('settings').onclick = () => chrome.runtime.openOptionsPage();
  $('diag').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('diag.html') });

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
