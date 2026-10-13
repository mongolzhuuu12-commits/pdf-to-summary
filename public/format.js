// Pure helpers used by the page. No DOM access, so they can be unit-tested in Node.

/** A filesystem-safe name derived from the book title ("The Great Gatsby" → "the-great-gatsby"). */
export function slugify(title, fallback = 'summary') {
  const slug = String(title ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || fallback;
}

export function toPlainText({ title, paragraphs }) {
  return `${title}\nSummary\n\n${paragraphs.join('\n\n')}\n`;
}

export function toMarkdown({ title, paragraphs }) {
  return `# ${title}\n\n## Summary\n\n${paragraphs.join('\n\n')}\n`;
}

// Mail clients limit how long a mailto: link can be (Outlook on Windows is the strictest,
// at roughly 2,000 characters; most others accept far more). Past this size we shorten.
export const MAILTO_MAX_ENCODED = 6000;
const SHORTENED_NOTE = '\n\n[Shortened for email. Download the summary for the full text.]';

/**
 * Build a mailto: link containing the whole summary, shortening it only if the link
 * would otherwise be too long for mail clients.
 *
 * @returns {{href: string, shortened: boolean}}
 */
export function buildMailto({ title, paragraphs }, maxEncoded = MAILTO_MAX_ENCODED) {
  const subject = `Book summary: ${title}`;
  const href = (body) =>
    `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\n/g, '\r\n'))}`;

  const full = `${title}\n\n${paragraphs.join('\n\n')}`;
  if (href(full).length <= maxEncoded) return { href: href(full), shortened: false };

  // Shorten at a word boundary until the link fits.
  let keep = full.length;
  for (;;) {
    keep = Math.floor(keep * 0.9);
    const cut = full.lastIndexOf(' ', keep);
    const body = `${full.slice(0, cut > 0 ? cut : keep).trimEnd()}…${SHORTENED_NOTE}`;
    if (href(body).length <= maxEncoded || keep < 50) return { href: href(body), shortened: true };
  }
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`; // 10 MB, 5.5 MB
}

/** Returns a message describing why `file` can't be uploaded, or null when it's fine. */
export function validateFile(file, maxBytes) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) return 'Please choose a PDF file.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > maxBytes) {
    return `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(maxBytes)}.`;
  }
  return null;
}
