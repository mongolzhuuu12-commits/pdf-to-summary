import PDFDocument from 'pdfkit';

/**
 * Build a PDF in memory for tests.
 *
 * @param {object} opts
 * @param {string[]} [opts.pages]  Body text for each page. Empty array → blank PDF.
 * @param {string} [opts.title]    Value for the PDF Title metadata field.
 * @param {string} [opts.header]   Running header printed on every page.
 * @param {boolean} [opts.pageNumbers] Print a page number at the bottom of each page.
 * @param {string} [opts.password] Encrypt the PDF with this user password.
 * @returns {Promise<Buffer>}
 */
export function makePdf({ pages = [], title, header, pageNumbers = false, password } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A5',
      margin: 50,
      bufferPages: true,
      info: title ? { Title: title } : {},
      ...(password && { userPassword: password, ownerPassword: password }),
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (pages.length === 0) {
      doc.addPage(); // a valid PDF with no text at all (like a scan without OCR)
    }
    pages.forEach((body, i) => {
      if (i > 0) doc.addPage();
      if (header) doc.fontSize(9).text(header, 50, 25, { lineBreak: false });
      doc.fontSize(11).text(body, 50, 60, { width: 300, height: 400 });
      if (pageNumbers) doc.fontSize(9).text(String(i + 1), 50, 500, { lineBreak: false });
    });
    doc.end();
  });
}
