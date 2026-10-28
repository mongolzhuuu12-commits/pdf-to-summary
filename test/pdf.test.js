import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { bookFromPages, looksLikePdf, pickTitle } from '../shared/book.js';
import { UserFacingError } from '../shared/errors.js';
import { CancelledError, readPdf } from '../shared/pdf.js';
import { makePdf } from './helpers/make-pdf.js';
import { makeBook, paginate } from './helpers/sample-text.js';

// The same pdf.js build the site ships (the legacy build; see scripts/build.mjs).
let pdfjs;
before(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
});

const bytes = (buffer) => new Uint8Array(buffer);
const book = () => paginate(makeBook());
const rejectsWith = (status, pattern) => (err) =>
  err instanceof UserFacingError && err.status === status && pattern.test(err.message);

describe('readPdf', () => {
  it('reads every page, strips running headers and uses the PDF title', async () => {
    const pdf = await makePdf({ pages: book(), title: 'The Harbour Accounts', header: 'THE HARBOUR ACCOUNTS', pageNumbers: true });
    const progress = [];
    const result = await readPdf(pdfjs, bytes(pdf), { fileName: 'file.pdf', onProgress: (n, t) => progress.push(`${n}/${t}`) });

    assert.equal(result.title, 'The Harbour Accounts');
    assert.ok(result.pages > 10);
    assert.ok(result.words > 1000);
    assert.doesNotMatch(result.text, /HARBOUR ACCOUNTS/);
    assert.equal(progress.length, result.pages);
    assert.equal(progress.at(-1), `${result.pages}/${result.pages}`);
  });

  it('falls back to the file name when the PDF has no title', async () => {
    const result = await readPdf(pdfjs, bytes(await makePdf({ pages: book() })), { fileName: 'Монгол_ном.pdf' });
    assert.equal(result.title, 'Монгол ном');
  });

  it('rejects files that are not PDFs', async () => {
    await assert.rejects(readPdf(pdfjs, bytes(Buffer.from('plain text'))), rejectsWith(415, /does not look like a PDF/));
  });

  it('explains damaged PDFs', async () => {
    await assert.rejects(readPdf(pdfjs, bytes(Buffer.from('%PDF-1.4\nnot really\n%%EOF'))), rejectsWith(422, /damaged/));
  });

  it('explains password-protected PDFs', async () => {
    const pdf = await makePdf({ pages: book(), password: 'secret' });
    await assert.rejects(readPdf(pdfjs, bytes(pdf)), rejectsWith(422, /password/));
  });

  it('explains scans with no text layer', async () => {
    await assert.rejects(readPdf(pdfjs, bytes(await makePdf({ pages: [] }))), rejectsWith(422, /scan/));
  });

  it('stops when cancelled part-way through', async () => {
    const controller = new AbortController();
    const pdf = await makePdf({ pages: book() });
    let pagesRead = 0;
    await assert.rejects(
      readPdf(pdfjs, bytes(pdf), {
        signal: controller.signal,
        onProgress: (n) => {
          pagesRead = n;
          if (n === 3) controller.abort();
        },
      }),
      CancelledError,
    );
    assert.equal(pagesRead, 3);
  });

  it('does nothing when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(readPdf(pdfjs, bytes(await makePdf({ pages: book() })), { signal: controller.signal }), CancelledError);
  });
});

describe('book helpers', () => {
  it('recognises the PDF signature, even after leading junk', () => {
    assert.equal(looksLikePdf(bytes(Buffer.from('%PDF-1.7 ...'))), true);
    assert.equal(looksLikePdf(bytes(Buffer.from(`${' '.repeat(500)}%PDF-1.4`))), true);
    assert.equal(looksLikePdf(bytes(Buffer.from('GIF89a'))), false);
  });

  it('ignores generic metadata titles', () => {
    assert.equal(pickTitle('Microsoft Word - draft3.docx', 'Emma.pdf'), 'Emma');
    assert.equal(pickTitle('untitled', 'my_book.PDF'), 'my book');
    assert.equal(pickTitle('  Pride   and Prejudice ', 'x.pdf'), 'Pride and Prejudice');
    assert.equal(pickTitle(undefined, ''), 'Untitled book');
  });

  it('counts pages and words from the page texts', () => {
    const result = bookFromPages(['A'.repeat(150) + ' one two', 'B'.repeat(100) + ' three'], { fileName: 'x.pdf' });
    assert.equal(result.pages, 2);
    assert.equal(result.words, 5);
    assert.equal(result.title, 'x');
  });
});
