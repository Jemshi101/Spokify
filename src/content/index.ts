// Content script: reads web pages with the shared read-along UI.
import { extractPage, extractSelection } from '../reader/extract';
import { createReader } from '../reader/reader';
import { pageKey } from '../reader/positions';

declare global {
  interface Window { __ttsReader?: boolean }
}

if (!window.__ttsReader) {
  window.__ttsReader = true;
  createReader({
    extract: (mode, fromEl) => (mode === 'selection' ? extractSelection() : extractPage(fromEl)),
    positionKey: () => pageKey(),
  });
}
