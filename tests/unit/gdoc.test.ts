import { describe, expect, it } from 'vitest';
import { docTitle, editUrl, exportUrl, parseDocUrl, scopeSelector } from '../../src/docs/gdoc';

const ID = '1PTI3udZ6TI-R0MlSsl2aflxRcnZ5blnkGGHE5JRI_Z8';

describe('Google Docs URLs', () => {
  it('recognises document URLs, with and without an account index', () => {
    expect(parseDocUrl(`https://docs.google.com/document/d/${ID}/edit?tab=t.0#heading=h.x`)).toEqual({ id: ID, user: null });
    expect(parseDocUrl(`https://docs.google.com/document/u/1/d/${ID}/edit`)).toEqual({ id: ID, user: '1' });
  });
  it('ignores sheets, slides and other sites', () => {
    expect(parseDocUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit`)).toBeNull();
    expect(parseDocUrl(`https://docs.google.com/presentation/d/${ID}/edit`)).toBeNull();
    expect(parseDocUrl(`https://example.com/document/d/${ID}/edit`)).toBeNull();
    expect(parseDocUrl(undefined)).toBeNull();
  });
  it('exports with the same Google account as the tab', () => {
    expect(exportUrl({ id: ID, user: null })).toBe(`https://docs.google.com/document/d/${ID}/export?format=html`);
    expect(exportUrl({ id: ID, user: '2' })).toBe(`https://docs.google.com/document/u/2/d/${ID}/export?format=html`);
    expect(editUrl({ id: ID, user: '2' })).toBe(`https://docs.google.com/document/u/2/d/${ID}/edit`);
  });
  it('strips the "Google Docs" suffix from tab titles', () => {
    expect(docTitle('Android child process priority - Google Docs')).toBe('Android child process priority');
    expect(docTitle('Plan')).toBe('Plan');
  });
});

describe('scopeSelector', () => {
  it('scopes element and class selectors to the container', () => {
    expect(scopeSelector('p', '#doc', [])).toBe('#doc p');
    expect(scopeSelector('ul.lst-kix_a-0>li:before', '#doc', [])).toBe('#doc ul.lst-kix_a-0>li:before');
    expect(scopeSelector('table td,table th', '#doc', [])).toBe('#doc table td, #doc table th');
  });
  it('maps body and the body classes onto the container itself', () => {
    expect(scopeSelector('body', '#doc', [])).toBe('#doc');
    expect(scopeSelector('.c21', '#doc', ['c21', 'doc-content'])).toBe('#doc .c21, #doc.c21');
    expect(scopeSelector('.c3', '#doc', ['c21'])).toBe('#doc .c3');
  });
});
