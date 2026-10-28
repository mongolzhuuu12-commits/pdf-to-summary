import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { UserFacingError } from '../shared/errors.js';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
// A 10 MB PDF yields at most a few MB of text; this leaves generous headroom.
export const MAX_TEXT_CHARS = 8_000_000;

const defaultSiteDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

// Keep in sync with the [[headers]] block in netlify.toml.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * The browser reads the PDF and makes the quick extractive summary itself. This server
 * only adds AI summaries: the browser sends the extracted text, never the PDF.
 *
 * @param {object} options
 * @param {import('./summarizers/index.js').Summarizer | null} options.summarizer
 * @param {string} [options.siteDir] Built site to serve (see `npm run build`).
 * @returns {import('express').Express}
 */
export function createApp({ summarizer, siteDir = defaultSiteDir }) {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });

  app.get('/api/config', (req, res) => {
    res.json({ maxFileBytes: MAX_FILE_BYTES, mode: summarizer ? 'ai' : 'browser' });
  });

  app.post('/api/summarize-text', express.json({ limit: '20mb' }), async (req, res) => {
    if (!summarizer) {
      throw new UserFacingError(404, 'AI summaries are not enabled on this server.');
    }
    const { title, text } = req.body ?? {};
    if (typeof title !== 'string' || !title.trim() || title.length > 300) {
      throw new UserFacingError(400, 'A book title is required.');
    }
    if (typeof text !== 'string' || !text.trim()) {
      throw new UserFacingError(400, 'No book text was sent.');
    }
    if (text.length > MAX_TEXT_CHARS) {
      throw new UserFacingError(413, 'This book has too much text to summarize.');
    }

    // Stop paying for a summary nobody is waiting for.
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });

    try {
      const { paragraphs } = await summarizer.summarize({ title: title.trim(), text, signal: controller.signal });
      res.json({ mode: 'ai', paragraphs });
    } catch (err) {
      // Whatever failed, nobody is listening any more: don't log or reply.
      if (controller.signal.aborted) return;
      throw err;
    }
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use(express.static(siteDir, { extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
  app.use((err, req, res, next) => {
    if (res.headersSent) return;
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'This book has too much text to summarize.' });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'The request was not understood.' });
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
