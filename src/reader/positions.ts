// Remembers where the user stopped reading each page (local only; trimmed to the most recent pages).
const KEY = 'positions';
const MAX_PAGES = 300;

interface Position {
  sid: number;
  total: number;
  at: number;
}

type Positions = Record<string, Position>;

async function all(): Promise<Positions> {
  return ((await chrome.storage.local.get(KEY))[KEY] as Positions | undefined) ?? {};
}

export async function loadPosition(key: string): Promise<Position | null> {
  return (await all())[key] ?? null;
}

export async function savePosition(key: string, sid: number, total: number) {
  const map = await all();
  map[key] = { sid, total, at: Date.now() };
  const keys = Object.keys(map);
  if (keys.length > MAX_PAGES) {
    keys.sort((a, b) => map[a].at - map[b].at).slice(0, keys.length - MAX_PAGES).forEach((k) => delete map[k]);
  }
  await chrome.storage.local.set({ [KEY]: map });
}

export async function clearPosition(key: string) {
  const map = await all();
  if (!(key in map)) return;
  delete map[key];
  await chrome.storage.local.set({ [KEY]: map });
}

/** Page identity for resume: URL without the fragment. */
export function pageKey(url = location.href): string {
  return url.split('#')[0];
}
