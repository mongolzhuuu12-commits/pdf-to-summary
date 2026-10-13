import { getDocumentProxy, extractText, getMeta } from 'unpdf';
import { UserFacingError } from './errors.js';
import { cleanPages, countLetters, countWords } from './text.js';

// Fewer letters than this (about 30 words) means there is nothing worth summarizing,
// which in practice means a scanned book with no text layer.
const MIN_LETTERS = 200;

const GENERIC_TITLE = /^(untitled|microsoft word\b.*|.*\.(docx?|indd|pdf|tex|rtf))$/i;

/**
 * Pick a display title: the PDF's own Title metadata when it looks real, otherwise
 * the uploaded file name without its extension.
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
 * Extract clean text from a PDF held in memory.
 *
 * @param {Buffer} buffer
 * @param {string} [fileName] Original upload name, used as a fallback title.
 * @returns {Promise<{title: string, pages: number, words: number, text: string}>}
 */
export async function extractPdf(buffer, fileName) {
  let pdf;
  try {
    // pdf.js may take ownership of the bytes it is given, so hand it a copy.
    pdf = await getDocumentProxy(new Uint8Array(buffer));
  } catch (err) {
    if (err?.name === 'PasswordException') {
      throw new UserFacingError(
        422,
        'This PDF is password-protected. Remove the password and try again.',
        { cause: err },
      );
    }
    throw new UserFacingError(422, 'We could not read this file as a PDF. It may be damaged.', {
      cause: err,
    });
  }

  try {
    const { totalPages, text: pageTexts } = await extractText(pdf, { mergePages: false });
    const text = cleanPages(pageTexts);

    if (countLetters(text) < MIN_LETTERS) {
      throw new UserFacingError(
        422,
        'No readable text was found in this PDF. It may be a scan made of images, ' +
          'which this app cannot read yet.',
      );
    }

    let metaTitle;
    try {
      metaTitle = (await getMeta(pdf)).info?.Title;
    } catch {
      // Metadata is optional; fall back to the file name.
    }

    return {
      title: pickTitle(metaTitle, fileName),
      pages: totalPages,
      words: countWords(text),
      text,
    };
  } catch (err) {
    if (err instanceof UserFacingError) throw err;
    throw new UserFacingError(422, 'We could not extract text from this PDF.', { cause: err });
  } finally {
    // Releases the parsed document and its resources; the proxy has no destroy() of its own.
    await pdf.loadingTask.destroy().catch(() => {});
  }
}
