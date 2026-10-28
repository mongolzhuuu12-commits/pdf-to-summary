import { UserFacingError } from './errors.js';
import { cleanPages, countLetters, countWords } from './text.js';

// Fewer letters than this (about 30 words) means there is nothing worth summarizing,
// which in practice means a scanned book with no text layer.
const MIN_LETTERS = 200;

const GENERIC_TITLE = /^(untitled|microsoft word\b.*|.*\.(docx?|indd|pdf|tex|rtf))$/i;

/** PDFs start with "%PDF-" (readers tolerate up to 1 KB of leading junk). */
export function looksLikePdf(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

/**
 * Pick a display title: the PDF's own Title metadata when it looks real, otherwise
 * the file name without its extension.
 */
export function pickTitle(metaTitle, fileName) {
  const fromMeta = typeof metaTitle === 'string' ? metaTitle.replace(/\s+/g, ' ').trim() : '';
  if (fromMeta.length >= 3 && fromMeta.length <= 200 && !GENERIC_TITLE.test(fromMeta)) {
    return fromMeta;
  }
  const fromName = (fileName ?? '')
    .replace(/\.pdf$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return fromName || 'Untitled book';
}

/**
 * Turn the raw text of each page into a book ready to summarize.
 *
 * @param {string[]} pageTexts One string per page, lines separated by "\n".
 * @param {{metaTitle?: string, fileName?: string}} [info]
 * @returns {{title: string, pages: number, words: number, text: string}}
 */
export function bookFromPages(pageTexts, { metaTitle, fileName } = {}) {
  const text = cleanPages(pageTexts);
  if (countLetters(text) < MIN_LETTERS) {
    throw new UserFacingError(
      422,
      'No readable text was found in this PDF. It may be a scan made of images, ' +
        'which this app cannot read yet.',
    );
  }
  return {
    title: pickTitle(metaTitle, fileName),
    pages: pageTexts.length,
    words: countWords(text),
    text,
  };
}
