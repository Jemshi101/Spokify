// Content script: extraction, read-along highlighting and the floating player.
import { extractPage, extractSelection, type Sentence } from './extract';
import { Player } from './player';
import { loadSettings, saveSettings } from '../shared/settings';
import type { SpeechSegment, TabEvent } from '../shared/messages';

declare global {
  interface Window { __ttsReader?: boolean }
}

if (!window.__ttsReader) {
  window.__ttsReader = true;
  init();
}

function init() {
  const hasHighlights = typeof CSS !== 'undefined' && 'highlights' in CSS;
  let sentences: Sentence[] = [];
  let current: { sid: number; starts: number[]; lastWord: number; raf: number } | null = null;
  const clock = { pos: 0, rate: 1, t0: 0, paused: false };
  const stats = { sentences: 0, exact: 0 };
  let userScrolledAt = 0;

  const send = (msg: object) => chrome.runtime.sendMessage({ target: 'sw', ...msg });
  const player = new Player({
    onAction: (a) => send({ type: 'host', payload: { type: a } }),
    onSpeed: (speed) => saveSettings({ speed }),
  });
  loadSettings().then((s) => player.setSpeed(s.speed));
  chrome.storage.onChanged.addListener((c) => {
    const s = c.settings?.newValue as { speed?: number } | undefined;
    if (s?.speed) player.setSpeed(s.speed);
  });

  const style = document.createElement('style');
  style.textContent = `
    ::highlight(tts-sentence) { background-color: rgba(255, 213, 79, 0.3); }
    ::highlight(tts-word) { background-color: rgba(255, 179, 0, 0.85); color: #111; }`;
  (document.head || document.documentElement).appendChild(style);

  // ---------- reading ----------

  function start(found: Sentence[]) {
    clear();
    sentences = found;
    if (!sentences.length) {
      player.status('Nothing to read here');
      player.hideSoon();
      return { ok: false, count: 0 };
    }
    stats.sentences = 0;
    stats.exact = 0;
    const segments: SpeechSegment[] = sentences.map((s) => ({ text: s.text, words: s.words.map((w) => w.text) }));
    player.status('Starting…');
    player.setPaused(false);
    send({ type: 'read', segments });
    return { ok: true, count: sentences.length };
  }

  // ---------- highlighting ----------

  function highlight(name: string, range: Range | null | undefined) {
    if (!hasHighlights) return;
    if (range) CSS.highlights.set(name, new Highlight(range));
    else CSS.highlights.delete(name);
  }

  function clear() {
    if (current) cancelAnimationFrame(current.raf);
    current = null;
    highlight('tts-sentence', null);
    highlight('tts-word', null);
  }

  const mediaTime = () => (clock.paused ? clock.pos : clock.pos + ((performance.now() - clock.t0) / 1000) * clock.rate);

  function setClock(pos: number, rate: number, paused: boolean) {
    Object.assign(clock, { pos, rate, paused, t0: performance.now() });
  }

  function follow(range: Range) {
    if (Date.now() - userScrolledAt < 4000) return;
    const r = range.getBoundingClientRect();
    if (r.top < 80 || r.bottom > innerHeight - 120) scrollBy({ top: r.top - innerHeight / 3, behavior: 'smooth' });
  }

  function onSentence(e: Extract<TabEvent, { type: 'sentence' }>) {
    const s = sentences[e.sid];
    if (!s) return;
    if (current) cancelAnimationFrame(current.raf);
    stats.sentences++;
    let starts = e.wordTimes;
    if (starts.length === s.words.length) stats.exact++;
    else {
      // No model timings: spread words across the sentence by character position.
      const voiced = Math.max(e.duration - 0.2, 0.1);
      starts = s.words.map((w) => (w.charStart / s.text.length) * voiced);
    }
    current = { sid: e.sid, starts, lastWord: -1, raf: 0 };
    setClock(0, e.rate, false);
    highlight('tts-sentence', s.range);
    highlight('tts-word', null);
    follow(s.range);
    player.status(`${e.sid + 1} / ${e.total}`);
    player.progress(e.sid, e.total);
    debugState(e.sid, e.total);
    tick();
  }

  /** Exposes reading state on <html data-tts-reader> for tests/e2e.mjs. */
  function debugState(sid: number, total: number) {
    document.documentElement.dataset.ttsReader = JSON.stringify({ sid, total, rate: clock.rate, paused: clock.paused, ...stats });
  }

  function tick() {
    if (!current) return;
    const t = mediaTime();
    const { starts } = current;
    let i = Math.max(current.lastWord, 0);
    if (current.lastWord >= 0 && starts[i] > t) i = 0; // clock moved backwards
    while (i + 1 < starts.length && starts[i + 1] <= t) i++;
    if (starts.length && t >= starts[0] - 0.02 && i !== current.lastWord) {
      current.lastWord = i;
      highlight('tts-word', sentences[current.sid]?.words[i]?.range);
    }
    current.raf = requestAnimationFrame(tick);
  }

  // ---------- messages ----------

  chrome.runtime.onMessage.addListener((msg: TabEvent | { type: 'extract'; mode: 'page' | 'selection' }, _s, respond) => {
    switch (msg.type) {
      case 'extract': {
        const found = msg.mode === 'selection' ? extractSelection() : extractPage();
        respond(start(found));
        return;
      }
      case 'sentence':
        player.setPaused(false);
        onSentence(msg);
        return;
      case 'sync':
        setClock(msg.pos, msg.rate, msg.paused);
        player.setPaused(msg.paused);
        if (current) debugState(current.sid, sentences.length);
        if (msg.paused) player.status('Paused');
        else if (current) player.status(`${current.sid + 1} / ${sentences.length}`);
        return;
      case 'buffering':
        player.status(msg.sid === 0 ? 'Preparing voice…' : 'Generating…');
        return;
      case 'loading':
        player.status(msg.percent == null ? 'Loading voice…' : `Downloading voice ${msg.percent}%`);
        return;
      case 'ended':
      case 'stopped':
        clear();
        player.status(msg.type === 'ended' ? 'Finished' : 'Stopped');
        player.hideSoon();
        return;
      case 'error':
        clear();
        player.status(`Error: ${msg.message}`);
        player.hideSoon(8000);
        return;
    }
  });

  // Alt+click a paragraph to read from there.
  document.addEventListener(
    'click',
    (e) => {
      if (!e.altKey || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      start(extractPage(e.target as Element));
    },
    true,
  );

  // Pause auto-scroll while the user scrolls on their own.
  for (const ev of ['wheel', 'touchmove'] as const) addEventListener(ev, () => (userScrolledAt = Date.now()), { passive: true });
  addEventListener('keydown', (e) => {
    if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '].includes(e.key)) userScrolledAt = Date.now();
  });
}
