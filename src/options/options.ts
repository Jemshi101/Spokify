// The full settings page: voice and engine, reading options, AI summaries, shortcuts, storage, about.
import { loadSettings, saveSettings, type SummaryLength, type SummaryType } from '../shared/settings';
import { browserAi, downloadModel, stateMessage, summaryState } from '../shared/summarize';
import { $, bindVoiceControls } from '../popup/voiceControls';

const sw = (msg: object) => chrome.runtime.sendMessage({ target: 'sw', ...msg });

const SAMPLE = 'Hello! This is how Spokify sounds with this voice, at this speed.';

async function voices() {
  await bindVoiceControls({ voicePrefix: false });
  $('sample').onclick = async () => {
    const btn = $<HTMLButtonElement>('sample');
    btn.disabled = true;
    $('sampleMsg').textContent = 'Preparing the voice…';
    const r = await sw({ type: 'host', payload: { type: 'speakSample', text: SAMPLE } }).catch((e) => ({ error: String(e) }));
    btn.disabled = false;
    $('sampleMsg').textContent = r?.error ? `Couldn't play the sample: ${r.error}` : '';
  };
}

async function summaries() {
  const s = await loadSettings();
  const type = $<HTMLSelectElement>('summaryType');
  const length = $<HTMLSelectElement>('summaryLength');
  type.value = s.summaryType;
  length.value = s.summaryLength;
  type.onchange = () => saveSettings({ summaryType: type.value as SummaryType });
  length.onchange = () => saveSettings({ summaryLength: length.value as SummaryLength });

  const status = $('aiStatus');
  const btn = $<HTMLButtonElement>('aiDownload');
  const bar = $('aiTrack');
  const render = async () => {
    const state = await summaryState(navigator.language);
    status.textContent = state === 'available' ? `Ready. Summaries are made on this computer by ${browserAi()}; pages are never sent anywhere.` : stateMessage(state);
    status.dataset.state = state;
    btn.hidden = state !== 'downloadable' && state !== 'downloading';
    btn.textContent = state === 'downloading' ? 'Show download progress' : 'Download the AI model';
  };
  btn.onclick = () => {
    btn.disabled = true;
    bar.hidden = false;
    // Called straight from the click: browsers only start the download from a user gesture.
    downloadModel((f) => {
      status.textContent = `Downloading ${browserAi()}… ${Math.round(f * 100)}%`;
      ($('aiBar') as HTMLElement).style.width = `${Math.round(f * 100)}%`;
    }, navigator.language)
      .then(render, (e) => (status.textContent = `The download didn't start: ${(e as Error).message}`))
      .finally(() => {
        btn.disabled = false;
        bar.hidden = true;
      });
  };
  await render();
}

async function shortcuts() {
  const ORDER = ['_execute_action', 'read-page', 'toggle-pause', 'next-sentence', 'prev-sentence', 'summarize-page'];
  const rank = (n?: string) => (ORDER.indexOf(n ?? '') + ORDER.length + 1) % (ORDER.length + 1);
  const cmds = (await chrome.commands.getAll()).sort((a, b) => rank(a.name) - rank(b.name));
  const names: Record<string, string> = { _execute_action: 'Open the Spokify popup' };
  $('shortcutList').innerHTML = '';
  for (const c of cmds) {
    const row = document.createElement('tr');
    row.appendChild(document.createElement('td')).textContent = names[c.name ?? ''] ?? c.description ?? c.name ?? '';
    const key = row.appendChild(document.createElement('td'));
    if (c.shortcut) key.appendChild(document.createElement('kbd')).textContent = c.shortcut;
    else key.textContent = 'Not set';
    $('shortcutList').appendChild(row);
  }
  $('changeShortcuts').onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}

async function storage() {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const mb = est?.usage ? Math.round(est.usage / 1e6) : 0;
  $('storageMsg').textContent = mb
    ? `Voices downloaded on this computer take about ${mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`}. They stay until you remove Spokify.`
    : 'No voices downloaded yet. The first time you read, Spokify downloads the voice it needs.';
}

function about() {
  $('version').textContent = chrome.runtime.getManifest().version;
  $('diag').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('diag.html') });
  $('welcome').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
}

async function init() {
  about();
  await Promise.all([voices(), summaries(), shortcuts(), storage()]);
  const target = location.hash && document.getElementById(location.hash.slice(1));
  if (target) {
    target.scrollIntoView({ block: 'start' });
    target.classList.add('flash');
  }
}

init();
