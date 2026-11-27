// AI summaries with the browser's own on-device model, through the standard Summarizer API:
// Gemini Nano in Chrome, Phi in Edge. Text never leaves the computer. Other browsers (Opera's Aria,
// Firefox) don't offer a model to extensions.
import type { SummaryLength, SummaryType } from './settings';

/**
 * 'unsupported': the browser has no Summarizer API at all. 'no-answer': it didn't say whether the
 * model is ready in time. The rest are the API's own states.
 */
export type SummaryState = 'unsupported' | 'no-answer' | 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface Summarizer {
  readonly inputQuota: number;
  measureInputUsage(text: string, opts?: { signal?: AbortSignal }): Promise<number>;
  summarize(text: string, opts?: { context?: string; signal?: AbortSignal }): Promise<string>;
  summarizeStreaming(text: string, opts?: { context?: string; signal?: AbortSignal }): AsyncIterable<string>;
  destroy(): void;
}

interface CreateOptions {
  type: SummaryType;
  format: 'markdown' | 'plain-text';
  length: SummaryLength;
  sharedContext?: string;
  expectedInputLanguages?: string[];
  outputLanguage?: string;
  signal?: AbortSignal;
  monitor?(m: EventTarget): void;
}

interface SummarizerApi {
  availability(opts?: Partial<CreateOptions>): Promise<Exclude<SummaryState, 'unsupported' | 'no-answer'>>;
  create(opts: CreateOptions): Promise<Summarizer>;
}

const api = () => (globalThis as { Summarizer?: SummarizerApi }).Summarizer;

/** Output languages the browsers' summarizers support; anything else is summarized in English. */
const OUTPUT_LANGUAGES = ['en', 'de', 'es', 'fr', 'ja'];
export const outputLanguage = (pageLang: string) => {
  const l = pageLang.toLowerCase().split('-')[0];
  return OUTPUT_LANGUAGES.includes(l) ? l : 'en';
};

/** Which AI this browser uses, for messages ("Chrome's built-in AI (Gemini Nano)"). */
export function browserAi(): string {
  const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands.map((b) => b.brand) ?? [];
  if (brands.some((b) => /edge/i.test(b))) return "Edge's built-in AI";
  if (brands.some((b) => /opera/i.test(b))) return "Opera's built-in AI";
  return "Chrome's built-in AI (Gemini Nano)";
}

