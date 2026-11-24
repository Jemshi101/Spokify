// Read-along UI shared by the content script and the PDF viewer:
// highlighting, word timing, the floating player, and resume-where-you-left-off.
import type { Sentence } from './extract';
import { Player } from './player';
import { SelectionButton } from './selectionButton';
import { HoverPlay } from './hoverPlay';
import { PIPER_VOICES, SUPERTONIC_VOICES, VOICES, loadSettings, onSettingsChanged, saveSettings } from '../shared/settings';
import { sortedSystemVoices, voiceLabel } from '../host/voices';
import type { SpeechSegment, TabEvent } from '../shared/messages';
import { loadPosition, savePosition, clearPosition } from './positions';

export interface ReaderOptions {
  /** Finds what to read. `fromEl` = start at this element (Alt+click). */
  extract(mode: 'page' | 'selection', fromEl?: Element | null): Sentence[];
  /** Key for remembering the reading position (null disables resume). */
  positionKey(): string | null;
  /** Set for extension pages: events arrive relayed via runtime messages addressed to this tab. */
  tabId?: number;
}

/** 'auto' (the keyboard shortcut): the selection if there is one, else the page. */
type ExtractCmd = { type: 'extract'; mode: 'page' | 'selection' | 'auto' };

const hasSelection = () => (getSelection()?.toString().trim().length ?? 0) >= 3;

