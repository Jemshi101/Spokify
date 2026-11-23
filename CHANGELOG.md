# Changelog

## Unreleased

- Renamed to Spokify.

## 0.2.0

- Lite mode: the browser's built-in voices for machines without WebGPU ("Auto" picks it automatically), with word highlighting from boundary events.
- PDFs: Read on a PDF tab (or right-click a PDF link → Read PDF aloud) opens a built-in pdf.js viewer with the same highlighting and player. Line, paragraph and two-column breaks are rebuilt from the page layout; page numbers are skipped.
- Media keys and OS media controls (play/pause/next/previous).
- Resume where you left off: each page remembers its position; the player offers "Restart".
- Welcome page on install: downloads the voice with progress, voice preview, shortcut list.
- Settings sync across browsers signed in to the same account.
- Articles stop before trailing "See also / References / External links" sections.

## 0.1.0

- MVP: local Kokoro voices (WebGPU), sentence and word read-along highlighting, background play, floating player, speeds up to 3×, shortcuts, context menu.
