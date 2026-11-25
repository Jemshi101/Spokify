// Service worker: starts the audio host, relays messages, owns menus, shortcuts and tab lifecycle.
import { loadSettings } from '../shared/settings';
import { parseDocUrl } from '../docs/gdoc';
import type { HostCommand } from '../shared/messages';

const HOST_URL = 'host.html';
const PDF_VIEWER = 'pdf.html';
const DOCS_VIEWER = 'docs.html';
/** Per-computer state the audio host needs (it can't read chrome.storage itself). */
const MACHINE_KEYS = ['gpuSlow', 'stSlow', 'testSlowRealtime', 'testMute'];
/** How long a page may take to collect its text before Read reports it as unresponsive. */
const EXTRACT_TIMEOUT_MS = 15000;
let creating: Promise<unknown> | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pingHost(): Promise<{ ok: boolean; kind: string } | null> {
  try {
    const r = await chrome.runtime.sendMessage({ target: 'host', type: 'ping' });
    return r?.ok ? r : null;
  } catch {
    return null;
  }
}

async function createHost() {
  if (chrome.offscreen?.createDocument) {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: HOST_URL,
        reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK, chrome.offscreen.Reason.WORKERS],
        justification: 'Generate speech with a local model and keep playing while the user browses.',
      });
    }
  } else {
    // Browsers without chrome.offscreen: host the engine in a pinned background tab.
    const url = chrome.runtime.getURL(HOST_URL);
    const tabs = await chrome.tabs.query({ url });
    if (!tabs.length) await chrome.tabs.create({ url, pinned: true, active: false });
  }
  for (let i = 0; i < 100; i++) {
    const r = await pingHost();
    if (r) return r;
    await sleep(100);
  }
  throw new Error('Audio host did not start');
}

async function ensureHost() {
  const r = await pingHost();
  if (r) return r;
  creating ??= createHost().finally(() => (creating = null));
  return creating;
}

async function toHost(cmd: HostCommand) {
  await ensureHost();
  return chrome.runtime.sendMessage({ target: 'host', ...cmd });
}

/** Sends to the host only if it is already running (never starts it). */
async function toHostIfRunning(cmd: HostCommand) {
  if (await pingHost()) return chrome.runtime.sendMessage({ target: 'host', ...cmd });
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)))]).finally(() =>
    clearTimeout(timer),
  );
}

async function sendToTab(tabId: number, payload: unknown) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch {
    // Tab was open before the extension loaded: inject the content script, then retry.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return chrome.tabs.sendMessage(tabId, payload);
  }
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id == null) throw new Error('No active tab');
  return tab.id;
}

const stripHash = (u?: string) => (u ?? '').split('#')[0];

/** Sends to a tab's content script and to extension pages in that tab (the PDF viewer). */
function deliverToTab(tabId: number, payload: unknown) {
  chrome.tabs.sendMessage(tabId, payload).catch(() => {});
  chrome.runtime.sendMessage({ target: 'tab', tabId, payload }).catch(() => {});
}

function isViewer(url?: string) {
  return !!url && [PDF_VIEWER, DOCS_VIEWER].some((v) => url.startsWith(chrome.runtime.getURL(v)));
}

/** Google Docs draws on a canvas: read its export in our reader, in a new tab next to the editor. */
async function openDoc(tab: chrome.tabs.Tab) {
  const p = new URLSearchParams({ doc: tab.url!, title: tab.title ?? '', autoplay: '1' });
  await chrome.tabs.create({ url: `${chrome.runtime.getURL(DOCS_VIEWER)}?${p}`, index: tab.index + 1, openerTabId: tab.id });
}

