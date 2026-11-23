// Google Docs helpers. Docs draws its editor on a canvas, so the text is read from the document's
// HTML export instead and shown in Spokify's own reader page (docs.html).

export interface DocRef {
  id: string;
  /** Account index from /u/N/ URLs, so the export uses the same Google account as the tab. */
  user: string | null;
}

const DOC_URL = /^https:\/\/docs\.google\.com\/document\/(?:u\/(\d+)\/)?d\/([A-Za-z0-9_-]{20,})/;

export function parseDocUrl(url: string | undefined): DocRef | null {
  const m = url?.match(DOC_URL);
  return m ? { id: m[2], user: m[1] ?? null } : null;
}

export function exportUrl(ref: DocRef): string {
  return `https://docs.google.com/document/${ref.user ? `u/${ref.user}/` : ''}d/${ref.id}/export?format=html`;
}

export function editUrl(ref: DocRef): string {
  return `https://docs.google.com/document/${ref.user ? `u/${ref.user}/` : ''}d/${ref.id}/edit`;
}

/** "Design doc - Google Docs" → "Design doc". */
export function docTitle(tabTitle: string | undefined): string {
  return (tabTitle ?? '').replace(/\s+-\s+Google (Docs|Документы|Dokumente|Documentos)$/, '').trim();
}

/**
 * Scopes one selector of the export's stylesheet to the reader's container, so the document's
 * styles can't restyle the page around it. `body` and the body's own classes map to the container.
 */
export function scopeSelector(selector: string, scope: string, bodyClasses: string[]): string {
  return selector
    .split(',')
    .map((part) => {
      const s = part.trim();
      if (!s) return s;
      if (/^(html|body)$/i.test(s)) return scope;
      const rest = s.replace(/^(html|body)\b\s*/i, '');
      const out = [`${scope} ${rest}`];
      const cls = rest.match(/^\.([\w-]+)$/)?.[1];
      if (cls && bodyClasses.includes(cls)) out.push(`${scope}.${cls}`);
      return out.join(', ');
    })
    .filter(Boolean)
    .join(', ');
}
