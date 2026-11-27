# Store listing: Chrome Web Store and Opera add-ons

Everything to paste into the two dashboards. Build the upload with `npm run package` and the images with `npm run store-images`.

| | Chrome Web Store | Opera add-ons |
|---|---|---|
| Dashboard | <https://chrome.google.com/webstore/devconsole> (one-time US$5 developer fee) | <https://addons.opera.com/developer/> (free) |
| Upload | `release/spokify-X.Y.Z-store.zip` | same zip, plus `release/spokify-X.Y.Z-source.zip` as the source code |
| Category | Make Chrome Yours → **Accessibility** | **Accessibility** |
| Language | English | English |
| Icon | in the zip (128 px); store icon `static/icons/128.png` | same |
| Screenshots | `store/images/screenshot-*.png` (1280×800, 1–5) | same files (Opera accepts 1280×800) |
| Small promo tile | `store/images/promo-small-440x280.png` | — |
| Marquee | `store/images/promo-marquee-1400x560.png` (optional) | — |
| Privacy policy URL | <https://github.com/Jemshi101/Spokify/blob/main/PRIVACY.md> | same |
| Homepage / support | <https://github.com/Jemshi101/Spokify> · issues: <https://github.com/Jemshi101/Spokify/issues> | same |

## Name

Spokify

## Short description (manifest, 132 chars max)

Reads web pages, PDFs and Google Docs aloud with natural voices that run on your computer. Read-along highlighting, no account.

## Detailed description

```
Spokify reads web pages, PDFs and Google Docs aloud with natural, human-sounding voices that run entirely on your computer. No account, no subscription, no servers: the text you listen to never leaves your browser.

READ ANYTHING
• Articles and blogs: Spokify finds the article and skips menus, ads and sidebars
• PDFs, in its own viewer, with columns, page breaks and running headers handled
• Google Docs, in a clean reader view
• Selected text: select, then press the Read button that appears
• Collapsed sections, carousels, flip cards and lazy-loaded text are read too

FOLLOW ALONG
• The sentence and the word being spoken are highlighted as you listen
• The page scrolls with the voice, and stops following while you scroll yourself
• Alt+click any paragraph to start reading from there
• Picks up where you stopped the next time you open a page

NATURAL VOICES, ON YOUR COMPUTER
• Kokoro voices on graphics cards that can keep up; Supertonic and Piper voices on any computer
• Spokify tests your computer and picks the best voice engine automatically
• Voices download once (about 60–330 MB) and work offline afterwards
• Falls back to your browser's built-in voices if needed

LISTEN YOUR WAY
• Speeds from slow to 3×, without chipmunk voices
• Keeps playing in the background while you use other tabs
• Floating player, media keys and keyboard shortcuts (Alt+Shift+R to read, Alt+Shift+P to pause, Alt+Shift+. and Alt+Shift+, to skip sentences)

AI SUMMARIES
• Summarize a page or a selection with the AI built into your browser (Chrome or Edge 138 or later, or Opera with Web AI turned on), then have the summary read aloud
• The summary is made on your computer too

PRIVATE BY DESIGN
Spokify has no servers, no analytics and no tracking. Pages are processed locally; the only downloads are the voice files themselves.

Open source: https://github.com/Jemshi101/Spokify
```

## Single purpose (Chrome Web Store → Privacy practices)

```
Spokify reads the text of web pages, PDFs and Google Docs aloud with on-device text-to-speech, highlighting each sentence and word as it is spoken. Its optional summaries serve the same purpose: they condense the page into text that can be read aloud.
```

## Permission justifications (Chrome Web Store → Privacy practices)

**offscreen**
```
Speech is generated and played in an offscreen document so audio keeps playing when the popup closes and while the user switches tabs. The service worker cannot play audio or run the speech model itself.
```

**storage**
```
Stores the user's settings (voice, speed, buttons), the position where reading stopped on recent pages so it can resume, and whether this computer's graphics are fast enough for the GPU voice. Nothing is sent off the device.
```

**contextMenus**
```
Adds right-click items: "Read this page aloud", "Read selection aloud", "Read PDF aloud" for PDF links, and "Summarize this page" / "Summarize selection".
```

**activeTab**
```
Lets the toolbar button, keyboard shortcuts and context menu act on the current tab when the user invokes Spokify, including pages where the content script was not yet injected.
```

**scripting**
```
Injects the reader into tabs that were open before Spokify was installed or updated, so the user can read them without reloading.
```

**tabs**
```
Identifies which tab is being read, stops reading when that tab closes or navigates, follows reading across the user's tabs, and opens PDFs and Google Docs in Spokify's built-in reader next to the original tab. Tab URLs are only used to detect PDFs and Google Docs and as keys for resume positions stored locally.
```

**Host permission (<all_urls>) and content script**
```
Spokify is a text-to-speech reader for any website the user chooses to listen to. The content script finds the article text on the page, highlights the sentence and word being spoken, shows the floating player and the "Read" button next to selected text, and supports Alt+click to start from a paragraph. Host access is also used to open PDFs from any site in the built-in PDF reader and to download a Google Doc's export (docs.google.com) for reading. Page content is processed locally and never transmitted.
```

**Remote code**
```
No, I am not using remote code.
```
(All JavaScript and WebAssembly ships in the package, including ONNX Runtime and pdf.js. The voice model files downloaded from huggingface.co are neural-network weights (data), not executable code.)

## Data usage (Chrome Web Store → Privacy practices)

Collected data: tick **none**. Spokify processes "Website content" on the device only and never transmits it, which under the Chrome Web Store definition is not collection.

Certify all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

## Notes for reviewers

Paste into Chrome's "Test instructions" / Opera's "Notes for moderators":

```
No account or sign-in needed. To test: open any article (e.g. https://en.wikipedia.org/wiki/Speech_synthesis), click the Spokify toolbar button and press "Read page". The first use downloads a voice model (60–330 MB) from huggingface.co with a progress bar on the welcome page; after that, reading starts in about a second. On computers without a fast GPU the CPU voices (Supertonic or Piper) are chosen automatically.

The package is built with esbuild from TypeScript and is not minified or obfuscated. Third-party code: kokoro-js and @huggingface/transformers (Apache-2.0, includes ONNX Runtime Web, MIT), pdf.js (Apache-2.0).
```

### Opera only: source code and build instructions

Opera's moderators rebuild bundled extensions. Upload `release/spokify-X.Y.Z-source.zip` and paste:

```
Requirements: Node.js 22 and npm.
  npm ci
  npm run build
The extension is built into dist/. Compare it with the uploaded package (the store package is dist/ with the manifest "key" field removed; npm run package makes it).
```

## Before submitting

- [ ] `npm test`, `npm run e2e` pass; manually tested in Chrome and Opera from the store zip (load `release/` unzipped)
- [ ] Version bumped in `package.json` and `static/manifest.json`, CHANGELOG updated, tagged and released on GitHub
- [ ] PRIVACY.md is on `main` (the policy URL must resolve before review)
- [ ] Screenshots reflect the current UI
