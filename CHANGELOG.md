# Changelog

## 0.9.0

- **Pages that load as you scroll** (e.g. Rise lessons): Spokify kept reading only what was on the page when you pressed play. Near the end it now checks for text the page has loaded since and carries on without a pause. At the very end it scrolls down a little to let the page load more, and continues if anything appears.
- **Expandable sections are read**: collapsed sections ("Click + to expand") are read in order, title first, and expanded as reading gets there. Works with sections built the standard accessible way. Hidden text without a matching expand button is still skipped.

## 0.8.0

- **Carousels are read too**: step-by-step boxes and slide carousels (e.g. "Click the arrows to learn more" in Rise lessons) are read slide by slide. Spokify moves the carousel to each slide as it gets there, so you can follow the highlight. Works with carousels built the standard accessible way.
- The word highlight could sit one letter early (" comprehensiv" instead of "comprehensive") after a double space in the page's text. Positions now stay exact however the page's spacing looks.

## 0.7.0

- **Tabs are read too**: on pages with tabs (e-learning lessons such as Google Cloud Skills courses, docs sites), Spokify reads every tab in order, saying the tab's name first, and switches to each closed tab as it gets there, so you can see and follow the highlighted text. It works with any site that marks its tabs up the standard (accessible) way. Closed accordions are still skipped.

## 0.6.1

- E-learning lessons with tabs (Articulate Rise, e.g. Google Cloud Skills courses): Spokify read only the open tab and skipped the introduction, headings and other blocks around it. The tab's text sits deeper in the page than Spokify looked, so it now looks further up and reads the whole lesson.
- Screen-reader-only text ("(opens in a new tab)" after links, hidden carousel counters) is no longer read. It used to break sentences in two.

## 0.6.0

- **Read from here while listening**: while Spokify is reading a page, hover any sentence and a small play button appears in the margin next to it. Click it to continue reading from that sentence. Hovering the button underlines the sentence it will start from. It works on web pages, PDFs and Google Docs, and you can turn it off in the popup.

## 0.5.0

- **Supertonic voices** (Supertone's Supertonic 2): natural voices that run on the processor, closer to Kokoro than Piper. One ~263 MB download, 10 voices (5 female, 5 male), ~8× faster than real time on an M1. **Auto** now goes Kokoro (fast graphics) → Supertonic (fast processor) → Piper; each step is timed when the voice loads, and the popup says why it stepped down. Choosing Auto again re-tests.
- **Read a selection in one click**: select text and a small **Read** button appears next to it; it reads just that. Works on web pages, PDFs and Google Docs. Turn it off in the popup. **Alt+Shift+R** now reads the selection when text is selected (otherwise the page).

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
