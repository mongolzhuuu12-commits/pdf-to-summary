import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chunkText, cleanPages, countWords, toParagraphs } from '../shared/text.js';

describe('cleanPages', () => {
  it('removes running headers and page numbers that repeat across pages', () => {
    const pages = Array.from({ length: 6 }, (_, i) =>
      [`MOBY DICK — CHAPTER ${i + 1}`, `Body text of page ${i + 1} goes here.`, String(i + 1)].join('\n'),
    );
    const text = cleanPages(pages);
    assert.doesNotMatch(text, /MOBY DICK/);
    assert.match(text, /Body text of page 1 goes here\./);
    assert.match(text, /Body text of page 6 goes here\./);
    assert.doesNotMatch(text, /\n6$/); // the trailing page number is gone
  });

  it('keeps a repeated line when it only appears on a couple of pages', () => {
    const pages = [
      'Title Page\nFirst body line',
      'Second page\nBody',
      'Third page\nBody',
      'Fourth page\nBody',
      'Fifth page\nBody',
    ];
    assert.match(cleanPages(pages), /Title Page/);
  });

  it('does not strip numbers from the middle of a page', () => {
    const text = cleanPages(['Intro line\n1984 was the year\nOutro line', 'x\ny\nz', 'x\ny\nz', 'x\ny\nz']);
    assert.match(text, /1984 was the year/);
  });

  it('keeps the body of very short pages even when its wording repeats', () => {
    const threeLine = Array.from({ length: 6 }, (_, i) => `RUNNING TITLE\nBody text of page ${i + 1} goes here.\n${i + 1}`);
    const cleanedThree = cleanPages(threeLine);
    assert.doesNotMatch(cleanedThree, /RUNNING TITLE/);
    for (let i = 1; i <= 6; i++) assert.match(cleanedThree, new RegExp(`Body text of page ${i} goes here\\.`));

    const twoLine = Array.from({ length: 6 }, (_, i) => `Roses are red, verse ${i + 1}\nViolets are blue, verse ${i + 1}`);
    assert.equal(countWords(cleanPages(twoLine)), 6 * 10); // nothing lost: 10 words per page
  });

  it('leaves repeated lines alone when removing them would gut the document', () => {
    // Every page: 4 lines, 3 of which repeat at the edges. That is far too much to be furniture.
    const pages = Array.from({ length: 8 }, (_, i) => `Refrain one\nRefrain two\nUnique middle ${i} text here\nRefrain three\nRefrain four`);
    const text = cleanPages(pages);
    assert.match(text, /Refrain one/);
    assert.match(text, /Unique middle 7 text here/);
  });

  it('removes "Page N" and "N of M" style numbers', () => {
    const text = cleanPages(['Hello world and more\nPage 7', 'Another sentence here\n8 of 300']);
    assert.doesNotMatch(text, /Page 7|8 of 300/);
  });

  it('repairs words hyphenated across a line break and joins wrapped lines', () => {
    const text = cleanPages(['It was a neighbour-\nhood full of quiet\npeople.']);
    assert.equal(text, 'It was a neighbourhood full of quiet people.');
  });

  it('keeps a hyphen when the next line starts a new capitalised word', () => {
    const text = cleanPages(['The Anglo-\nSaxon chronicle']);
    assert.equal(text, 'The Anglo- Saxon chronicle');
  });

  it('expands ligatures and strips soft hyphens and control characters', () => {
    assert.equal(cleanPages(['ofﬁce con­tract\u0000']), 'office contract');
  });

  it('separates pages with a blank line and skips pages that end up empty', () => {
    assert.equal(cleanPages(['First page text', '', 'Third page text']), 'First page text\n\nThird page text');
  });
});

describe('chunkText', () => {
  const lorem = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

  it('returns a single chunk when the text fits', () => {
    assert.deepEqual(chunkText('short text', 100), ['short text']);
  });

  it('never exceeds the limit and loses no words', () => {
    const text = [lorem(300), lorem(50), lorem(900)].join('\n\n');
    const chunks = chunkText(text, 500);
    assert.ok(chunks.length > 1);
    for (const c of chunks) assert.ok(c.length <= 500, `chunk of ${c.length} chars`);
    assert.equal(countWords(chunks.join(' ')), countWords(text));
  });

  it('prefers to break on paragraph boundaries', () => {
    const chunks = chunkText('aaaa\n\nbbbb\n\ncccc', 10);
    assert.deepEqual(chunks, ['aaaa\n\nbbbb', 'cccc']);
  });

  it('hard-cuts a single unbroken run longer than the limit', () => {
    const chunks = chunkText('x'.repeat(25), 10);
    assert.deepEqual(chunks.map((c) => c.length), [10, 10, 5]);
  });

  it('rejects a non-positive limit', () => {
    assert.throws(() => chunkText('abc', 0), RangeError);
  });
});

describe('toParagraphs', () => {
  it('splits on blank lines and unwraps hard-wrapped lines', () => {
    assert.deepEqual(toParagraphs('One\nstill one.\n\nTwo.\n\n\nThree.'), ['One still one.', 'Two.', 'Three.']);
  });

  it('strips Markdown headings and bold markers', () => {
    assert.deepEqual(toParagraphs('# Summary\n\nA **bold** claim.'), ['Summary', 'A bold claim.']);
  });

  it('folds paragraphs beyond the maximum into the last one', () => {
    const out = toParagraphs('1\n\n2\n\n3\n\n4\n\n5\n\n6\n\n7', 5);
    assert.equal(out.length, 5);
    assert.equal(out[4], '5 6 7');
  });

  it('returns an empty array for blank input', () => {
    assert.deepEqual(toParagraphs('  \n\n '), []);
  });
});
