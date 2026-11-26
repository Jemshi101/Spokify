# Spokify

Chrome/Opera/Edge extension (MV3) that reads web pages aloud with natural voices that run **locally**: Kokoro-82M (via kokoro-js, WebGPU) on capable graphics, Supertonic 2 or Piper voices on the CPU everywhere else. Read-along sentence + word highlighting, background play, no servers or API keys.

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

Load `dist/` as an unpacked extension: `chrome://extensions` (or `opera://extensions`, `edge://extensions`) → Developer mode → Load unpacked.

The manifest pins the extension id (`llacpmmoocpaoaijceajaknlbdedennp`) with a public `key`, so every build and folder is the same extension. To update without re-downloading voices, replace the folder's files (or load the new folder) and press reload in the extensions page; **removing** the extension deletes its downloaded voices (browser policy). The private key is in `.keys/` (git-ignored) and is only needed to pack a `.crx`.

## Use

- Popup **Read page** / **Read selection**, right-click menu, or **Alt+Shift+R** (reads the selection if there is one)
- Select text: a **Read** button appears next to it
- **Alt+click** any paragraph to start reading from there, or, while reading, hover a sentence and click the play button next to it
- **Alt+Shift+P** pause/resume · **Alt+Shift+.** / **Alt+Shift+,** next/previous sentence
- Floating player: previous / play-pause / next, jump to highlight (when it is off-screen), voice, speed (click to cycle), stop; media keys work too
- PDFs: press Read on a PDF tab, or right-click a PDF link → **Read PDF aloud** (opens the built-in viewer)
- Google Docs: press Read on a Docs tab; the document opens in Spokify's Docs reader in a new tab (Docs draws on a canvas, so it is read from its export with your Google sign-in)
- Reading a page again resumes where you stopped (the player offers **Restart**)

First use downloads the voice (Kokoro ~330 MB, or a Piper voice ~63 MB; cached afterwards); the welcome page does this with a progress bar.

**Auto** picks the engine: Kokoro on WebGPU when the graphics keep up (it times them when the voice loads; below 1.3× real time counts as too slow), otherwise **Supertonic 2** on the CPU (~8× real time on an M1, ~263 MB), otherwise **Piper** (~10–15× real time, ~63 MB per voice). If natural voices fail entirely (e.g. offline before a download), it falls back to the browser's built-in voices (lite mode). Choosing Auto again in the popup re-tests the graphics.

Supertonic 2 downloads from [supertone-oss-archive/supertonic-2](https://huggingface.co/supertone-oss-archive/supertonic-2) (pinned revision; model OpenRAIL-M, pipeline ported from Supertone's MIT example; the project is archived). Supertonic 3 was measured too slow on CPU (1.3×). Piper voices download from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices); each voice has its own license (see its `MODEL_CARD`). Piper doesn't report word timings, so its word highlighting is estimated from the phoneme alignment (close, not exact like Kokoro's).

## Architecture

| Path | Role |
|---|---|
| `src/background/sw.ts` | Service worker: starts the audio host (offscreen document; pinned tab where `chrome.offscreen` is missing), relays messages, menus, shortcuts, stops on tab close/navigation |
| `src/host/host.ts` | Audio host: Kokoro path (worker RPC, 3-sentence lookahead, `<audio>` with pitch-preserving rate) and lite path (`speechSynthesis` + boundary events); media session |
| `src/engine/worker.ts` | Kokoro (timestamped ONNX export, WebGPU fp32; fp16, q4f16 and uint8 garble the voice) or Piper; one model in memory, one request at a time; times the engine on load |
| `src/engine/supertonic.ts` | Supertonic 2: cached download, text preprocessing, 4-model flow-matching pipeline on ONNX Runtime (WASM) |
| `src/engine/lead.ts` | Adds a short silence before each clip's first sound, so audio devices don't cut it off |
| `src/reader/selectionButton.ts` | The Read button next to selected text |
| `src/reader/hoverPlay.ts` | The play button next to a hovered sentence while reading |
| `src/engine/piper.ts` | Piper voices: cached download, espeak phonemes → ids, ONNX Runtime (WASM), estimated word times |
| `src/engine/phonemize.ts` | Text normalization + espeak phonemization (ported from kokoro-js so we control it) |
| `src/engine/align.ts` | Edit-distance alignment of per-word phonemes to the sentence → exact per-word start times from the model's `durations` |
| `src/reader/extract.ts` | Readability-style article detection on the live DOM, paragraph/sentence/word segmentation with DOM ranges |
| `src/reader/reader.ts`, `player.ts`, `positions.ts` | Shared read-along UI: CSS Custom Highlight API, auto-scroll (backs off while you scroll), floating player, resume positions |
| `src/content/index.ts` | Content script: the reader on web pages |
| `src/pdf/viewer.ts` | PDF viewer (pdf.js canvas + text layer, line/paragraph/column breaks from geometry, sentences joined across page breaks, running headers/page numbers skipped) using the same reader |
| `src/docs/viewer.ts`, `gdoc.ts` | Google Docs reader: renders the document's HTML export (styles scoped, comments and footnote markers removed, images via the extension) using the same reader |
| `src/welcome/welcome.ts`, `src/popup/popup.ts`, `src/diag/diag.ts` | Welcome page, toolbar popup, diagnostics |

Speed: Kokoro renders up to 1.5× itself; faster speeds use pitch-preserving playback rate on top, so changes apply instantly.
