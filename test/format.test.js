import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildMailto,
  formatBytes,
  MAILTO_MAX_ENCODED,
  slugify,
  toMarkdown,
  toPlainText,
  validateFile,
} from '../public/format.js';

const summary = { title: 'The Great Gatsby', paragraphs: ['First paragraph.', 'Second paragraph.'] };

describe('slugify', () => {
  it('makes a readable file name', () => {
    assert.equal(slugify('The Great Gatsby: A Novel!'), 'the-great-gatsby-a-novel');
  });
  it('keeps non-Latin letters', () => {
    assert.equal(slugify('Монгол ном'), 'монгол-ном');
  });
  it('falls back when nothing usable remains', () => {
    assert.equal(slugify('???'), 'summary');
    assert.equal(slugify(undefined), 'summary');
  });
  it('caps the length without leaving a trailing dash', () => {
    const slug = slugify('word '.repeat(60));
    assert.ok(slug.length <= 80);
    assert.doesNotMatch(slug, /-$/);
  });
});

describe('exports', () => {
  it('plain text has title, heading and blank-line separated paragraphs', () => {
    assert.equal(toPlainText(summary), 'The Great Gatsby\nSummary\n\nFirst paragraph.\n\nSecond paragraph.\n');
  });
  it('markdown has a title and a section heading', () => {
    assert.equal(toMarkdown(summary), '# The Great Gatsby\n\n## Summary\n\nFirst paragraph.\n\nSecond paragraph.\n');
  });
});

describe('buildMailto', () => {
  const parse = (href) => {
    const url = new URL(href);
    return { subject: url.searchParams.get('subject'), body: url.searchParams.get('body') };
  };

  it('puts the whole summary in the email when it fits', () => {
    const { href, shortened } = buildMailto(summary);
    const { subject, body } = parse(href);
    assert.equal(shortened, false);
    assert.equal(subject, 'Book summary: The Great Gatsby');
    assert.equal(body, 'The Great Gatsby\r\n\r\nFirst paragraph.\r\n\r\nSecond paragraph.');
    assert.ok(href.startsWith('mailto:?'));
  });

  it('encodes characters that would break the link', () => {
    const { href } = buildMailto({ title: 'Q&A #1 = 100%', paragraphs: ['a & b?'] });
    const { subject, body } = parse(href);
    assert.equal(subject, 'Book summary: Q&A #1 = 100%');
    assert.match(body, /a & b\?/);
  });

  it('shortens oversized summaries to fit, at a word boundary, and says so', () => {
    const long = { title: 'Long', paragraphs: Array(5).fill('lorem ipsum dolor sit amet '.repeat(120)) };
    const { href, shortened } = buildMailto(long);
    const { body } = parse(href);
    assert.equal(shortened, true);
    assert.ok(href.length <= MAILTO_MAX_ENCODED, `link is ${href.length} chars`);
    assert.match(body, /Shortened for email/);
    assert.match(body, /(?:lorem|ipsum|dolor|sit|amet)…/);
  });

  it('handles non-Latin text within the limit', () => {
    const long = { title: 'Ном', paragraphs: Array(5).fill('Нэгэн удаа хурдан морьтой залуу явав. '.repeat(40)) };
    assert.ok(buildMailto(long).href.length <= MAILTO_MAX_ENCODED);
  });
});

describe('validateFile', () => {
  const max = 10 * 1024 * 1024;
  const file = (over) => ({ name: 'book.pdf', type: 'application/pdf', size: 1000, ...over });

  it('accepts a normal PDF', () => assert.equal(validateFile(file(), max), null));
  it('accepts a PDF whose browser MIME type is blank', () => assert.equal(validateFile(file({ type: '' }), max), null));
  it('rejects other file types', () => {
    assert.match(validateFile(file({ name: 'a.docx', type: 'application/msword' }), max), /PDF/);
  });
  it('rejects empty files', () => assert.match(validateFile(file({ size: 0 }), max), /empty/));
  it('rejects files over the limit, naming both sizes', () => {
    assert.equal(validateFile(file({ size: 12 * 1024 * 1024 }), max), 'That file is 12 MB. The limit is 10 MB.');
  });
  it('accepts a file of exactly the limit', () => assert.equal(validateFile(file({ size: max }), max), null));
});

describe('formatBytes', () => {
  it('formats B, KB and MB', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(2048), '2 KB');
    assert.equal(formatBytes(5.5 * 1024 * 1024), '5.5 MB');
    assert.equal(formatBytes(10 * 1024 * 1024), '10 MB');
  });
});
