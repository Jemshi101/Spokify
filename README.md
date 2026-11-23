# Spokify

Chrome/Opera extension (MV3) that reads web pages aloud with natural voices that run **locally** (Kokoro-82M via kokoro-js, WebGPU). Read-along sentence + word highlighting, background play, no servers or API keys.

## Develop

```sh
npm install
npm run build          # or: npm run watch
npm run typecheck
npm test               # unit tests (alignment, phonemizer, text splitting)
npm run e2e            # end-to-end in Chrome for Testing (needs a build)
node tools/try-sites.mjs <url>...   # what would be read on real pages (GREP=regex to show matches)
node tools/quality-probe.mjs        # GPU vs CPU voice similarity by sentence length
OUT=<dir> node tools/engine-probe.mjs [chrome|opera]   # audio stats per engine
npm run icons          # re-render icons from tools/icon.svg
```

Load `dist/` as an unpacked extension: `chrome://extensions` (or `opera://extensions`) → Developer mode → Load unpacked.

## Use

- Popup **Read page** / **Read selection**, right-click menu, or **Alt+Shift+R**
- **Alt+click** any paragraph to start reading from there
- **Alt+Shift+P** pause/resume · **Alt+Shift+.** / **Alt+Shift+,** next/previous sentence
- Floating player: previous / play-pause / next, speed (click to cycle), stop; media keys work too
- PDFs: press Read on a PDF tab, or right-click a PDF link → **Read PDF aloud** (opens the built-in viewer)
- Google Docs: press Read on a Docs tab; the document opens in Spokify's Docs reader in a new tab (Docs draws on a canvas, so it is read from its export with your Google sign-in)
- Reading a page again resumes where you stopped (the player offers **Restart**)

First use downloads the voice model (~330 MB, cached afterwards); the welcome page does this with a progress bar.
Without WebGPU, **Auto** uses the browser's built-in voices (lite mode). Auto also times the GPU when the voice loads: below 1.3× real time (weak integrated graphics) it switches to lite mode and says so in the popup; choosing Auto again re-tests.

## Architecture

| Path | Role |
|---|---|
| `src/background/sw.ts` | Service worker: starts the audio host (offscreen document; pinned tab where `chrome.offscreen` is missing), relays messages, menus, shortcuts, stops on tab close/navigation |
| `src/host/host.ts` | Audio host: Kokoro path (worker RPC, 3-sentence lookahead, `<audio>` with pitch-preserving rate) and lite path (`speechSynthesis` + boundary events); media session |
| `src/engine/worker.ts` | Kokoro (timestamped ONNX export). WebGPU fp32 by default (fp16, q4f16 and uint8 garble the voice), CPU fallback; one request at a time; times the GPU on load |
| `src/engine/phonemize.ts` | Text normalization + espeak phonemization (ported from kokoro-js so we control it) |
| `src/engine/align.ts` | Edit-distance alignment of per-word phonemes to the sentence → exact per-word start times from the model's `durations` |
| `src/reader/extract.ts` | Readability-style article detection on the live DOM, paragraph/sentence/word segmentation with DOM ranges |
| `src/reader/reader.ts`, `player.ts`, `positions.ts` | Shared read-along UI: CSS Custom Highlight API, auto-scroll (backs off while you scroll), floating player, resume positions |
| `src/content/index.ts` | Content script: the reader on web pages |
| `src/pdf/viewer.ts` | PDF viewer (pdf.js canvas + text layer, line/paragraph/column breaks from geometry, sentences joined across page breaks, running headers/page numbers skipped) using the same reader |
| `src/docs/viewer.ts`, `gdoc.ts` | Google Docs reader: renders the document's HTML export (styles scoped, comments and footnote markers removed, images via the extension) using the same reader |
| `src/welcome/welcome.ts`, `src/popup/popup.ts`, `src/diag/diag.ts` | Welcome page, toolbar popup, diagnostics |

Speed: Kokoro renders up to 1.5× itself; faster speeds use pitch-preserving playback rate on top, so changes apply instantly.
