import { bookFromPages, looksLikePdf } from './book.js';
import { UserFacingError } from './errors.js';

/** Thrown when the caller cancels; carries no message for the user. */
export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

/** Same layout pdf.js tools use: item text in order, a newline where a line ends. */
function pageText(content) {
  return content.items
    .filter((item) => item.str != null)
    .map((item) => item.str + (item.hasEOL ? '\n' : ''))
    .join('');
}

/**
 * Read a PDF into a book. The pdf.js library is passed in so the same code runs in the
 * browser (the vendored build) and in Node tests (the legacy build).
 *
 * @param {typeof import('pdfjs-dist')} pdfjs
 * @param {Uint8Array} data The PDF bytes. pdf.js takes ownership of them.
 * @param {object} [options]
 * @param {string} [options.fileName] Used as the title when the PDF has none.
 * @param {(page: number, total: number) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @param {object} [options.documentOptions] Extra options for pdfjs.getDocument.
 */
export async function readPdf(pdfjs, data, { fileName, onProgress, signal, documentOptions } = {}) {
  if (!looksLikePdf(data)) {
    throw new UserFacingError(415, 'That file does not look like a PDF. Please choose a .pdf file.');
  }
  if (signal?.aborted) throw new CancelledError();

  const task = pdfjs.getDocument({ data, isEvalSupported: false, ...documentOptions });
  const cancel = () => task.destroy();
  signal?.addEventListener('abort', cancel, { once: true });

  try {
    let pdf;
    try {
      pdf = await task.promise;
    } catch (err) {
      if (signal?.aborted) throw new CancelledError();
      if (err?.name === 'PasswordException') {
        throw new UserFacingError(422, 'This PDF is password-protected. Remove the password and try again.', {
          cause: err,
        });
      }
      throw new UserFacingError(422, 'We could not read this file as a PDF. It may be damaged.', { cause: err });
    }

    const pageTexts = [];
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        if (signal?.aborted) throw new CancelledError();
        const page = await pdf.getPage(n);
        pageTexts.push(pageText(await page.getTextContent()));
        page.cleanup();
        onProgress?.(n, pdf.numPages);
      }
    } catch (err) {
      if (err instanceof CancelledError || signal?.aborted) throw new CancelledError();
      throw new UserFacingError(422, 'We could not extract text from this PDF.', { cause: err });
    }

    let metaTitle;
    try {
      metaTitle = (await pdf.getMetadata()).info?.Title;
    } catch {
      // Metadata is optional; fall back to the file name.
    }
    return bookFromPages(pageTexts, { metaTitle, fileName });
  } finally {
    signal?.removeEventListener('abort', cancel);
    await task.destroy().catch(() => {});
  }
}
