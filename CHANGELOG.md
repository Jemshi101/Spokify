# Changelog

## 0.4.2

- E-learning and app-like pages (e.g. Google Cloud Skills courses built with Articulate Rise): Spokify read only text hidden in a closed accordion, so nothing on screen was highlighted. Hidden text no longer decides what the article is, the whole lesson is read (headings included), and the page title isn't read twice.
- Auto-scroll and the jump-to-highlight button work on pages that scroll inside a panel rather than the window.

## 0.4.1

- Sentences ending in a single capital letter end there: "World War I. The war ended" was read as one sentence. A letter followed by a period now ends the sentence when the next word usually starts one (The, It, He…), or when it's a Roman numeral after a numbered word (War, Chapter, Part, Act…). Initials stay joined ("John F. Kennedy", "J. R. R. Tolkien").

## 0.4.0

- **Piper voices**: natural-sounding voices that run on the processor (~63 MB each, 10–15× faster than real time on an M1). 14 English voices (US and UK). **Auto** now uses Kokoro when the graphics keep up and Piper otherwise, so computers with weak graphics (e.g. Intel UHD) get natural voices instead of the robotic system ones. System voices are the last resort when natural voices fail entirely (e.g. offline before the download).
- Voice lists for Piper in the popup, the player and the welcome page; the popup shows which engine and voice are speaking.
- If WebGPU fails to start, Spokify falls back to Piper instead of the slow CPU build of Kokoro.
- Pages made of repeated entries (GitHub releases, blog indexes, forum threads) are read from the first entry; before, only the longest entry was read (on a releases page, often an old version).
- Collapsed sections (closed `<details>`) aren't read.
- **Fixed extension id** (`llacpmmoocpaoaijceajaknlbdedennp`): loading a new version's folder, or replacing the files and pressing reload, keeps the downloaded voices. (Removing the extension still deletes them; that's browser policy.) This version itself has a new id, so its voices download once more.

## 0.3.2

- Player: a **jump to highlight** button (amber target) appears while the sentence being read is off-screen; it scrolls back to it and turns auto-scroll back on.
- Player: a **voice** button opens the voice list. It shows the natural voices, or the system voices when Lite mode is speaking. The new voice takes over from the next sentence.

## 0.3.1

- Lite mode: the chosen system voice is used. On Windows the voice list can load late, especially in the hidden audio page, and Spokify silently fell back to the default voice (Microsoft David). It now waits up to 5 seconds for the list and matches voices by name as well as id.
- The popup shows the voice actually speaking ("Lite · Microsoft Zira"), and Diagnostics lists the voices the audio page can use.
- Microsoft's "Online (Natural)" voices (Aria, Jenny, Guy… available in Microsoft Edge) are listed first and preferred by default; local voices next, then network voices.

## 0.3.0

- Google Docs: press Read on a Docs tab. The document opens in a Spokify reader tab next to it (Docs draws its editor on a canvas, which extensions can't read), with its own formatting, highlighting, the player and resume. Comments and footnote markers aren't read. Clear messages when you're signed out, can't open the document, or the owner turned off downloading.
- Weak graphics (e.g. Intel UHD integrated GPUs): Auto now times the GPU when the voice loads. If it can't keep up (below 1.3× real time) Spokify frees the GPU model and uses Lite voices, and the popup explains why. Pick a Natural engine to force it; choose Auto again to re-test.
- Lighter GPU work: text is spoken in shorter pieces (160 characters, split at commas), and the engine runs one request at a time. Long GPU jobs on weak GPUs could make Windows reset the graphics driver and close other apps.
- PDFs: sentences that continue on the next page are read as one sentence; page numbers and running headers/footers are skipped.
- Read no longer waits forever on a page that doesn't respond: it reports it after 15 seconds.

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
