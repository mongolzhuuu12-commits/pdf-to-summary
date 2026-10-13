import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { UserFacingError } from './errors.js';
import { extractPdf } from './extract.js';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Everything is served from our own origin; there are no inline scripts or styles.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** PDFs start with "%PDF-" (readers tolerate up to 1 KB of leading junk). */
function looksLikePdf(buffer) {
  return buffer.subarray(0, 1024).includes('%PDF-');
}

/**
 * Browsers send file names as UTF-8 but multer decodes them as Latin-1.
 * Re-decode when that round-trips cleanly (i.e. the name was really UTF-8).
 */
function fixFileName(name) {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

/**
 * @param {object} options
 * @param {import('./summarizers/index.js').Summarizer} options.summarizer
 * @param {number} [options.maxFileBytes]
 * @returns {import('express').Express}
 */
export function createApp({ summarizer, maxFileBytes = MAX_FILE_BYTES }) {
  const app = express();
  app.disable('x-powered-by');

  // Uploads are held in memory only and never written to disk.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileBytes, files: 1, fields: 0 },
  });

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });

  app.get('/api/config', (req, res) => {
    res.json({
      maxFileBytes,
      mode: summarizer.mode,
    });
  });

  app.post('/api/summarize', upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file) {
      throw new UserFacingError(400, 'Please choose a PDF file to upload.');
    }
    if (!looksLikePdf(file.buffer)) {
      throw new UserFacingError(415, 'That file does not look like a PDF. Please upload a .pdf file.');
    }

    // Stop paying for a summary nobody is waiting for.
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });

    try {
      const book = await extractPdf(file.buffer, fixFileName(file.originalname));
      const { paragraphs } = await summarizer.summarize({
        title: book.title,
        text: book.text,
        signal: controller.signal,
      });

      res.json({
        title: book.title,
        pages: book.pages,
        words: book.words,
        mode: summarizer.mode,
        paragraphs,
      });
    } catch (err) {
      // Whatever failed, nobody is listening any more: don't log or reply.
      if (controller.signal.aborted) return;
      throw err;
    }
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use(express.static(publicDir, { extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
  app.use((err, req, res, next) => {
    if (res.headersSent) return;

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const mb = Math.round(maxFileBytes / (1024 * 1024));
        return res.status(413).json({ error: `That file is larger than the ${mb} MB limit.` });
      }
      return res.status(400).json({ error: 'The upload was not understood. Please choose one PDF file.' });
    }
    if (err instanceof UserFacingError) {
      if (err.cause) console.error(`[${err.status}] ${err.message}`, err.cause);
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  });

  return app;
}
