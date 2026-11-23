// Test browsers reuse a profile so downloaded voice models stay cached between runs. But a reused
// profile also keeps the previously registered service worker script: loading a new build from disk
// doesn't replace it (pressing reload in chrome://extensions would). Clear only the script cache.
import { rmSync } from 'node:fs';
import path from 'node:path';

export function freshExtensionScripts(profileDir) {
  for (const d of ['ScriptCache', 'Database']) {
    rmSync(path.join(profileDir, 'Default', 'Service Worker', d), { recursive: true, force: true });
  }
  return profileDir;
}
