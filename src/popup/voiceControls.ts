// Voice, engine, speed and reading-option controls, shared by the popup and the settings page.
// Both pages use the same element ids: engine, engineNote, voice, stVoice, piperVoice, systemVoice,
// speed, speedVal, selBtn, hoverBtn.
import { ENGINES, PIPER_VOICES, SUPERTONIC_VOICES, VOICES, loadSettings, saveSettings, type EngineChoice } from '../shared/settings';
import { sortedSystemVoices, voiceLabel } from '../host/voices';

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export async function bindVoiceControls(opts: { voicePrefix: boolean } = { voicePrefix: true }) {
  const s = await loadSettings();
  const pre = (name: string) => (opts.voicePrefix ? `${name} · ` : '');
  $<HTMLSelectElement>('voice').innerHTML = VOICES.map((v) => `<option value="${v.id}">${pre('Kokoro')}${v.label}</option>`).join('');
  $<HTMLSelectElement>('piperVoice').innerHTML = PIPER_VOICES.map((v) => `<option value="${v.id}">${pre('Piper')}${v.label}</option>`).join('');
  $<HTMLSelectElement>('piperVoice').value = s.piperVoice;
  $<HTMLSelectElement>('stVoice').innerHTML = SUPERTONIC_VOICES.map((v) => `<option value="${v.id}">${pre('Supertonic')}${v.label}</option>`).join('');
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
  $<HTMLInputElement>('hoverBtn').checked = s.hoverPlay;
  $('hoverBtn').onchange = () => saveSettings({ hoverPlay: $<HTMLInputElement>('hoverBtn').checked });
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
}
