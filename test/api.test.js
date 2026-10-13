import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp, MAX_FILE_BYTES } from '../src/app.js';
import { UserFacingError } from '../src/errors.js';
import { createExtractiveSummarizer } from '../src/summarizers/extractive.js';
import { makePdf } from './helpers/make-pdf.js';
import { makeBook, paginate } from './helpers/sample-text.js';

/** Start the app on an ephemeral port. */
async function start(options) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

function upload(base, bytes, { name = 'book.pdf', field = 'file', type = 'application/pdf', signal } = {}) {
  const form = new FormData();
  form.append(field, new Blob([bytes], { type }), name);
  return fetch(`${base}/api/summarize`, { method: 'POST', body: form, signal });
}

const silence = () => {
  const original = console.error;
  console.error = () => {};
  return () => {
    console.error = original;
  };
};

describe('POST /api/summarize', () => {
  let app;
  let bookPdf;

  before(async () => {
    app = await start({ summarizer: createExtractiveSummarizer() });
    bookPdf = await makePdf({
      pages: paginate(makeBook()),
      title: 'The Harbour Accounts',
      header: 'THE HARBOUR ACCOUNTS',
      pageNumbers: true,
    });
  });
  after(() => app.close());

  it('summarizes a PDF into 3-5 paragraphs with book details', async () => {
    const res = await upload(app.base, bookPdf);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.title, 'The Harbour Accounts');
    assert.equal(body.mode, 'extractive');
    assert.ok(body.pages > 10);
    assert.ok(body.words > 1000);
    assert.ok(body.paragraphs.length >= 3 && body.paragraphs.length <= 5);
    for (const p of body.paragraphs) assert.equal(typeof p, 'string');
    assert.doesNotMatch(body.paragraphs.join(' '), /HARBOUR ACCOUNTS/, 'running header should be stripped');
  });

  it('falls back to the (UTF-8) file name when the PDF has no title', async () => {
    const pdf = await makePdf({ pages: paginate(makeBook()) });
    const body = await (await upload(app.base, pdf, { name: 'Монгол_ном.pdf' })).json();
    assert.equal(body.title, 'Монгол ном');
  });

  it('rejects a request with no file', async () => {
    const res = await fetch(`${app.base}/api/summarize`, { method: 'POST', body: new FormData() });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /choose a PDF/);
  });

  it('rejects a file sent under the wrong field name', async () => {
    const res = await upload(app.base, bookPdf, { field: 'document' });
    assert.equal(res.status, 400);
  });

  it('rejects files that are not PDFs even if they are named .pdf', async () => {
    const res = await upload(app.base, 'just some text pretending to be a PDF', { name: 'fake.pdf' });
    assert.equal(res.status, 415);
    assert.match((await res.json()).error, /does not look like a PDF/);
  });

  it('rejects a damaged PDF with a helpful message', async () => {
    const restore = silence();
    try {
      const res = await upload(app.base, '%PDF-1.4\nthis is not really a pdf body\n%%EOF');
      assert.equal(res.status, 422);
      assert.match((await res.json()).error, /could not read this file/);
    } finally {
      restore();
    }
  });

  it('explains when the PDF has no text layer (a scan)', async () => {
    const res = await upload(app.base, await makePdf({ pages: [] }));
    assert.equal(res.status, 422);
    assert.match((await res.json()).error, /scan/);
  });

  it('explains when the PDF is password-protected', async () => {
    const restore = silence();
    try {
      const res = await upload(app.base, await makePdf({ pages: paginate(makeBook()), password: 'secret' }));
      assert.equal(res.status, 422);
      assert.match((await res.json()).error, /password/);
    } finally {
      restore();
    }
  });

  it('enforces the 10 MB limit', async () => {
    assert.equal(MAX_FILE_BYTES, 10 * 1024 * 1024);
    const justOver = Buffer.alloc(MAX_FILE_BYTES + 1024, 0x20);
    justOver.write('%PDF-1.4');
    const res = await upload(app.base, justOver);
    assert.equal(res.status, 413);
    assert.match((await res.json()).error, /larger than the 10 MB limit/);
  });

  it('accepts a file just under the limit (then fails on content, not size)', async () => {
    const restore = silence();
    try {
      const justUnder = Buffer.alloc(MAX_FILE_BYTES - 1024, 0x20);
      justUnder.write('%PDF-1.4');
      const res = await upload(app.base, justUnder);
      assert.equal(res.status, 422);
    } finally {
      restore();
    }
  });

  it('sends security headers', async () => {
    const res = await fetch(`${app.base}/api/config`);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});

describe('summarizer failures', () => {
  it('reports user-facing summarizer errors with their status', async () => {
    const app = await start({
      summarizer: {
        mode: 'ai',
        summarize: async () => {
          throw new UserFacingError(503, 'The summarization service is busy right now.');
        },
      },
    });
    try {
      const res = await upload(app.base, await makePdf({ pages: paginate(makeBook()) }));
      assert.equal(res.status, 503);
      assert.match((await res.json()).error, /busy/);
    } finally {
      await app.close();
    }
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const restore = silence();
    const app = await start({
      summarizer: {
        mode: 'ai',
        summarize: async () => {
          throw new Error('database password is hunter2');
        },
      },
    });
    try {
      const res = await upload(app.base, await makePdf({ pages: paginate(makeBook()) }));
      assert.equal(res.status, 500);
      const text = await res.text();
      assert.doesNotMatch(text, /hunter2/);
      assert.match(text, /Something went wrong/);
    } finally {
      restore();
      await app.close();
    }
  });

  it('aborts the summarizer when the client disconnects, without logging an error', async () => {
    let seenSignal;
    let started;
    const startedPromise = new Promise((resolve) => (started = resolve));
    const logged = [];
    const original = console.error;
    console.error = (...args) => logged.push(args);

    const app = await start({
      summarizer: {
        mode: 'ai',
        summarize: ({ signal }) =>
          new Promise((_, reject) => {
            seenSignal = signal;
            started();
            signal.addEventListener('abort', () => reject(new Error('aborted by client')));
          }),
      },
    });
    try {
      const controller = new AbortController();
      const pending = upload(app.base, await makePdf({ pages: paginate(makeBook()) }), { signal: controller.signal });
      pending.catch(() => {});
      await startedPromise;
      controller.abort();
      await new Promise((resolve) => seenSignal.addEventListener('abort', resolve, { once: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(seenSignal.aborted, true);
      assert.deepEqual(logged, [], 'a cancelled request should not be logged as an error');
    } finally {
      console.error = original;
      await app.close();
    }
  });
});

describe('static files and config', () => {
  let app;
  before(async () => {
    app = await start({ summarizer: createExtractiveSummarizer() });
  });
  after(() => app.close());

  it('reports the limit and summarizer mode', async () => {
    const body = await (await fetch(`${app.base}/api/config`)).json();
    assert.deepEqual(body, { maxFileBytes: 10 * 1024 * 1024, mode: 'extractive' });
  });

  it('serves the page', async () => {
    const res = await fetch(`${app.base}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>Book Summarizer<\/title>/);
  });

  it('returns JSON 404s under /api', async () => {
    const res = await fetch(`${app.base}/api/nope`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Not found.' });
  });

  it('serves modules with a JavaScript content type', async () => {
    const res = await fetch(`${app.base}/format.js`);
    assert.match(res.headers.get('content-type'), /javascript/);
  });
});
