// Helpers for turning raw per-page PDF text into clean, flowing prose.

// "Page 4", "- 4 -", "4 of 300", "4"
const PAGE_NUMBER_LINE = /^(?:page\s+)?[-–—\s]*\d{1,4}[-–—\s]*(?:of\s+\d{1,4})?$/i;

// How many lines at the top and bottom of a page can be a running header/footer.
const EDGE_LINES = 2;

// Real running headers and footers are a line or two on pages of dozens of lines. If
// "repeated" lines would remove more than this share of the whole document, the detection
// has latched onto real content (e.g. a book with very short pages), so leave them alone.
const MAX_RUNNING_SHARE = 0.4;

/**
 * Collapse a line to a key so that "Chapter 3 · Page 41" and "Chapter 3 · Page 42"
 * are recognised as the same running header.
 */
function edgeKey(line) {
  return line.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
}

/**
 * Indexes of the lines that may be a running header or footer. The top and bottom windows
 * never reach the middle of the page, so a short page always keeps some body text.
 */
function edgeIndexes(length) {
  const window = Math.min(EDGE_LINES, Math.ceil(length / 2) - 1);
  const indexes = new Set();
  for (let i = 0; i < window; i++) {
    indexes.add(i);
    indexes.add(length - 1 - i);
  }
  return indexes;
}

/** Edge-line keys that repeat on enough pages to be a running header or footer. */
function findRunningLines(pages) {
  if (pages.length < 4) return new Set();
  // Bare page numbers are removed by their own rule, so they are not counted here.
  const candidates = (lines) =>
    [...edgeIndexes(lines.length)].filter((i) => !PAGE_NUMBER_LINE.test(lines[i]));

  const counts = new Map();
  for (const lines of pages) {
    const keysOnThisPage = new Set(candidates(lines).map((i) => edgeKey(lines[i])));
    for (const key of keysOnThisPage) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.3));
  const running = new Set([...counts].filter(([, n]) => n >= threshold).map(([key]) => key));

  let removed = 0;
  let total = 0;
  for (const lines of pages) {
    total += lines.length;
    for (const i of candidates(lines)) if (running.has(edgeKey(lines[i]))) removed++;
  }
  return removed > total * MAX_RUNNING_SHARE ? new Set() : running;
}

/** Join wrapped lines into one paragraph, repairing words hyphenated at a line break. */
function reflow(lines) {
  let out = '';
  for (const line of lines) {
    if (!out) {
      out = line;
    } else if (/\p{L}-$/u.test(out) && /^\p{Ll}/u.test(line)) {
      out = out.slice(0, -1) + line;
    } else {
      out += ' ' + line;
    }
  }
  return out;
}

function normalizeCharacters(text) {
  return text
    .normalize('NFKC') // expands ligatures such as "ﬁ", fixes odd spaces
    .replace(/­/g, '') // soft hyphens
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+/g, ' ');
}

/**
 * Turn the per-page text of a PDF into clean prose.
 * Drops running headers/footers and page numbers, repairs hyphenation and rejoins
 * wrapped lines. Pages become paragraphs, separated by a blank line.
 *
 * @param {string[]} pageTexts One string per PDF page, lines separated by "\n".
 * @returns {string}
 */
export function cleanPages(pageTexts) {
  const pages = pageTexts.map((page) =>
    normalizeCharacters(page)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );

  const running = findRunningLines(pages);
  const paragraphs = pages.map((lines) => {
    const edges = edgeIndexes(lines.length);
    const kept = lines.filter((line, i) => {
      // A line that is only a page number is never prose, so the very first and last
      // lines are always checked for one, even on pages too short to have header windows.
      const atPageEdge = lines.length > 1 && (i === 0 || i === lines.length - 1);
      if ((edges.has(i) || atPageEdge) && PAGE_NUMBER_LINE.test(line)) return false;
      return !(edges.has(i) && running.has(edgeKey(line)));
    });
    return reflow(kept);
  });

  return paragraphs.filter(Boolean).join('\n\n');
}

export function countWords(text) {
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

export function countLetters(text) {
  const matches = text.match(/\p{L}/gu);
  return matches ? matches.length : 0;
}

/**
 * Split text into pieces of at most `maxChars`, preferring paragraph boundaries,
 * then whitespace. Nothing is dropped: joining the chunks reproduces the text
 * (modulo the whitespace at the cut points).
 *
 * @param {string} text
 * @param {number} maxChars
 * @returns {string[]}
 */
export function chunkText(text, maxChars) {
  if (!(maxChars > 0)) throw new RangeError('maxChars must be positive');
  const chunks = [];
  let current = '';

  const flush = () => {
    if (current) chunks.push(current);
    current = '';
  };

  for (const paragraph of text.split('\n\n')) {
    let rest = paragraph;
    // A single paragraph longer than the limit is cut at the last space before it.
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf(' ', maxChars);
      if (cut <= 0) cut = maxChars;
      flush();
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    if (!rest) continue;
    if (current && current.length + 2 + rest.length > maxChars) flush();
    current = current ? `${current}\n\n${rest}` : rest;
  }
  flush();
  return chunks;
}

/**
 * Normalise model output into an array of paragraphs: strips Markdown emphasis and
 * heading marks (the UI renders plain paragraphs), splits on blank lines, and folds any
 * paragraphs beyond `max` into the last one so the 3-5 paragraph contract holds.
 *
 * @param {string} raw
 * @param {number} [max]
 * @returns {string[]}
 */
export function toParagraphs(raw, max = 5) {
  const paragraphs = raw
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/(\*\*|__)(.+?)\1/g, '$2')
        .replace(/\s*\n\s*/g, ' ')
        .trim(),
    )
    .filter(Boolean);

  if (paragraphs.length <= max) return paragraphs;
  return [...paragraphs.slice(0, max - 1), paragraphs.slice(max - 1).join(' ')];
}
