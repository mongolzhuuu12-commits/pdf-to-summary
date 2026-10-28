import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApp, MAX_FILE_BYTES, MAX_TEXT_CHARS } from '../src/app.js';
import { UserFacingError } from '../shared/errors.js';

// A stand-in for the built site, so these tests don't depend on `npm run build`.
const siteDir = mkdtempSync(path.join(tmpdir(), 'site-'));
writeFileSync(path.join(siteDir, 'index.html'), '<!doctype html><title>Book Summarizer</title>');

async function start(summarizer) {
  const server = createApp({ summarizer, siteDir }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const post = (base, body, { signal, raw } = {}) =>
  fetch(`${base}/api/summarize-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body),
    signal,
  });

const fakeAi = (impl) => ({ mode: 'ai', model: 'test-model', summarize: impl });

const silence = () => {
  const original = console.error;
  console.error = () => {};
  return () => {
    console.error = original;
  };
};

describe('without an API key (browser-only mode)', () => {
  let app;
  before(async () => {
    app = await start(null);
  });
  after(() => app.close());

  it('tells the page to summarize in the browser', async () => {
    assert.deepEqual(await (await fetch(`${app.base}/api/config`)).json(), { maxFileBytes: MAX_FILE_BYTES, mode: 'browser' });
    assert.equal(MAX_FILE_BYTES, 10 * 1024 * 1024);
  });

  it('refuses AI requests', async () => {
    const res = await post(app.base, { title: 't', text: 'some text' });
    assert.equal(res.status, 404);
    assert.match((await res.json()).error, /not enabled/);
  });

  it('serves the site with security headers', async () => {
    const res = await fetch(`${app.base}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>Book Summarizer<\/title>/);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  it('returns JSON 404s under /api', async () => {
    const res = await fetch(`${app.base}/api/nope`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Not found.' });
  });
});

describe('with AI summaries', () => {
  it('reports AI mode', async () => {
    const app = await start(fakeAi(async () => ({ paragraphs: [] })));
    try {
      assert.equal((await (await fetch(`${app.base}/api/config`)).json()).mode, 'ai');
    } finally {
      await app.close();
    }
  });

  it('summarizes the posted text', async () => {
    let received;
    const app = await start(
      fakeAi(async (input) => {
        received = input;
        return { paragraphs: ['One.', 'Two.', 'Three.'] };
      }),
    );
    try {
      const res = await post(app.base, { title: '  Emma ', text: 'Emma Woodhouse, handsome, clever, and rich.' });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { mode: 'ai', paragraphs: ['One.', 'Two.', 'Three.'] });
      assert.equal(received.title, 'Emma');
      assert.equal(received.text, 'Emma Woodhouse, handsome, clever, and rich.');
      assert.ok(received.signal instanceof AbortSignal);
    } finally {
      await app.close();
    }
  });

  it('accepts the text of a large book', async () => {
    const app = await start(fakeAi(async ({ text }) => ({ paragraphs: [String(text.length)] })));
    try {
      const text = 'word '.repeat(600_000); // 3 MB, about what a 10 MB PDF can yield
      const res = await post(app.base, { title: 'Big', text });
      assert.equal(res.status, 200);
      assert.deepEqual((await res.json()).paragraphs, [String(text.length)]);
    } finally {
      await app.close();
    }
  });

  for (const [name, body, status] of [
    ['a missing title', { text: 'x' }, 400],
    ['a blank title', { title: '  ', text: 'x' }, 400],
    ['an over-long title', { title: 't'.repeat(301), text: 'x' }, 400],
    ['missing text', { title: 't' }, 400],
    ['non-string text', { title: 't', text: 42 }, 400],
  ]) {
    it(`rejects ${name}`, async () => {
      const app = await start(fakeAi(async () => assert.fail('should not be called')));
      try {
        assert.equal((await post(app.base, body)).status, status);
      } finally {
        await app.close();
      }
    });
  }

  it('rejects malformed JSON', async () => {
    const app = await start(fakeAi(async () => assert.fail('should not be called')));
    try {
      const res = await post(app.base, null, { raw: '{"title": ' });
      assert.equal(res.status, 400);
      assert.match((await res.json()).error, /not understood/);
    } finally {
      await app.close();
    }
  });

  it('rejects text beyond the limit', async () => {
    const app = await start(fakeAi(async () => assert.fail('should not be called')));
    try {
      const res = await post(app.base, { title: 't', text: 'x'.repeat(MAX_TEXT_CHARS + 1) });
      assert.equal(res.status, 413);
      assert.match((await res.json()).error, /too much text/);
    } finally {
      await app.close();
    }
  });

  it('passes on user-facing errors with their status', async () => {
    const app = await start(
      fakeAi(async () => {
        throw new UserFacingError(503, 'The summarization service is busy right now.');
      }),
    );
    try {
      const res = await post(app.base, { title: 't', text: 'x' });
      assert.equal(res.status, 503);
      assert.match((await res.json()).error, /busy/);
    } finally {
      await app.close();
    }
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const restore = silence();
    const app = await start(
      fakeAi(async () => {
        throw new Error('database password is hunter2');
      }),
    );
    try {
      const res = await post(app.base, { title: 't', text: 'x' });
      assert.equal(res.status, 500);
      const text = await res.text();
      assert.doesNotMatch(text, /hunter2/);
      assert.match(text, /Something went wrong/);
    } finally {
      restore();
      await app.close();
    }
  });

  it('aborts the summary when the client disconnects, without logging an error', async () => {
    let seenSignal;
    let started;
    const startedPromise = new Promise((resolve) => (started = resolve));
    const logged = [];
    const original = console.error;
    console.error = (...args) => logged.push(args);

    const app = await start(
      fakeAi(
        ({ signal }) =>
          new Promise((_, reject) => {
            seenSignal = signal;
            started();
            signal.addEventListener('abort', () => reject(new Error('aborted by client')));
          }),
      ),
    );
    try {
      const controller = new AbortController();
      post(app.base, { title: 't', text: 'x' }, { signal: controller.signal }).catch(() => {});
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
