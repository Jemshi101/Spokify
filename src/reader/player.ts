// Floating in-page player, isolated from page CSS by a closed shadow root.
import { SPEED_STEPS } from '../shared/settings';
import type { PlayerAction } from '../shared/messages';

export interface VoiceMenu {
  options: { value: string; label: string }[];
  current: string;
  /** Shown above the list, e.g. "Natural voices" or "Lite · system voices". */
  title: string;
}

export interface PlayerCallbacks {
  onAction(a: PlayerAction): void;
  onSpeed(speed: number): void;
  /** Scroll back to the sentence being read. */
  onLocate(): void;
  /** The voices to offer right now (natural or system, depending on what is speaking). */
  voiceMenu(): Promise<VoiceMenu>;
  onVoice(value: string): void;
}

const ICONS = {
  prev: '<path d="M6 6h2v12H6zM9.5 12l8.5 6V6z"/>',
  next: '<path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
  stop: '<path d="M6 6h12v12H6z"/>',
  locate: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.94 3A9 9 0 0 0 13 3.06V1h-2v2.06A9 9 0 0 0 3.06 11H1v2h2.06A9 9 0 0 0 11 20.94V23h2v-2.06A9 9 0 0 0 20.94 13H23v-2h-2.06zM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14z"/>',
  voice: '<path d="M9 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm6.08-7.95c.84 1.18.84 2.71 0 3.89l1.68 1.69c2.02-2.02 2.02-5.07 0-7.27l-1.68 1.69zM18.42 2l-1.63 1.63c2.77 3.02 2.77 7.56 0 10.74L18.42 16c3.9-3.89 3.91-9.95 0-14z"/>',
};
const svg = (p: string) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">${p}</svg>`;

export class Player {
  private host: HTMLElement | null = null;
  private el!: {
    status: HTMLElement;
    toggle: HTMLButtonElement;
    speed: HTMLButtonElement;
    bar: HTMLElement;
    offer: HTMLButtonElement;
    locate: HTMLButtonElement;
    menu: HTMLElement;
    menuTitle: HTMLElement;
    voices: HTMLSelectElement;
  };
  private offerAction: (() => void) | null = null;
  private offerTimer = 0;
  private hideTimer = 0;
  private speed = 1;

  constructor(private cb: PlayerCallbacks) {}

