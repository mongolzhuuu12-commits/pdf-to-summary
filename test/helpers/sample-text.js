// Deterministic, varied prose for tests (so results never depend on a random seed).

const NAMES = ['Elinor', 'Marcus', 'Odile', 'Tobias', 'Wren', 'Caspian', 'Ilse', 'Rafferty'];
const PLACES = ['the harbour', 'the old mill', 'the northern gate', 'the library', 'the orchard', 'the market square'];
const VERBS = ['inspected', 'abandoned', 'rebuilt', 'questioned', 'defended', 'mapped', 'burned', 'sold'];
const THINGS = ['a ledger', 'the bridge', 'a sealed letter', 'the lighthouse', 'an iron key', 'the winter harvest'];
const CLAUSES = [
  'although nobody believed the rumours',
  'while the rain kept falling on the slate roofs',
  'because the council had refused to listen',
  'before the first frost arrived that year',
  'and the whole village watched in silence',
  'though the cost would prove far greater than expected',
];

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * Generate `count` distinct-ish sentences. Every sentence contains `marker`
 * (e.g. "zone3") so tests can tell which part of a book a quoted sentence came from.
 */
export function makeSentences(count, { marker = '', seed = 1 } = {}) {
  const next = rng(seed);
  const pick = (list) => list[Math.floor(next() * list.length)];
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(
      `${pick(NAMES)} ${pick(VERBS)} ${pick(THINGS)} at ${pick(PLACES)} ${marker} ${pick(CLAUSES)}, ` +
        `and chapter ${i + 1} of this account records every detail.`.replace('  ', ' '),
    );
  }
  return out;
}

/** A multi-section "book": `sections` blocks of `perSection` sentences, each tagged zone0, zone1, … */
export function makeBook({ sections = 5, perSection = 50 } = {}) {
  return Array.from({ length: sections }, (_, s) =>
    makeSentences(perSection, { marker: `zone${s}`, seed: s + 7 }).join(' '),
  ).join('\n\n');
}

/** Split text into page-sized bodies of roughly `chars` characters, breaking at spaces. */
export function paginate(text, chars = 900) {
  const pages = [];
  let rest = text.replace(/\n\n/g, ' ');
  while (rest.length > chars) {
    const cut = rest.lastIndexOf(' ', chars);
    pages.push(rest.slice(0, cut));
    rest = rest.slice(cut + 1);
  }
  if (rest) pages.push(rest);
  return pages;
}
