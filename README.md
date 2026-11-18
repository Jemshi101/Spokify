# TTS Reader

Chrome/Opera extension (MV3) that reads web pages aloud with natural voices that run **locally** (Kokoro-82M via kokoro-js, WebGPU). Read-along sentence + word highlighting, background play, no servers or API keys.

## Develop

```sh
npm install
npm run build          # or: npm run watch
npm run typecheck
npm test               # unit tests (alignment, phonemizer, text splitting)
npm run e2e            # end-to-end in Chrome for Testing (needs a build)
node tools/try-sites.mjs <url>...   # what would be read on real pages
npm run icons          # re-render icons from tools/icon.svg
```

Load `dist/` as an unpacked extension: `chrome://extensions` (or `opera://extensions`) → Developer mode → Load unpacked.

## Use

- Popup **Read page** / **Read selection**, right-click menu, or **Alt+Shift+R**
- **Alt+click** any paragraph to start reading from there
- **Alt+Shift+P** pause/resume · **Alt+Shift+.** / **Alt+Shift+,** next/previous sentence
- Floating player: previous / play-pause / next, speed (click to cycle), stop; media keys work too
- PDFs: press Read on a PDF tab, or right-click a PDF link → **Read PDF aloud** (opens the built-in viewer)
- Reading a page again resumes where you stopped (the player offers **Restart**)

First use downloads the voice model (~165 MB, cached afterwards); the welcome page does this with a progress bar.
Without WebGPU, **Auto** uses the browser's built-in voices (lite mode).

## Architecture

| Path | Role |
|---|---|
| `src/background/sw.ts` | Service worker: starts the audio host (offscreen document; pinned tab where `chrome.offscreen` is missing), relays messages, menus, shortcuts, stops on tab close/navigation |
| `src/host/host.ts` | Audio host: Kokoro path (worker RPC, 3-sentence lookahead, `<audio>` with pitch-preserving rate) and lite path (`speechSynthesis` + boundary events); media session |
| `src/engine/worker.ts` | Kokoro (timestamped ONNX export). WebGPU fp16 by default, CPU fallback |
| `src/engine/phonemize.ts` | Text normalization + espeak phonemization (ported from kokoro-js so we control it) |
| `src/engine/align.ts` | Edit-distance alignment of per-word phonemes to the sentence → exact per-word start times from the model's `durations` |
| `src/reader/extract.ts` | Readability-style article detection on the live DOM, paragraph/sentence/word segmentation with DOM ranges |
| `src/reader/reader.ts`, `player.ts`, `positions.ts` | Shared read-along UI: CSS Custom Highlight API, auto-scroll (backs off while you scroll), floating player, resume positions |
| `src/content/index.ts` | Content script: the reader on web pages |
| `src/pdf/viewer.ts` | PDF viewer (pdf.js canvas + text layer, line/paragraph/column breaks from geometry) using the same reader |
| `src/welcome/welcome.ts`, `src/popup/popup.ts`, `src/diag/diag.ts` | Welcome page, toolbar popup, diagnostics |

Speed: Kokoro renders up to 1.5× itself; faster speeds use pitch-preserving playback rate on top, so changes apply instantly.
