// Browser entry point for reading PDFs: wires the vendored pdf.js into shared/pdf.js.
import * as pdfjs from './vendor/pdfjs/pdf.min.mjs';
import { readPdf } from './shared/pdf.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const documentOptions = {
  cMapUrl: new URL('./vendor/pdfjs/cmaps/', import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', import.meta.url).href,
};

/**
 * Read a PDF chosen by the user, entirely in the browser.
 * @param {File} file
 * @param {{onProgress?: (page: number, total: number) => void, signal?: AbortSignal}} [options]
 */
export async function readPdfFile(file, options = {}) {
  const data = new Uint8Array(await file.arrayBuffer());
  return readPdf(pdfjs, data, { ...options, fileName: file.name, documentOptions });
}
