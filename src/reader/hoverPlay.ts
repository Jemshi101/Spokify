// While a page is being read, hovering a sentence shows a small play button in the margin next to it.
// Clicking it continues reading from that sentence (closed shadow root, isolated from page CSS).

export interface HoverTarget {
  sid: number;
  range: Range;
}

export interface HoverPlayOptions {
  /** The sentence of the current reading at this text position, or null. */
  find(node: Node, offset: number): HoverTarget | null;
  /** Read from this sentence. */
  onPlay(sid: number): void;
  /** Mark (or unmark, with null) the sentence the button would read from. */
  onPreview(range: Range | null): void;
}

const SIZE = 26;
/** How far into the margin the pointer may go (to reach the button) before it hides. */
const MARGIN = SIZE + 16;

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & { caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null };
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

function blockOf(node: Node): Element | null {
  let el: Element | null = node instanceof Element ? node : node.parentElement;
  while (el && el !== document.body && getComputedStyle(el).display.startsWith('inline')) el = el.parentElement;
  return el;
}

export class HoverPlay {
  private host: HTMLElement | null = null;
  private button!: HTMLButtonElement;
  private target: HoverTarget | null = null;
  private block: DOMRect | null = null;
  private queued: { x: number; y: number } | null = null;
  private hideTimer = 0;
  /** True while a reading session is going on (playing or paused). */
  active = false;
  enabled = true;
  /** Sentence being read now: no button for it. */
  currentSid = -1;

  constructor(private opts: HoverPlayOptions) {
    addEventListener(
      'mousemove',
      (e) => {
        if (!this.active || !this.enabled || e.buttons || this.isOwn(e)) return;
        if (!this.queued) requestAnimationFrame(() => this.check());
        this.queued = { x: e.clientX, y: e.clientY };
      },
      { passive: true, capture: true },
    );
    addEventListener('scroll', () => this.hide(), { passive: true, capture: true });
    document.addEventListener('mouseleave', () => this.hideSoon());
  }

  private isOwn(e: Event) {
    return !!this.host && e.composedPath().includes(this.host);
  }

  private check() {
    const p = this.queued;
    this.queued = null;
    if (!p) return;
    // Selecting text: the selection's own Read button takes over.
    if ((getSelection()?.toString().trim().length ?? 0) > 0) return this.hide();
    // Still inside the hovered paragraph (or its margin, on the way to the button)?
    const b = this.block;
    const inBlock = (r: DOMRect | null) => !!r && p.x >= r.left - MARGIN && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
    const caret = caretAt(p.x, p.y);
    const hit = caret && this.opts.find(caret.node, caret.offset);
    if (hit && caret) {
      const block = blockOf(caret.node)?.getBoundingClientRect() ?? null;
      // The caret snaps to the nearest text, even from far away: require the pointer to be over its paragraph.
      if (inBlock(block)) {
        if (hit.sid === this.currentSid) return this.hide();
        this.show(hit, block!);
        return;
      }
    }
    if (inBlock(b)) return; // in the margin next to the shown button
    this.hideSoon();
  }

  private build() {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483646;display:none;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        button { all:unset; cursor:pointer; box-sizing:border-box; width:${SIZE}px; height:${SIZE}px; border-radius:50%;
                 display:grid; place-items:center; background:#1d1d22; box-shadow:0 3px 10px rgba(0,0,0,.25);
                 opacity:.85; transition:opacity .12s, transform .12s }
        button:hover { opacity:1; transform:scale(1.08) } button:focus-visible { outline:2px solid #7aa7ff }
        svg { width:14px; height:14px; fill:#ffb300; margin-left:2px }
      </style>
      <button type="button" title="Read from here" aria-label="Read from here">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
      </button>`;
    this.button = root.querySelector('button')!;
    this.button.addEventListener('mousedown', (e) => e.preventDefault());
    this.button.addEventListener('mouseenter', () => {
      clearTimeout(this.hideTimer);
      this.opts.onPreview(this.target?.range ?? null);
    });
    this.button.addEventListener('mouseleave', () => this.opts.onPreview(null));
    this.button.addEventListener('click', () => {
      const t = this.target;
      this.hide();
      if (t) this.opts.onPlay(t.sid);
    });
    document.documentElement.appendChild(host);
    this.host = host;
  }

  private show(t: HoverTarget, block: DOMRect) {
    clearTimeout(this.hideTimer);
    if (!this.host) this.build();
    const first = [...t.range.getClientRects()].find((r) => r.width || r.height);
    if (!first) return this.hide();
    this.target = t;
    this.block = block;
    const host = this.host!;
    // In the margin left of the paragraph, level with the sentence's first line.
    const left = Math.max(4, block.left - SIZE - 8);
    const top = Math.min(Math.max(4, first.top + first.height / 2 - SIZE / 2), innerHeight - SIZE - 4);
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    host.style.display = 'block';
  }

  private hideSoon() {
    clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), 400);
  }

  hide() {
    clearTimeout(this.hideTimer);
    if (this.host?.style.display === 'block') this.opts.onPreview(null);
    if (this.host) this.host.style.display = 'none';
    this.target = null;
    this.block = null;
  }

  /** For tests: where the button is, or null when hidden. */
  get rect(): DOMRect | null {
    return this.host && this.host.style.display !== 'none' ? this.host.getBoundingClientRect() : null;
  }
}