async function looksLikePdf(url: string): Promise<boolean> {
  if (!/^(https?|file):/.test(url)) return false;
  if (/\.pdf($|[?#])/i.test(url)) return true;
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return (r.headers.get('content-type') ?? '').includes('application/pdf');
  } catch {
    return false;
  }
}

async function openPdf(tabId: number | undefined, url: string) {
  const viewer = `${chrome.runtime.getURL(PDF_VIEWER)}?file=${encodeURIComponent(url)}&autoplay=1`;
  if (tabId == null) await chrome.tabs.create({ url: viewer });
  else await chrome.tabs.update(tabId, { url: viewer });
}

async function setReadingTab(tabId: number | null, url?: string) {
  await chrome.storage.session.set({ reading: tabId == null ? null : { tabId, url: stripHash(url) } });
}

async function readingTab(): Promise<{ tabId: number; url: string } | null> {
  return ((await chrome.storage.session.get('reading')).reading as { tabId: number; url: string } | null) ?? null;
}

const handlers: Record<string, (msg: any, sender: chrome.runtime.MessageSender) => Promise<unknown>> = {
  // From the content script: start reading these segments.
  async read(msg, sender) {
    const tabId = sender.tab?.id;
    if (tabId == null) throw new Error('read must come from a tab');
    await setReadingTab(tabId, sender.tab?.url);
    return toHost({ type: 'read', tabId, segments: msg.segments, startAt: msg.startAt, title: msg.title, settings: await loadSettings() });
  },
  // From the content script: text the page loaded while being read.
  async append(msg, sender) {
    const tabId = sender.tab?.id;
    if (tabId == null) throw new Error('append must come from a tab');
    return toHost({ type: 'append', tabId, segments: msg.segments });
  },
  // From popup / shortcuts: ask a tab to extract its text and start reading.
  async extract(msg) {
    const tabId: number = msg.tabId ?? (await activeTabId());
    const tab = await chrome.tabs.get(tabId);
    const cmd = { type: 'extract', mode: msg.mode };
    if (isViewer(tab.url)) return chrome.runtime.sendMessage({ target: 'tab', tabId, payload: cmd });
    if (parseDocUrl(tab.url)) {
      await openDoc(tab);
      return { ok: true, docs: true };
    }
    if (tab.url && /\.pdf($|[?#])/i.test(tab.url) && (await looksLikePdf(tab.url))) {
      await openPdf(tabId, tab.url);
      return { ok: true, pdf: true };
    }
    try {
      return await withTimeout(sendToTab(tabId, cmd), EXTRACT_TIMEOUT_MS, "the page didn't respond. Reload it and try again.");
    } catch (e) {
      // Chrome's built-in PDF viewer can't be scripted: reopen the PDF in ours.
      if (tab.url && (await looksLikePdf(tab.url))) {
        await openPdf(tabId, tab.url);
        return { ok: true, pdf: true };
      }
      throw e;
    }
  },
  async toTab(msg) {
    if (msg.payload.type === 'ended' || msg.payload.type === 'stopped') {
      if ((await readingTab())?.tabId === msg.tabId) await setReadingTab(null);
    }
    deliverToTab(msg.tabId, msg.payload);
  },
  // Player controls and diagnostics: pass through to the host.
  async host(msg) {
    const cmd = msg.payload as HostCommand;
    if (cmd.type === 'speakSample' || cmd.type === 'warmup') (cmd as any).settings = await loadSettings();
    if (cmd.type === 'status' || cmd.type === 'toggle' || cmd.type === 'next' || cmd.type === 'prev' || cmd.type === 'stop') {
      return (await toHostIfRunning(cmd)) ?? { active: false };
    }
    return toHost(cmd);
  },
  // The audio host can't use chrome.storage (offscreen document): it reads and saves the
  // per-computer "GPU too slow" flag through these.
  async machineState() {
    return chrome.storage.local.get(MACHINE_KEYS);
  },
  async saveMachine(msg) {
    // Only the speed flags may be written from the host.
    const patch = Object.fromEntries(Object.entries(msg.patch ?? {}).filter(([k]) => k === 'gpuSlow' || k === 'stSlow'));
    await chrome.storage.local.set(patch);
  },
  async hostInfo() {
    return { offscreenApi: !!chrome.offscreen?.createDocument, host: await ensureHost() };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'sw') return;
  const fn = handlers[msg.type];
  if (!fn) return;
  fn(msg, sender).then(
    (r) => sendResponse(r ?? { ok: true }),
    (e) => sendResponse({ error: String(e?.message ?? e) }),
  );
  return true;
});

// Settings changed in the popup or floating player: apply to the running session.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'sync' && changes.settings) toHostIfRunning({ type: 'settings', settings: await loadSettings() });
  if (area === 'local' && MACHINE_KEYS.some((k) => changes[k])) {
    toHostIfRunning({ type: 'machine', ...((await chrome.storage.local.get(MACHINE_KEYS)) as object) } as HostCommand);
  }
});

// Stop when the reading tab closes or navigates to another page.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if ((await readingTab())?.tabId === tabId) {
    await setReadingTab(null);
    toHostIfRunning({ type: 'stop' });
  }
});
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url) return;
  const r = await readingTab();
  if (r?.tabId === tabId && stripHash(info.url) !== r.url) {
    await setReadingTab(null);
    toHostIfRunning({ type: 'stop' });
  }
});

chrome.commands.onCommand.addListener((command) => {
  const run = (p: Promise<unknown>) => p.catch((e) => console.warn(command, e));
  // The shortcut reads the selection when there is one, else the page.
  if (command === 'read-page') run(handlers.extract({ mode: 'auto' }, {}));
  if (command === 'toggle-pause') run(toHostIfRunning({ type: 'toggle' }));
  if (command === 'next-sentence') run(toHostIfRunning({ type: 'next' }));
  if (command === 'prev-sentence') run(toHostIfRunning({ type: 'prev' }));
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'read-selection', title: 'Read selection aloud', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'read-page', title: 'Read this page aloud', contexts: ['page'] });
    chrome.contextMenus.create({
      id: 'read-pdf-link',
      title: 'Read PDF aloud',
      contexts: ['link'],
      targetUrlPatterns: ['*://*/*.pdf', '*://*/*.pdf?*', '*://*/*.PDF', 'file:///*.pdf'],
    });
  });
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'read-pdf-link' && info.linkUrl) {
    openPdf(undefined, info.linkUrl).catch(console.warn);
    return;
  }
  if (tab?.id == null) return;
  const mode = info.menuItemId === 'read-selection' ? 'selection' : 'page';
  handlers.extract({ mode, tabId: tab.id }, {}).catch(console.warn);
});