export function createReader(opts: ReaderOptions) {
  const hasHighlights = typeof CSS !== 'undefined' && 'highlights' in CSS;
  let sentences: Sentence[] = [];
  let segments: SpeechSegment[] = [];
  let current: { sid: number; starts: number[]; lastWord: number; raf: number; live: boolean } | null = null;
  let readingKey: string | null = null;
  const clock = { pos: 0, rate: 1, t0: 0, paused: false };
  const stats = { sentences: 0, exact: 0 };
  let userScrolledAt = 0;

  const send = (msg: object) => chrome.runtime.sendMessage({ target: 'sw', ...msg });
  const player = new Player({
    onAction: (a) => send({ type: 'host', payload: { type: a } }),
    onSpeed: (speed) => saveSettings({ speed }),
    onLocate: () => {
      userScrolledAt = 0; // resume auto-scroll
      const range = current && sentences[current.sid]?.range;
      if (range) bringIntoView(range);
      player.setLocate(false);
    },
    voiceMenu: async () => {
      // Offer the voices of whatever is speaking: Lite (system voices) or the natural voices.
      const [st, s] = await Promise.all([send({ type: 'host', payload: { type: 'status' } }).catch(() => null), loadSettings()]);
      family = st?.engine === 'system' ? 'system' : st?.engine === 'piper' ? 'piper' : st?.engine === 'supertonic' ? 'supertonic' : 'kokoro';
      if (family === 'supertonic') {
        return { title: 'Supertonic voices (CPU)', current: s.supertonicVoice, options: SUPERTONIC_VOICES.map((v) => ({ value: v.id, label: v.label })) };
      }
      if (family === 'piper') {
        return { title: 'Piper voices (CPU)', current: s.piperVoice, options: PIPER_VOICES.map((v) => ({ value: v.id, label: v.label })) };
      }
      if (family === 'system') {
        const voices = await sortedSystemVoices();
        return {
          title: 'Lite · system voices',
          current: s.systemVoice,
          options: [{ value: '', label: 'Best available English voice' }, ...voices.map((v) => ({ value: v.voiceURI, label: voiceLabel(v) }))],
        };
      }
      return { title: 'Kokoro voices', current: s.voice, options: VOICES.map((v) => ({ value: v.id, label: v.label })) };
    },
    onVoice: (value) =>
      saveSettings(
        family === 'system' ? { systemVoice: value } : family === 'piper' ? { piperVoice: value } : family === 'supertonic' ? { supertonicVoice: value } : { voice: value },
      ),
  });
  let family: 'kokoro' | 'supertonic' | 'piper' | 'system' = 'kokoro';
  const selectionButton = new SelectionButton(() => start(opts.extract('selection'), false));
  // While reading: hover a sentence for a play button that continues from there.
  let lastHover = -1;
  const hoverPlay = new HoverPlay({
    find(node, offset) {
      const at = (i: number) => {
        try {
          return sentences[i]?.range.comparePoint(node, offset) === 0;
        } catch {
          return false;
        }
      };
      if (!at(lastHover)) lastHover = sentences.findIndex((_, i) => at(i));
      return lastHover >= 0 ? { sid: lastHover, range: sentences[lastHover].range } : null;
    },
    onPlay: (sid) => jumpTo(sid),
    onPreview: (range) => highlight('tts-hover', range),
  });
  loadSettings().then((s) => {
    player.setSpeed(s.speed);
    selectionButton.enabled = s.selectionButton;
    hoverPlay.enabled = s.hoverPlay;
  });
  onSettingsChanged((s) => {
    player.setSpeed(s.speed);
    selectionButton.enabled = s.selectionButton;
    if (!s.selectionButton) selectionButton.hide();
    hoverPlay.enabled = s.hoverPlay;
    if (!s.hoverPlay) hoverPlay.hide();
  });

  const style = document.createElement('style');
  style.textContent = `
    ::highlight(tts-sentence) { background-color: rgba(255, 213, 79, 0.3); }
    ::highlight(tts-word) { background-color: rgba(255, 179, 0, 0.85); color: #111; }
    ::highlight(tts-hover) { background-color: rgba(122, 167, 255, 0.18); text-decoration: underline 2px rgba(255, 179, 0, 0.9); }`;
  (document.head || document.documentElement).appendChild(style);

  // ---------- reading ----------

  async function start(found: Sentence[], resume: boolean) {
    clear();
    player.clearOffer();
    sentences = found;
    if (!sentences.length) {
      player.status('Nothing to read here');
      player.hideSoon();
      return { ok: false, count: 0 };
    }
    stats.sentences = 0;
    stats.exact = 0;
    readingKey = resume ? opts.positionKey() : null;
    let startAt = 0;
    if (readingKey) {
      const saved = await loadPosition(readingKey);
      if (saved && saved.total === sentences.length && saved.sid > 0 && saved.sid < sentences.length - 1) startAt = saved.sid;
    }
    segments = sentences.map((s) => ({ text: s.text, words: s.words.map((w) => w.text) }));
    hoverPlay.active = true;
    hoverPlay.currentSid = -1;
    player.status('Starting…');
    player.setPaused(false);
    send({ type: 'read', segments, startAt, title: document.title });
    if (startAt > 0) {
      player.offer('Restart', () => {
        if (readingKey) clearPosition(readingKey);
        send({ type: 'read', segments, startAt: 0, title: document.title });
      });
    }
    return { ok: true, count: sentences.length, startAt };
  }

  /** Continues the current reading from sentence `sid` (the hover play button). */
  function jumpTo(sid: number) {
    if (!segments.length || !sentences[sid]) return;
    player.clearOffer();
    player.status('Starting…');
    player.setPaused(false);
    userScrolledAt = 0;
    send({ type: 'read', segments, startAt: sid, title: document.title });
  }

  // ---------- highlighting ----------

  function highlight(name: string, range: Range | null | undefined) {
    if (!hasHighlights) return;
    if (range) CSS.highlights.set(name, new Highlight(range));
    else CSS.highlights.delete(name);
  }

  function clear() {
    if (current) cancelAnimationFrame(current.raf);
    hoverPlay.active = false;
    hoverPlay.hide();
    current = null;
    player.setLocate(false);
    player.closeMenu();
    highlight('tts-sentence', null);
    highlight('tts-word', null);
  }

  const mediaTime = () => (clock.paused ? clock.pos : clock.pos + ((performance.now() - clock.t0) / 1000) * clock.rate);

  function setClock(pos: number, rate: number, paused: boolean) {
    Object.assign(clock, { pos, rate, paused, t0: performance.now() });
  }

  /** Shows the player's jump button while the sentence being read is off-screen. */
  let locateQueued = false;
  function updateLocate() {
    if (locateQueued) return;
    locateQueued = true;
    requestAnimationFrame(() => {
      locateQueued = false;
      const range = current && sentences[current.sid]?.range;
      const r = range?.getBoundingClientRect();
      const off = !!r && (r.bottom < 0 || r.top > innerHeight);
      player.setLocate(off);
      document.documentElement.dataset.ttsLocate = String(off); // for tests
    });
  }
  addEventListener('scroll', updateLocate, { passive: true, capture: true });

  /** Centers the range, scrolling whichever container holds it (the window, or an inner panel as in e-learning apps). */
  function bringIntoView(range: Range) {
    const n = range.startContainer;
    (n instanceof Element ? n : n.parentElement)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function follow(range: Range) {
    if (Date.now() - userScrolledAt < 4000) return;
    const r = range.getBoundingClientRect();
    if (r.top < 80 || r.bottom > innerHeight - 120) bringIntoView(range);
  }

  function onSentence(e: Extract<TabEvent, { type: 'sentence' }>) {
    const s = sentences[e.sid];
    if (!s) return;
    if (current) cancelAnimationFrame(current.raf);
    stats.sentences++;
    let starts = e.wordTimes;
    if (e.live || starts.length === s.words.length) stats.exact++;
    else {
      // No model timings: spread words across the sentence by character position.
      const voiced = Math.max(e.duration - 0.2, 0.1);
      starts = s.words.map((w) => (w.charStart / s.text.length) * voiced);
    }
    current = { sid: e.sid, starts, lastWord: -1, raf: 0, live: !!e.live };
    hoverPlay.currentSid = e.sid;
    setClock(0, e.rate, false);
    highlight('tts-sentence', s.range);
    highlight('tts-word', null);
    follow(s.range);
    updateLocate();
    player.status(`${e.sid + 1} / ${e.total}`);
    player.progress(e.sid, e.total);
    debugState(e.sid, e.total);
    if (readingKey) savePosition(readingKey, e.sid, e.total);
    if (!e.live) tick();
  }

  function onWord(e: Extract<TabEvent, { type: 'word' }>) {
    if (!current || current.sid !== e.sid) return;
    current.lastWord = e.wi;
    highlight('tts-word', sentences[e.sid]?.words[e.wi]?.range);
    debugState(e.sid, sentences.length);
  }

  /** Exposes reading state on <html data-tts-reader> for tests/e2e.mjs. */
  function debugState(sid: number, total: number) {
    document.documentElement.dataset.ttsReader = JSON.stringify({ sid, total, rate: clock.rate, paused: clock.paused, word: current?.lastWord ?? -1, ...stats });
  }

  function tick() {
    if (!current || current.live) return;
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

  function handle(msg: TabEvent | ExtractCmd, respond: (r: unknown) => void): boolean | void {
    switch (msg.type) {
      case 'extract': {
        const mode = msg.mode === 'auto' ? (hasSelection() ? 'selection' : 'page') : msg.mode;
        selectionButton.hide();
        start(opts.extract(mode), mode === 'page').then(respond);
        return true;
      }
      case 'sentence':
        player.setPaused(false);
        onSentence(msg);
        return;
      case 'word':
        onWord(msg);
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
        if (readingKey) clearPosition(readingKey);
      // falls through
      case 'stopped':
        clear();
        player.clearOffer();
        player.status(msg.type === 'ended' ? 'Finished' : 'Stopped');
        player.hideSoon();
        return;
      case 'notice':
        player.status(msg.message);
        return;
      case 'error':
        clear();
        player.status(`Error: ${msg.message}`);
        player.hideSoon(8000);
        return;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (opts.tabId != null) {
      // Extension page: only relayed messages for this tab.
      if (msg?.target !== 'tab' || msg.tabId !== opts.tabId) return;
      return handle(msg.payload, respond);
    }
    if (msg?.target) return; // content scripts get raw TabEvents from tabs.sendMessage
    return handle(msg, respond);
  });

  // Alt+click a paragraph to read from there.
  document.addEventListener(
    'click',
    (e) => {
      if (!e.altKey || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      start(opts.extract('page', e.target as Element), false);
    },
    true,
  );

  // Pause auto-scroll while the user scrolls on their own.
  for (const ev of ['wheel', 'touchmove'] as const) addEventListener(ev, () => (userScrolledAt = Date.now()), { passive: true });
  addEventListener('keydown', (e) => {
    if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '].includes(e.key)) userScrolledAt = Date.now();
  });

  return { start: (mode: 'page' | 'selection') => start(opts.extract(mode), mode === 'page') };
}