  private build() {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .p { display:flex; align-items:center; gap:2px; padding:6px 8px; border-radius:14px; background:#1d1d22; color:#f4f4f6;
             font:12px/1.3 system-ui,-apple-system,sans-serif; box-shadow:0 8px 28px rgba(0,0,0,.28); min-width:260px; max-width:min(380px, calc(100vw - 32px)); box-sizing:border-box }
        button { all:unset; cursor:pointer; height:32px; min-width:32px; display:grid; place-items:center; border-radius:9px; color:inherit }
        button:hover { background:#34343c } button:focus-visible { outline:2px solid #7aa7ff }
        .toggle { background:#f4f4f6; color:#1d1d22; width:36px; height:36px; border-radius:50% } .toggle:hover { background:#fff }
        .speed { font-weight:600; padding:0 6px; font-variant-numeric:tabular-nums }
        .info { flex:1; min-width:0; margin-left:6px; display:flex; flex-direction:column; gap:4px }
        .row { display:flex; align-items:center; gap:8px; min-width:0 }
        .status { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; opacity:.85 }
        .offer { height:auto; min-width:0; padding:1px 6px; border-radius:6px; background:#34343c; color:#ffd54f; font-weight:600; white-space:nowrap }
        .offer[hidden] { display:none }
        .track { height:3px; background:#3a3a44; border-radius:2px; overflow:hidden } .bar { height:100%; width:0; background:#ffb300; transition:width .3s }
        .locate { color:#ffb300 } .locate[hidden], .menu[hidden] { display:none }
        .menu { position:absolute; right:0; bottom:calc(100% + 8px); width:min(300px, calc(100vw - 32px)); box-sizing:border-box; padding:10px;
                border-radius:12px; background:#1d1d22; color:#f4f4f6; box-shadow:0 8px 28px rgba(0,0,0,.28); font:12px/1.3 system-ui,-apple-system,sans-serif }
        .menu b { display:block; margin:0 0 6px; font-weight:600; opacity:.85 }
        .menu select { width:100%; box-sizing:border-box; font:13px system-ui,-apple-system,sans-serif; color:#f4f4f6; background:#2a2a31;
                       border:1px solid #44444e; border-radius:8px; padding:4px }
        .menu option { padding:4px 6px }
      </style>
      <div class="menu" role="dialog" aria-label="Voice" hidden><b></b><select size="8" aria-label="Voice"></select></div>
      <div class="p" role="toolbar" aria-label="Read aloud">
        <button data-a="prev" title="Previous sentence (Alt+Shift+,)">${svg(ICONS.prev)}</button>
        <button data-a="toggle" class="toggle" title="Pause / resume (Alt+Shift+P)">${svg(ICONS.pause)}</button>
        <button data-a="next" title="Next sentence (Alt+Shift+.)">${svg(ICONS.next)}</button>
        <div class="info"><div class="row"><span class="status"></span><button class="offer" data-a="offer" hidden></button></div><div class="track"><div class="bar"></div></div></div>
        <button data-a="locate" class="locate" title="Jump to what's being read" aria-label="Jump to what's being read" hidden>${svg(ICONS.locate)}</button>
        <button data-a="voice" title="Voice" aria-label="Voice" aria-haspopup="dialog">${svg(ICONS.voice)}</button>
        <button data-a="speed" class="speed" title="Speed"></button>
        <button data-a="stop" title="Stop">${svg(ICONS.stop)}</button>
      </div>`;
    this.el = {
      status: root.querySelector('.status')!,
      toggle: root.querySelector('.toggle')!,
      speed: root.querySelector('.speed')!,
      bar: root.querySelector('.bar')!,
      offer: root.querySelector('.offer')!,
      locate: root.querySelector('.locate')!,
      menu: root.querySelector('.menu')!,
      menuTitle: root.querySelector('.menu b')!,
      voices: root.querySelector('.menu select')!,
    };
    this.el.voices.addEventListener('change', () => {
      this.cb.onVoice(this.el.voices.value);
      this.closeMenu();
    });
    this.el.voices.addEventListener('keydown', (e) => e.key === 'Escape' && this.closeMenu());
    // Close the voice menu on any click outside the player.
    document.addEventListener('mousedown', (e) => !e.composedPath().includes(host) && this.closeMenu(), true);
    root.addEventListener('click', (e) => {
      const a = (e.target as Element).closest('button')?.dataset.a;
      if (!a) return;
      if (a === 'offer') {
        const fn = this.offerAction;
        this.clearOffer();
        fn?.();
      } else if (a === 'locate') {
        this.cb.onLocate();
      } else if (a === 'voice') {
        this.toggleMenu();
      } else if (a === 'speed') {
        const next = SPEED_STEPS.find((s) => s > this.speed + 0.01) ?? SPEED_STEPS[0];
        this.setSpeed(next);
        this.cb.onSpeed(next);
      } else {
        this.cb.onAction(a as PlayerAction);
      }
    });
    document.documentElement.appendChild(host);
    this.host = host;
    this.setSpeed(this.speed);
  }

  show() {
    if (!this.host) this.build();
    clearTimeout(this.hideTimer);
    this.host!.style.display = '';
  }

  hideSoon(ms = 2500) {
    clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.host && (this.host.style.display = 'none'), ms);
  }

  status(text: string) {
    this.show();
    this.el.status.textContent = text;
  }

  progress(index: number, total: number) {
    this.show();
    this.el.bar.style.width = `${total ? ((index + 1) / total) * 100 : 0}%`;
  }

  /** Shows a temporary action next to the status, e.g. "Restart" after resuming mid-article. */
  offer(label: string, action: () => void, ms = 10000) {
    this.show();
    this.offerAction = action;
    this.el.offer.textContent = label;
    this.el.offer.hidden = false;
    clearTimeout(this.offerTimer);
    this.offerTimer = window.setTimeout(() => this.clearOffer(), ms);
  }

  clearOffer() {
    this.offerAction = null;
    if (this.host) this.el.offer.hidden = true;
  }

  /** Shows the jump button while the sentence being read is off-screen. */
  setLocate(visible: boolean) {
    if (this.host) this.el.locate.hidden = !visible;
  }

  private async toggleMenu() {
    if (!this.el.menu.hidden) return this.closeMenu();
    const m = await this.cb.voiceMenu();
    this.el.menuTitle.textContent = m.title;
    this.el.voices.innerHTML = '';
    for (const o of m.options) this.el.voices.add(new Option(o.label, o.value, false, o.value === m.current));
    this.el.menu.hidden = false;
    this.el.voices.focus();
  }

  closeMenu() {
    if (this.host) this.el.menu.hidden = true;
  }

  setPaused(paused: boolean) {
    if (!this.host) return;
    this.el.toggle.innerHTML = svg(paused ? ICONS.play : ICONS.pause);
    this.el.toggle.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  }

  setSpeed(speed: number) {
    this.speed = speed;
    if (this.host) this.el.speed.textContent = `${speed}×`;
  }
}
