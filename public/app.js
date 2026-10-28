import {
  buildMailto,
  formatBytes,
  slugify,
  toMarkdown,
  toPlainText,
  validateFile,
} from './format.js';
import { summarizeExtractive } from './shared/extractive.js';

const $ = (id) => document.getElementById(id);

const els = {
  form: $('upload-form'),
  dropzone: $('dropzone'),
  input: $('file-input'),
  hint: $('dz-hint'),
  chip: $('file-chip'),
  chipName: $('file-name'),
  chipSize: $('file-size'),
  chipRemove: $('file-remove'),
  error: $('form-error'),
  submit: $('submit'),
  uploadCard: $('upload-card'),
  progress: $('progress'),
  progressText: $('progress-text'),
  progressBar: $('progress-bar'),
  cancel: $('cancel'),
  result: $('result'),
  title: $('result-title'),
  meta: $('result-meta'),
  notice: $('result-notice'),
  summary: $('summary'),
  email: $('email'),
  status: $('action-status'),
  privacy: $('privacy'),
};

const state = {
  maxBytes: 10 * 1024 * 1024,
  file: null,
  mode: 'browser',
  controller: null, // AbortController for the summary in progress
  result: null,
};

/* ---------- configuration ---------- */

// "browser": everything happens on this device (static hosting, or a server without a key).
// "ai": the server can write AI summaries; it receives the extracted text, never the PDF.
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(String(res.status));
    const config = await res.json();
    state.maxBytes = config.maxFileBytes ?? state.maxBytes;
    state.mode = config.mode === 'ai' ? 'ai' : 'browser';
  } catch {
    state.mode = 'browser'; // no API, e.g. a static host
  }
  els.hint.textContent = `PDF only, up to ${formatBytes(state.maxBytes)}`;
  els.privacy.textContent =
    state.mode === 'ai'
      ? 'Your PDF is read in your browser. Only its text is sent to this site and to Anthropic’s Claude API to write the summary, and nothing is stored.'
      : 'Your PDF is read entirely in your browser. It is never uploaded anywhere.';
}

/* ---------- file selection ---------- */

function showError(message) {
  els.error.textContent = message ?? '';
  els.error.hidden = !message;
}

function selectFile(file) {
  showError(null);
  const problem = file ? validateFile(file, state.maxBytes) : null;
  if (problem) {
    state.file = null;
    showError(problem);
  } else {
    state.file = file ?? null;
  }
  renderSelection();
}

function renderSelection() {
  const { file } = state;
  els.chip.hidden = !file;
  if (file) {
    els.chipName.textContent = file.name;
    els.chipName.title = file.name;
    els.chipSize.textContent = formatBytes(file.size);
  }
  els.submit.disabled = !file;
}

els.input.addEventListener('change', () => {
  selectFile(els.input.files[0]);
  els.input.value = ''; // allow choosing the same file again after removing it
});

els.chipRemove.addEventListener('click', () => {
  selectFile(null);
  els.input.focus();
});

for (const type of ['dragenter', 'dragover']) {
  els.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    els.dropzone.classList.add('is-dragging');
  });
}
for (const type of ['dragleave', 'drop']) {
  els.dropzone.addEventListener(type, () => els.dropzone.classList.remove('is-dragging'));
}
els.dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  const files = event.dataTransfer?.files;
  if (files?.length > 1) {
    selectFile(null);
    showError('Please drop one PDF at a time.');
    return;
  }
  selectFile(files?.[0]);
});

// A PDF dropped outside the drop zone would make the browser navigate away to it.
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (event) => event.preventDefault());
}

/* ---------- summarizing ---------- */

function setBusy(busy) {
  els.form.hidden = busy;
  els.progress.hidden = !busy;
}

function setProgress(text, percent) {
  els.progressText.textContent = text;
  if (percent == null) els.progressBar.removeAttribute('value');
  else els.progressBar.value = percent;
}

/** Let the browser paint the latest progress message before heavy work starts. */
const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

const isCancelled = (err) => err?.name === 'CancelledError' || err?.name === 'AbortError';

