// The AI summary panel on the page: the summary as it streams in, with Read aloud / Copy / Close.
// Closed shadow root, isolated from page CSS (like the player).
import { parseSummary } from '../shared/summarize';

export interface SummaryPanelCallbacks {
  /** Read the summary aloud; `body` holds its text. */
  onRead(body: HTMLElement): void;
  onClose(): void;
}

export interface PanelAction {
  label: string;
  run(): void;
}

export class SummaryPanel {
  private host: HTMLElement | null = null;
  private el!: {
    title: HTMLElement;
    status: HTMLElement;
    track: HTMLElement;
    bar: HTMLElement;
    body: HTMLElement;
    note: HTMLElement;
    read: HTMLButtonElement;
    copy: HTMLButtonElement;
    action: HTMLButtonElement;
  };
  private text = '';
  private actionFn: (() => void) | null = null;

  constructor(private cb: SummaryPanelCallbacks) {}

  private build() {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;right:16px;top:16px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .s { display:flex; flex-direction:column; width:min(420px, calc(100vw - 32px)); max-height:min(70vh, 640px); box-sizing:border-box;
             border-radius:14px; background:#1d1d22; color:#f4f4f6; font:13px/1.5 system-ui,-apple-system,sans-serif;
             box-shadow:0 8px 28px rgba(0,0,0,.3) }
        header { display:flex; align-items:center; gap:8px; padding:10px 8px 6px 14px }
        h2 { all:unset; flex:1; font-weight:600; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
        h2 svg { vertical-align:-3px; margin-right:6px; fill:#ffb300 }
        button { all:unset; cursor:pointer; border-radius:8px; padding:6px 12px; background:#34343c; font-weight:600; font-size:12px }
        button:hover { background:#44444e } button:focus-visible { outline:2px solid #7aa7ff }
        button.primary { background:#ffb300; color:#1d1d22 } button.primary:hover { background:#ffc233 }
        button.close { padding:4px 8px; background:none; font-size:16px; line-height:1; opacity:.8 } button.close:hover { background:#34343c; opacity:1 }
        button[hidden], .track[hidden], .status[hidden], .note[hidden] { display:none }
        .status { padding:0 14px 8px; opacity:.85 }
        .track { margin:0 14px 10px; height:3px; background:#3a3a44; border-radius:2px; overflow:hidden }
        .bar { height:100%; width:0; background:#ffb300; transition:width .3s }
        .body { overflow:auto; padding:0 14px; min-height:0 }
        .body:empty { display:none }
        .body p { margin:0 0 8px } .body ul { margin:0 0 8px; padding-left:20px } .body li { margin:0 0 6px }
        .note { padding:6px 14px 0; font-size:11px; opacity:.6 }
        footer { display:flex; gap:6px; padding:10px 14px 12px }
        ::highlight(tts-sentence) { background-color: rgba(255, 213, 79, 0.25); }
        ::highlight(tts-word) { background-color: rgba(255, 179, 0, 0.85); color: #111; }
      </style>
      <section class="s" role="dialog" aria-label="Summary">
        <header>
          <h2><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"/></svg><span class="title">Summary</span></h2>
          <button class="close" title="Close" aria-label="Close summary">✕</button>
        </header>
        <div class="status" role="status"></div>
        <div class="track" hidden><div class="bar"></div></div>
        <div class="body"></div>
        <div class="note" hidden></div>
        <footer>
          <button class="primary read" hidden>Read aloud</button>
          <button class="copy" hidden>Copy</button>
          <button class="action" hidden></button>
        </footer>
      </section>`;
    const q = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
    this.el = {
      title: q('.title'),
      status: q('.status'),
      track: q('.track'),
      bar: q('.bar'),
      body: q('.body'),
      note: q('.note'),
      read: q('.read'),
      copy: q('.copy'),
      action: q('.action'),
    };
    q('.close').addEventListener('click', () => this.close());
    this.el.read.addEventListener('click', () => this.cb.onRead(this.el.body));
    this.el.copy.addEventListener('click', async () => {
      const plain = parseSummary(this.text).map((b) => (b.list ? `• ${b.text}` : b.text)).join('\n');
      await navigator.clipboard.writeText(plain).then(
        () => (this.el.copy.textContent = 'Copied'),
        () => (this.el.copy.textContent = "Couldn't copy"),
      );
      setTimeout(() => (this.el.copy.textContent = 'Copy'), 1500);
    });
    this.el.action.addEventListener('click', () => this.actionFn?.());
    root.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Escape' && this.close());
    document.documentElement.appendChild(host);
    this.host = host;
  }

  /** Opens (or resets) the panel for a new summary. */
  open(title: string) {
    if (!this.host) this.build();
    this.host!.style.display = '';
    this.text = '';
    this.el.title.textContent = title;
    this.el.body.replaceChildren();
    this.el.note.hidden = true;
    this.el.read.hidden = this.el.copy.hidden = true;
    this.setAction(null);
    this.status('Summarizing…');
  }

  get isOpen() {
    return !!this.host && this.host.style.display !== 'none';
  }

  close() {
    if (!this.host) return;
    this.host.style.display = 'none';
    this.cb.onClose();
  }

  /** A status line; `fraction` (0–1) shows a progress bar. Empty text hides it. */
  status(text: string, fraction?: number) {
    this.el.status.textContent = text;
    this.el.status.hidden = !text;
    this.el.track.hidden = fraction == null;
    if (fraction != null) this.el.bar.style.width = `${Math.round(fraction * 100)}%`;
  }

  /** Shows the summary so far. */
  setText(markdown: string) {
    this.text = markdown;
    const body = this.el.body;
    body.replaceChildren();
    let list: HTMLUListElement | null = null;
    for (const b of parseSummary(markdown)) {
      if (b.list) {
        list ??= body.appendChild(document.createElement('ul'));
        list.appendChild(document.createElement('li')).textContent = b.text;
      } else {
        list = null;
        body.appendChild(document.createElement('p')).textContent = b.text;
      }
    }
  }

  /** The summary is complete. */
  done(note: string) {
    this.status('');
    this.el.note.textContent = note;
    this.el.note.hidden = false;
    this.el.read.hidden = this.el.copy.hidden = !this.text.trim();
  }

  error(message: string, action: PanelAction | null = null) {
    this.status(message);
    this.setAction(action);
  }

  setAction(action: PanelAction | null) {
    this.actionFn = action?.run ?? null;
    this.el.action.hidden = !action;
    if (action) this.el.action.textContent = action.label;
  }

  /** Read aloud ↔ Stop reading. */
  setReading(reading: boolean) {
    if (this.host) this.el.read.textContent = reading ? 'Stop reading' : 'Read aloud';
  }

  /** For tests: the text shown. */
  get shownText() {
    return this.el?.body.textContent ?? '';
  }
}
