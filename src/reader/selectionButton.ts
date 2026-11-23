// A small "Read" button that appears next to selected text (closed shadow root, isolated from page CSS).
// Clicking it reads just the selection.

/** Minimum selected characters before the button appears (avoids flashing on stray clicks). */
const MIN_CHARS = 3;

function editable(node: Node | null): boolean {
  const el = node instanceof Element ? node : node?.parentElement;
  return !!el?.closest('input, textarea, select, [contenteditable=""], [contenteditable=true]');
}

export class SelectionButton {
  private host: HTMLElement | null = null;
  private button!: HTMLButtonElement;
  enabled = true;

  constructor(private onRead: () => void) {
    // After a mouse or keyboard selection settles, show or hide the button.
    const check = () => setTimeout(() => this.update(), 10);
    addEventListener('mouseup', (e) => !this.isOwn(e) && check(), true);
    addEventListener('keyup', (e) => (e.shiftKey || e.key === 'Shift' ? check() : e.key === 'Escape' && this.hide()), true);
    document.addEventListener('selectionchange', () => {
      const sel = getSelection();
      if (!sel || sel.isCollapsed) this.hide();
    });
    addEventListener('scroll', () => this.hide(), { passive: true, capture: true });
  }

  private isOwn(e: Event) {
    return !!this.host && e.composedPath().includes(this.host);
  }

  private build() {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;display:none;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        button { all:unset; cursor:pointer; display:flex; align-items:center; gap:5px; padding:5px 10px 5px 8px; border-radius:999px;
                 background:#1d1d22; color:#f4f4f6; font:600 12px/1 system-ui,-apple-system,sans-serif; box-shadow:0 4px 14px rgba(0,0,0,.25) }
        button:hover { background:#34343c } button:focus-visible { outline:2px solid #7aa7ff }
        svg { width:14px; height:14px; fill:#ffb300 }
      </style>
      <button type="button" title="Read the selection aloud" aria-label="Read the selection aloud">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>Read
      </button>`;
    this.button = root.querySelector('button')!;
    // Keep the selection: a mousedown on the button would otherwise clear it.
    this.button.addEventListener('mousedown', (e) => e.preventDefault());
    this.button.addEventListener('click', () => {
      this.hide();
      this.onRead();
    });
    document.documentElement.appendChild(host);
    this.host = host;
  }

  update() {
    const sel = getSelection();
    if (!this.enabled || !sel || sel.isCollapsed || sel.rangeCount === 0 || sel.toString().trim().length < MIN_CHARS || editable(sel.anchorNode)) {
      return this.hide();
    }
    const rects = [...sel.getRangeAt(sel.rangeCount - 1).getClientRects()].filter((r) => r.width || r.height);
    const last = rects.at(-1);
    if (!last) return this.hide();
    if (!this.host) this.build();
    const host = this.host!;
    host.style.display = 'block';
    // Just below the end of the selection, kept inside the viewport.
    const w = host.offsetWidth || 70;
    const h = host.offsetHeight || 26;
    const left = Math.min(Math.max(8, last.right - w / 2), innerWidth - w - 8);
    const top = last.bottom + 8 + h > innerHeight ? Math.max(8, last.top - h - 8) : last.bottom + 8;
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
  }

  hide() {
    if (this.host) this.host.style.display = 'none';
  }

  /** For tests: where the button is, or null when hidden. */
  get rect(): DOMRect | null {
    return this.host && this.host.style.display !== 'none' ? this.host.getBoundingClientRect() : null;
  }
}
