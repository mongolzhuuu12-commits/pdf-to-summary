import { UserFacingError } from './errors.js';

// Common English function words. Words that are frequent in *this* document are also
// dropped (see GENERIC_SENTENCE_SHARE), which keeps the approach usable for other languages.
const STOPWORDS = new Set(
  (
    'a about above after again against all also am an and any are as at be because been before being below ' +
    'between both but by can could did do does doing down during each few for from further had has have having ' +
    'he her here hers herself him himself his how i if in into is it its itself just me more most my myself no ' +
    'nor not now of off on once only or other our ours ourselves out over own said same she should so some such ' +
    'than that the their theirs them themselves then there these they this those through to too under until up ' +
    'upon very was we were what when where which while who whom why will with would you your yours yourself ' +
    'yourselves one two may might must shall'
  ).split(' '),
);

const MIN_SENTENCE_CHARS = 40;
const MAX_SENTENCE_CHARS = 400;
const MIN_SENTENCE_WORDS = 6;
const SENTENCES_PER_PARAGRAPH = 3;
// A word appearing in more than this share of sentences carries no topical signal.
const GENERIC_SENTENCE_SHARE = 0.35;

// Titles and abbreviations after which a full stop does not end a sentence ("Mr. Darcy").
const ABBREVIATIONS = 'Mr|Mrs|Ms|Mx|Dr|St|Mt|Prof|Sr|Jr|Capt|Col|Gen|Lt|Sgt|Rev|Hon|vs|etc|No';

const SENTENCE_BOUNDARY = new RegExp(
  // after ., !, ?, … or a CJK stop (plus any closing quote/bracket) ...
  '(?<=[.!?…。！？]["\'”’)\\]]*)' +
    // ... unless that stop belongs to an abbreviation or a single initial ("J. K. Rowling")
    `(?<!\\b(?:${ABBREVIATIONS})\\.)(?<!\\b\\p{Lu}\\.)` +
    // ... and the next sentence starts with a capital, digit or opening quote.
    '\\s+(?=["\'“‘(\\[]?[\\p{Lu}\\p{N}])' +
    // CJK text has no spaces between sentences
    '|(?<=[。！？])',
  'u',
);

/** Split prose into sentences, keeping abbreviations like "Mr. Darcy" intact. */
export function splitSentences(text) {
  return text
    .replace(/\s+/g, ' ')
    .split(SENTENCE_BOUNDARY)
    .map((s) => s.trim())
    .filter(Boolean);
}

function contentWords(sentence) {
  const words = sentence.toLowerCase().match(/\p{L}[\p{L}'’-]*/gu) ?? [];
  return words.filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function paragraphCount(sentenceTotal) {
  if (sentenceTotal < SENTENCES_PER_PARAGRAPH * 3) {
    return Math.max(1, Math.ceil(sentenceTotal / SENTENCES_PER_PARAGRAPH));
  }
  if (sentenceTotal < 40) return 3;
  if (sentenceTotal < 200) return 4;
  return 5;
}

/**
 * Build a summary by selecting the most representative sentences from each part of the
 * book. This is a quick, offline fallback; it quotes the book rather than interpreting it.
 *
 * @param {string} text Clean book text.
 * @returns {string[]} Paragraphs (3-5 for any text of reasonable length).
 */
export function summarizeExtractive(text) {
  const sentences = splitSentences(text).filter(
    (s) =>
      s.length >= MIN_SENTENCE_CHARS &&
      s.length <= MAX_SENTENCE_CHARS &&
      s.split(' ').length >= MIN_SENTENCE_WORDS &&
      !/^\p{Ll}/u.test(s), // a lowercase start means a fragment of broken text
  );
  if (sentences.length === 0) {
    throw new UserFacingError(422, 'Not enough sentence-like text was found to summarize.');
  }

  const words = sentences.map(contentWords);

  // Document frequency: how many sentences each word appears in.
  const docFreq = new Map();
  for (const ws of words) for (const w of new Set(ws)) docFreq.set(w, (docFreq.get(w) ?? 0) + 1);

  // Term frequency over the whole book, excluding words that are generic in this document.
  const weight = new Map();
  for (const ws of words) {
    for (const w of ws) {
      if (docFreq.get(w) / sentences.length > GENERIC_SENTENCE_SHARE) continue;
      weight.set(w, (weight.get(w) ?? 0) + 1);
    }
  }

  const scores = words.map((ws) => {
    const unique = [...new Set(ws)];
    if (unique.length === 0) return 0;
    let sum = 0;
    for (const w of unique) sum += weight.get(w) ?? 0;
    // sqrt keeps long sentences from winning on length alone, without favouring fragments.
    return sum / Math.sqrt(unique.length);
  });

  // Cover the whole book: split it into equal parts and take the best sentences of each.
  const parts = paragraphCount(sentences.length);
  const paragraphs = [];
  const used = new Set(); // never quote the same sentence twice (refrains, repeated headings)
  for (let p = 0; p < parts; p++) {
    const start = Math.floor((p * sentences.length) / parts);
    const end = Math.floor(((p + 1) * sentences.length) / parts);
    const candidates = [];
    for (let i = start; i < end; i++) candidates.push(i);
    candidates.sort((a, b) => scores[b] - scores[a] || a - b);

    const chosen = [];
    for (const i of candidates) {
      if (chosen.length === SENTENCES_PER_PARAGRAPH) break;
      const key = sentences[i].toLowerCase();
      if (used.has(key)) continue;
      used.add(key);
      chosen.push(i);
    }
    chosen.sort((a, b) => a - b);
    if (chosen.length > 0) paragraphs.push(chosen.map((i) => sentences[i]).join(' '));
  }
  return paragraphs;
}
