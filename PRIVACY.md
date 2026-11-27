# Spokify privacy policy

_Last updated: 27 November 2026_

Spokify reads web pages, PDFs and Google Docs aloud with voices that run on your own computer. It has no servers and no accounts. It doesn't collect, sell or share any personal data, and it contains no analytics or tracking.

## What Spokify reads

When you ask Spokify to read or summarize something, it reads the text of the current page (or the selection, PDF or Google Doc) inside your browser to turn it into speech or a summary. That text is processed on your computer and is never sent anywhere.

- **Voices** run locally (Kokoro, Supertonic or Piper on WebGPU or WebAssembly, or your browser's built-in voices).
- **AI summaries** use your browser's built-in on-device model (the Summarizer API, such as Gemini Nano in Chrome). Text isn't sent to Spokify or to any AI service by Spokify.
- **Google Docs**: to read a document, Spokify downloads its HTML export from `docs.google.com` with your existing Google sign-in, the same way your browser opens the document. The content stays on your computer.
- **PDFs**: Spokify opens the PDF from its address in its own viewer. To check whether a link is a PDF, it may request the link's headers.

## What Spokify downloads

The first time you use a natural voice, Spokify downloads the voice model files from Hugging Face (`huggingface.co`) and caches them in your browser. These are ordinary file downloads: Hugging Face sees the request (like any website does, including your IP address), but Spokify sends it no page content or personal information. See [Hugging Face's privacy policy](https://huggingface.co/privacy).

## What Spokify stores

All of this is stored in your browser's extension storage, never on a server:

- **Settings** (voice, speed, buttons, summary style). If browser sync is on, your browser syncs them between your own devices.
- **Reading positions**: the address of each of your last 300 read pages and the sentence you stopped at, so reading can resume. Stored only on this computer.
- **Performance notes** about this computer (whether its graphics are fast enough for a voice), to choose a voice engine.
- **Downloaded voice models** (cached files).

Removing Spokify deletes all of it.

## Permissions

- **Read and change data on all websites** (`<all_urls>`, content script, `scripting`, `activeTab`): to find the article text on the page you ask it to read, highlight sentences and words as they are spoken, and show the player and the Read button.
- **Tabs** (`tabs`): to know which tab is being read, follow reading across tabs, stop when a tab closes, and open PDFs and Google Docs in Spokify's reader.
- **Offscreen documents** (`offscreen`): to keep playing audio in the background when the popup is closed.
- **Storage** (`storage`): for the settings and reading positions above.
- **Context menus** (`contextMenus`): for the right-click "Read" and "Summarize" items.

## Children

Spokify isn't directed at children and collects no data from anyone.

## Changes

Changes to this policy are published in this file at <https://github.com/Jemshi101/Spokify/blob/main/PRIVACY.md> with a new date.

## Contact

Questions: open an issue at <https://github.com/Jemshi101/Spokify/issues>.