export async function summaryState(lang = 'en', timeoutMs = 30000): Promise<SummaryState> {
  const s = api();
  if (!s) return 'unsupported';
  let timer = 0;
  try {
    return await Promise.race([
      s.availability({ type: 'key-points', format: 'markdown', length: 'medium', outputLanguage: outputLanguage(lang) }),
      new Promise<'no-answer'>((ok) => (timer = setTimeout(() => ok('no-answer'), timeoutMs) as unknown as number)),
    ]);
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}

/** What to tell the user when summaries can't run (null when they can, or after a download). */
export function stateMessage(state: SummaryState): string | null {
  switch (state) {
    case 'unsupported':
      return "This browser doesn't give extensions a built-in AI. Summaries work in Chrome and Microsoft Edge (version 138 or later), which run a small AI model on your computer. Opera's Aria can't be used by extensions.";
    case 'no-answer':
      return `${browserAi()} didn't answer. It may still be starting up; try again in a minute.`;
    case 'unavailable':
      return `${browserAi()} can't run on this computer, or it's turned off. It needs about 22 GB of free disk space and either a graphics card with more than 4 GB of memory or 16 GB of RAM.`;
    case 'downloadable':
      return `Summaries need ${browserAi()}, a one-time download of a few GB. It runs on your computer, so pages are never sent anywhere.`;
    case 'downloading':
      return `${browserAi()} is downloading. Summaries will work once it's done.`;
    default:
      return null;
  }
}

/**
 * Starts (or follows) the one-time model download. Must run during a click: browsers require a user
 * gesture to start the download.
 */
export async function downloadModel(onProgress: (fraction: number) => void, lang = 'en'): Promise<void> {
  const s = api();
  if (!s) throw new Error(stateMessage('unsupported')!);
  const model = await s.create({
    type: 'key-points',
    format: 'markdown',
    length: 'medium',
    outputLanguage: outputLanguage(lang),
    monitor: (m) => m.addEventListener('downloadprogress', (e) => onProgress((e as ProgressEvent).loaded)),
  });
  model.destroy();
}

/** Groups sentences into parts of at most `maxChars` (a sentence longer than that is cut). */
export function chunkSentences(sentences: string[], maxChars: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (let s of sentences) {
    s = s.trim();
    while (s.length > maxChars) {
      if (cur) out.push(cur), (cur = '');
      out.push(s.slice(0, maxChars));
      s = s.slice(maxChars);
    }
    if (!s) continue;
    if (cur && cur.length + 1 + s.length > maxChars) out.push(cur), (cur = '');
    cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

/** Summary markdown → paragraphs and list items, plain text (no **bold** markers or # headings). */
export function parseSummary(md: string): { list: boolean; text: string }[] {
  const out: { list: boolean; text: string }[] = [];
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const item = /^(?:[-*•]|\d+[.)])\s+/.exec(line);
    const text = line
      .slice(item?.[0].length ?? 0)
      .replace(/^#+\s*/, '')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(^|\W)[*_](\S.*?\S|\S)[*_](?=\W|$)/g, '$1$2')
      .replace(/`([^`]*)`/g, '$1')
      .trim();
    if (text) out.push({ list: !!item, text });
  }
  return out;
}

export interface SummarizeJob {
  sentences: string[];
  title: string;
  lang: string;
  type: SummaryType;
  length: SummaryLength;
  signal: AbortSignal;
  /** Long pages are summarized part by part first. */
  onProgress(part: number, parts: number): void;
  /** The summary so far (markdown), as it streams in. */
  onText(text: string): void;
}

/** Most parts a page is cut into; text beyond that is left out of the summary. */
const MAX_PARTS = 24;

export async function summarize(job: SummarizeJob): Promise<{ text: string; partial: boolean }> {
  const s = api();
  if (!s) throw new Error(stateMessage('unsupported')!);
  const { signal } = job;
  const lang = outputLanguage(job.lang);
  const context = job.title ? `A web page titled "${job.title}".` : undefined;
  const final = await s.create({ type: job.type, format: 'markdown', length: job.length, sharedContext: context, outputLanguage: lang, signal });
  const parts: Summarizer[] = [final];
  try {
    const all = job.sentences.join(' ');
    // Fits in one go?
    if ((await final.measureInputUsage(all, { signal })) <= final.inputQuota * 0.9) return { text: await stream(final, all, job), partial: false };

    // Too long: summarize each part briefly, then summarize those summaries.
    const part = await s.create({ type: 'tldr', format: 'plain-text', length: 'medium', sharedContext: context, outputLanguage: lang, signal });
    parts.push(part);
    // About 3 characters per token leaves room for the instructions.
    let chunks = chunkSentences(job.sentences, Math.max(1000, Math.floor(part.inputQuota * 0.8 * 3)));
    const partial = chunks.length > MAX_PARTS;
    chunks = chunks.slice(0, MAX_PARTS);
    let notes: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      job.onProgress(i + 1, chunks.length);
      notes.push(...(await summarizeFitting(part, chunks[i], signal)));
    }
    // Still too long for one summary (a very long page): condense the notes once more.
    while ((await final.measureInputUsage(notes.join('\n'), { signal })) > final.inputQuota * 0.9 && notes.length > 1) {
      const groups = chunkSentences(notes, Math.max(1000, Math.floor(part.inputQuota * 0.8 * 3)));
      if (groups.length >= notes.length) break;
      const next: string[] = [];
      for (const g of groups) next.push(...(await summarizeFitting(part, g, signal)));
      notes = next;
    }
    return { text: await stream(final, notes.join('\n'), job), partial };
  } finally {
    for (const p of parts) p.destroy();
  }
}

/** Summarizes `text`, halving it when the model says it's over its limit. */
async function summarizeFitting(model: Summarizer, text: string, signal: AbortSignal): Promise<string[]> {
  if (text.length > 400 && (await model.measureInputUsage(text, { signal })) > model.inputQuota * 0.95) {
    const mid = text.lastIndexOf(' ', text.length / 2);
    const cut = mid > 0 ? mid : text.length / 2;
    return [...(await summarizeFitting(model, text.slice(0, cut), signal)), ...(await summarizeFitting(model, text.slice(cut), signal))];
  }
  return [await model.summarize(text, { signal })];
}

async function stream(model: Summarizer, text: string, job: SummarizeJob): Promise<string> {
  let out = '';
  for await (const chunk of model.summarizeStreaming(text, { signal: job.signal })) {
    out += chunk;
    job.onText(out);
  }
  return out;
}
