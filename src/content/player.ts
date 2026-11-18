// Floating in-page player, isolated from page CSS by a closed shadow root.
import { SPEED_STEPS } from '../shared/settings';
import type { PlayerAction } from '../shared/messages';

export interface PlayerCallbacks {
  onAction(a: PlayerAction): void;
  onSpeed(speed: number): void;
}

const ICONS = {
  prev: '<path d="M6 6h2v12H6zM9.5 12l8.5 6V6z"/>',
  next: '<path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
  stop: '<path d="M6 6h12v12H6z"/>',
};
const svg = (p: string) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">${p}</svg>`;

export class Player {
  private host: HTMLElement | null = null;
  private el!: { status: HTMLElement; toggle: HTMLButtonElement; speed: HTMLButtonElement; bar: HTMLElement };
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
        .status { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; opacity:.85 }
        .track { height:3px; background:#3a3a44; border-radius:2px; overflow:hidden } .bar { height:100%; width:0; background:#ffb300; transition:width .3s }
      </style>
      <div class="p" role="toolbar" aria-label="Read aloud">
        <button data-a="prev" title="Previous sentence (Alt+Shift+,)">${svg(ICONS.prev)}</button>
        <button data-a="toggle" class="toggle" title="Pause / resume (Alt+Shift+P)">${svg(ICONS.pause)}</button>
        <button data-a="next" title="Next sentence (Alt+Shift+.)">${svg(ICONS.next)}</button>
        <div class="info"><span class="status"></span><div class="track"><div class="bar"></div></div></div>
        <button data-a="speed" class="speed" title="Speed"></button>
        <button data-a="stop" title="Stop">${svg(ICONS.stop)}</button>
      </div>`;
    this.el = {
      status: root.querySelector('.status')!,
      toggle: root.querySelector('.toggle')!,
      speed: root.querySelector('.speed')!,
      bar: root.querySelector('.bar')!,
    };
    root.addEventListener('click', (e) => {
      const a = (e.target as Element).closest('button')?.dataset.a;
      if (!a) return;
      if (a === 'speed') {
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
