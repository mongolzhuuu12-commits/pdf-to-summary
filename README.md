# Book Summarizer

Upload a PDF book (up to 10 MB) and get a clear 3–5 paragraph summary. Download it as
`.txt` or `.md`, copy it, or send it by email. Works on desktop and phones.

This is a prototype for user testing.

## How it works

The PDF is read **in the visitor's browser** with [pdf.js](https://mozilla.github.io/pdf.js/).
It is never uploaded. From the extracted text the page produces one of two summaries:

| | Quick summary | AI summary |
|---|---|---|
| Runs | In the browser | On the Node server, via the Claude API |
| Needs | Nothing (works on any static host) | `npm start` with `ANTHROPIC_API_KEY` set |
| Output | The most representative sentences from each fifth of the book, quoted verbatim. 3–5 paragraphs. | Written prose: plot overview, characters and how they change, themes (fiction); thesis, arguments, takeaways (non-fiction). Professional tone, 3–5 paragraphs, in the book's language. |
| Privacy | Nothing leaves the device | Only the extracted text is sent (to the server, then to the Claude API); nothing is stored |
| Limits | Quotes the book rather than interpreting it, so no character or theme analysis | Costs money per book |

The page asks the server (`GET /api/config`) whether AI summaries are available. If there is
no server, as on a static host, it uses the quick summary. The page labels which kind the
visitor got, and the privacy note in the footer changes to match.

## Run it locally

```bash
npm install
npm start            # builds the site, then serves http://localhost:3000
```

Requires Node 22.9 or newer. For AI summaries, add an API key first:

```bash
cp .env.example .env     # then set ANTHROPIC_API_KEY
npm start
```

## Deploy

### Static (quick summaries only): Netlify or any static host

`npm run build` writes the complete site to `dist/`. `netlify.toml` builds and publishes it,
and sets the same security headers as the Node server. No functions or keys are needed, and
nothing a visitor does costs you money.

### With AI summaries

Run `server.js` on any Node host (Render, Fly.io, Railway, a VPS) with `ANTHROPIC_API_KEY`
set. Serverless functions are a poor fit: AI summaries of a whole book often take longer than
a minute, which exceeds typical function time limits (Netlify's is 60 seconds).

**Before exposing AI summaries publicly, add rate limiting and authentication.** Every
summary costs money, and the endpoint has neither yet.

### How the AI path works

- A book that fits (up to ~1.2M characters, i.e. most novels) is sent in **one request**, so
  the model sees the whole text.
- A longer book is split into ~400K-character sections. Each is turned into notes (up to 4 in
  parallel), and the notes are summarized together. If one section fails, the remaining
  section requests are cancelled so you don't pay for them.
- Default model is `claude-opus-5-5`; set `SUMMARY_MODEL` to use a cheaper one.
- Safety-classifier refusals are retried server-side on another model (`fallbacks: "default"`);
  if the whole chain declines, the user sees a plain message.
- Book text is wrapped in tags and the model is told to treat it as data, so instructions
  hidden inside a PDF are not followed.

## Configuration (Node server)

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Enables AI summaries |
| `SUMMARIZER` | `auto` | `auto`, `ai` (require a key) or `extractive` (never call the API) |
| `SUMMARY_MODEL` | `claude-opus-5-5` | Model for AI summaries |
| `SUMMARY_EFFORT` | `medium` | `low`, `medium`, `high`, `xhigh`, `max` |
| `PORT` | `3000` | HTTP port |

## What happens to a PDF

1. The browser rejects anything over 10 MB or that does not start with `%PDF-`.
2. pdf.js extracts the text page by page, with a progress bar.
3. The text is cleaned: running headers/footers and page numbers are dropped, words hyphenated
   across lines are repaired, and ligatures are expanded.
4. The summary is produced in the browser, or by the server in AI mode.

Clear messages are shown for: wrong file type, over 10 MB, password-protected PDFs, damaged
files, and PDFs with no text layer (scans).

The site ships pdf.js's *legacy* build, which polyfills very new JavaScript that the standard
build calls directly, so it works in older Safari, Chrome and Firefox too.

## API (Node server)

`GET /api/config` → `{ "maxFileBytes": 10485760, "mode": "ai" | "browser" }`

`POST /api/summarize-text` with JSON `{ "title": "…", "text": "…" }` →
`{ "mode": "ai", "paragraphs": ["…", "…", "…"] }`. It returns 404 when AI summaries are off.

Errors are `{ "error": "message safe to show users" }` with status 400, 404, 413, 422, 500,
502 or 503.

## Sharing

- **Download** and **Copy** are generated in the browser.
- **Email** opens the visitor's own mail app through a `mailto:` link containing the full
  summary. Mail clients limit link length (Outlook on Windows is the strictest), so a very
  long summary is shortened with a note pointing to the download. There is intentionally no
  server-side "send to any address" endpoint: it would be an open mail relay.

## Project layout

```
public/    page, styles and browser-only code
shared/    code used by both the browser and Node: PDF reading, text cleanup, quick summary
src/       Node server and the Claude summarizer
scripts/   build script (assembles dist/)
test/      node --test suites
```

## Tests

```bash
npm test
```

Covers text cleanup, PDF reading with pdf.js (including password-protected, damaged and
scanned files), the quick summary, the Claude request shapes (using a fake client), the
server API, and the browser-side helpers.

## Known limitations and next steps

- **The AI path has been tested against a fake client, not the live API.** Request shapes,
  chunking, ordering, refusals and error mapping are covered, but run one real book through it
  before relying on it.
- **No OCR.** Scanned books are rejected with an explanation.
- **Very large books** are read and summarized on the visitor's device. On an older phone a
  10 MB book can take a while.
- The quick summary's stop-word list is English; other languages work through a
  frequency-based filter but less precisely.
- Words broken across lines that were really hyphenated compounds ("well-\nknown") are joined.
