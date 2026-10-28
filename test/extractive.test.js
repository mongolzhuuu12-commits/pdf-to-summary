import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UserFacingError } from '../shared/errors.js';
import { splitSentences, summarizeExtractive } from '../shared/extractive.js';
import { makeBook, makeSentences } from './helpers/sample-text.js';

describe('splitSentences', () => {
  it('does not split after titles and initials', () => {
    const out = splitSentences('It was Mr. Darcy who came. J. K. Rowling wrote it. Dr. Who left.');
    assert.deepEqual(out, ['It was Mr. Darcy who came.', 'J. K. Rowling wrote it.', 'Dr. Who left.']);
  });

  it('keeps closing quotes with their sentence', () => {
    assert.deepEqual(splitSentences('"Is it so?" asked Anna. He nodded.'), ['"Is it so?" asked Anna.', 'He nodded.']);
  });

  it('splits CJK text that has no spaces between sentences', () => {
    assert.deepEqual(splitSentences('これは文です。次の文です。'), ['これは文です。', '次の文です。']);
  });
});

describe('summarizeExtractive', () => {
  it('produces 5 paragraphs for a long book, one drawn from each fifth', () => {
    const paragraphs = summarizeExtractive(makeBook({ sections: 5, perSection: 50 }));
    assert.equal(paragraphs.length, 5);
    paragraphs.forEach((p, i) => {
      const zones = new Set(p.match(/zone\d/g));
      assert.deepEqual([...zones], [`zone${i}`], `paragraph ${i} should only quote section ${i}`);
    });
  });

  it('produces 3 to 5 paragraphs for mid-sized texts', () => {
    for (const n of [20, 39, 40, 120]) {
      const out = summarizeExtractive(makeSentences(n, { marker: 'x' }).join(' '));
      assert.ok(out.length >= 3 && out.length <= 5, `${n} sentences → ${out.length} paragraphs`);
    }
  });

  it('keeps sentences in reading order within each paragraph', () => {
    const [first] = summarizeExtractive(makeBook());
    const chapters = [...first.matchAll(/chapter (\d+)/g)].map((m) => Number(m[1]));
    assert.deepEqual(chapters, [...chapters].sort((a, b) => a - b));
  });

  it('never quotes the same sentence twice', () => {
    const text = 'The harbour master counted every ship that entered the bay at dawn. '.repeat(40);
    const sentences = summarizeExtractive(text).join(' ').match(/The harbour master[^.]*\./g);
    assert.equal(sentences.length, 1);
  });

  it('skips fragments that start in lower case', () => {
    // An excerpt that begins mid-sentence leaves a lowercase fragment as the first "sentence".
    const real = makeSentences(30, { marker: 'z' }).join(' ');
    const out = summarizeExtractive(`and then the storm broke over the harbour at last. ${real}`);
    assert.ok(!out.join(' ').includes('and then the storm'));
  });

  it('degrades gracefully on very short text', () => {
    const out = summarizeExtractive(makeSentences(4, { marker: 'z' }).join(' '));
    assert.ok(out.length >= 1 && out.length <= 2);
  });

  it('works on non-English text', () => {
    const text = Array.from(
      { length: 60 },
      (_, i) => `Нэгэн удаа хурдан морьтой залуу ${i} дугаар хөндийгөөр өнгөрч, алс холын тосгон руу явав.`,
    ).join(' ');
    const out = summarizeExtractive(text);
    assert.ok(out.length >= 3);
    assert.match(out[0], /Нэгэн удаа/);
  });

  it('throws a user-facing error when there are no usable sentences', () => {
    assert.throws(
      () => summarizeExtractive('Short. Bits. Only.'),
      (err) => err instanceof UserFacingError && err.status === 422,
    );
  });
});
