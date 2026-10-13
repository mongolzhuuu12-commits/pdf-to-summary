# Book Summarizer

Upload a PDF book (up to 10 MB) and get a clear 3–5 paragraph summary. Download it as
`.txt` or `.md`, copy it, or send it by email. Works on desktop and phones.

This is a prototype for user testing.

## Run it

```bash
npm install
npm start            # http://localhost:3000
```

Requires Node 22.9 or newer. With no configuration the app works immediately using a basic
**extractive** summarizer. For real, written summaries, add an API key:

```bash
cp .env.example .env     # then set ANTHROPIC_API_KEY
npm start
```

## Two kinds of summary

| | AI summary | Extractive summary |
|---|---|---|
| Needs | `ANTHROPIC_API_KEY` | nothing |
| Output | Written prose: plot overview, characters and how they change, themes (fiction); thesis, arguments, takeaways (non-fiction). Professional tone, 3–5 paragraphs, in the book's language. | The most representative sentences from each fifth of the book, quoted verbatim. 3–5 paragraphs. |
| Good for | The experience described in the brief | Trying the app offline, or a fallback |
| Limits | Costs money per book; the extracted text is sent to the Claude API | Cannot analyze characters or themes; it quotes the book rather than interpreting it |

The page tells the user which kind they received, and the privacy note in the footer changes
to match.

### How the AI path works

- A book that fits (up to ~1.2M characters, i.e. most novels) is sent in **one request**, so
  the model sees the whole text.
- A longer book is split into ~400K-character sections. Each is turned into notes (up to 4 in
  parallel), and the notes are summarized together.
- Default model is `claude-opus-5-5`; set `SUMMARY_MODEL` to use a cheaper one.
- Safety-classifier refusals are retried server-side on another model (`fallbacks: "default"`);
  if the whole chain declines, the user sees a plain message.
- Book text is wrapped in tags and the model is told to treat it as data, so instructions
  hidden inside a PDF are not followed.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Enables AI summaries |
| `SUMMARIZER` | `auto` | `auto`, `ai` (require a key) or `extractive` (never call the API) |
| `SUMMARY_MODEL` | `claude-opus-5-5` | Model for AI summaries |
| `SUMMARY_EFFORT` | `medium` | `low`, `medium`, `high`, `xhigh`, `max` |
| `PORT` | `3000` | HTTP port |

## What it does with a PDF

1. Rejects anything over 10 MB or that does not start with `%PDF-` (the file name and MIME
   type are not trusted).
2. Extracts text per page with [`unpdf`](https://github.com/unjs/unpdf) (pdf.js).
3. Cleans it: drops running headers/footers and page numbers, repairs words hyphenated across
   lines, expands ligatures.
4. Summarizes, then returns JSON. **Nothing is written to disk**; the upload lives in memory
   for the length of the request.

Clear errors are shown for: wrong file type, over 10 MB, password-protected PDFs, damaged
files, and PDFs with no text layer (scans).

## API

`GET /api/config` → `{ "maxFileBytes": 10485760, "mode": "ai" | "extractive" }`

`POST /api/summarize` with multipart field `file` →

```json
{ "title": "…", "pages": 312, "words": 98000, "mode": "ai", "paragraphs": ["…", "…", "…"] }
```

Errors are `{ "error": "message safe to show users" }` with status 400, 413, 415, 422, 500, 502
or 503.

## Sharing

- **Download** and **Copy** are generated in the browser.
- **Email** opens the user's own mail app through a `mailto:` link containing the full summary.
  Mail clients limit link length (Outlook on Windows is the strictest), so a very long summary
  is shortened with a note pointing to the download. There is intentionally no server-side
  "send to any address" endpoint: it would be an open mail relay.

## Tests

```bash
npm test
```

Covers text cleaning, both summarizers, the Claude request shapes (using a fake client), every
upload failure mode over real HTTP, and the browser-side helpers.

## Known limitations and next steps

- **The AI path has been tested against a fake client, not the live API.** Request shapes,
  chunking, ordering, refusals and error mapping are covered, but run one real book through it
  before relying on it.
- **No OCR.** Scanned books are rejected with an explanation. Adding OCR (or sending the PDF
  directly to the model) is the natural next feature.
- **No rate limiting or authentication.** Each AI summary costs money, so add both before
  exposing this publicly.
- **One long HTTP request.** A very long book can take minutes, and a reverse proxy with a
  short timeout would cut it off. For production, make summarizing a background job with
  progress updates.
- Extractive mode's stop-word list is English; other languages work through a
  frequency-based filter but less precisely.
- Words broken across lines that were really hyphenated compounds ("well-\nknown") are joined.