async function summarizeWithServer(book, signal) {
  let res;
  try {
    res = await fetch('/api/summarize-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: book.title, text: book.text }),
      signal,
    });
  } catch (err) {
    if (isCancelled(err)) throw err;
    throw new Error('We could not reach the server. Check your connection and try again.');
  }
  const body = await res.json().catch(() => null); // a proxy error page is not JSON
  if (!res.ok || !body) {
    throw new Error(body?.error || 'Something went wrong while summarizing. Please try again.');
  }
  return body.paragraphs;
}

async function summarize(file, signal) {
  setProgress('Opening your PDF…', null);
  const { readPdfFile } = await import('./pdf-reader.js'); // pdf.js loads only when needed
  const book = await readPdfFile(file, {
    signal,
    onProgress: (page, total) => setProgress(`Reading page ${page} of ${total}…`, (page / total) * 100),
  });

  setProgress(
    state.mode === 'ai' ? 'Summarizing your book. Long books can take a minute or two.' : 'Summarizing your book…',
    null,
  );
  await nextPaint();
  if (signal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });

  const paragraphs =
    state.mode === 'ai' ? await summarizeWithServer(book, signal) : summarizeExtractive(book.text);
  return { title: book.title, pages: book.pages, words: book.words, mode: state.mode === 'ai' ? 'ai' : 'extractive', paragraphs };
}

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.file || state.controller) return;

  showError(null);
  setBusy(true);
  state.controller = new AbortController();
  try {
    showResult(await summarize(state.file, state.controller.signal));
  } catch (err) {
    setBusy(false);
    if (!isCancelled(err)) {
      showError(err?.message || 'Something went wrong. Please try again.');
    }
    els.submit.focus();
  } finally {
    state.controller = null;
  }
});

els.cancel.addEventListener('click', () => state.controller?.abort());

/* ---------- result ---------- */

function showResult(result) {
  state.result = result;
  setBusy(false);
  els.uploadCard.hidden = true;
  els.result.hidden = false;
  els.status.textContent = '';

  els.title.textContent = result.title;

  els.meta.replaceChildren(
    ...[
      `${result.pages.toLocaleString()} ${result.pages === 1 ? 'page' : 'pages'}`,
      `${result.words.toLocaleString()} words read`,
      result.mode === 'ai' ? 'AI summary' : 'Quick extractive summary',
    ].map((text) => Object.assign(document.createElement('li'), { textContent: text })),
  );

  els.notice.hidden = result.mode === 'ai';
  if (result.mode !== 'ai') {
    els.notice.textContent =
      'This summary is made of key sentences taken directly from the book. For a written summary with ' +
      'plot, characters and themes, the site owner can enable AI summaries.';
  }

  els.summary.replaceChildren(
    ...result.paragraphs.map((text) => Object.assign(document.createElement('p'), { textContent: text })),
  );

  const mail = buildMailto(result);
  els.email.href = mail.href;
  els.email.title = mail.shortened ? 'The summary is long, so the email contains a shortened version.' : '';

  els.title.focus();
  els.result.scrollIntoView({ block: 'start' });
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('download-txt').addEventListener('click', () => {
  download(`${slugify(state.result.title)}-summary.txt`, toPlainText(state.result), 'text/plain');
  els.status.textContent = 'Downloaded as a text file.';
});

$('download-md').addEventListener('click', () => {
  download(`${slugify(state.result.title)}-summary.md`, toMarkdown(state.result), 'text/markdown');
  els.status.textContent = 'Downloaded as a Markdown file.';
});

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(toPlainText(state.result));
    els.status.textContent = 'Copied to the clipboard.';
  } catch {
    els.status.textContent = 'Copying is not available here. Select the text and copy it manually.';
  }
});

els.email.addEventListener('click', () => {
  els.status.textContent = 'Opening your email app…';
});

$('again').addEventListener('click', () => {
  state.result = null;
  state.file = null;
  renderSelection();
  els.result.hidden = true;
  els.uploadCard.hidden = false;
  els.input.focus();
});

loadConfig();
renderSelection();
