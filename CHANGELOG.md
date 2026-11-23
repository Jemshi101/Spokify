# Changelog

## 0.2.1

- Fixed: the natural voice sounded robotic, sharp and unintelligible. The default engine (WebGPU fp16) produced garbled audio in every browser; the default is now WebGPU fp32 (~330 MB download). Saved fp16 choices switch to Auto, and the old fp16 model is removed from the cache.
- Tests: a new check compares the default voice with the CPU engine's rendering, so garbled output fails the build.

## 0.2.0

- Renamed to Spokify (was TTS Reader).
- Lite mode: the browser's built-in voices for machines without WebGPU ("Auto" picks it automatically), with word highlighting from boundary events.
- PDFs: Read on a PDF tab (or right-click a PDF link → Read PDF aloud) opens a built-in pdf.js viewer with the same highlighting and player. Line, paragraph and two-column breaks are rebuilt from the page layout; page numbers are skipped.
- Media keys and OS media controls (play/pause/next/previous).
- Resume where you left off: each page remembers its position; the player offers "Restart".
- Welcome page on install: downloads the voice with progress, voice preview, shortcut list.
- Settings sync across browsers signed in to the same account.
- Articles stop before trailing "See also / References / External links" sections.

## 0.1.0

- MVP: local Kokoro voices (WebGPU), sentence and word read-along highlighting, background play, floating player, speeds up to 3×, shortcuts, context menu.
