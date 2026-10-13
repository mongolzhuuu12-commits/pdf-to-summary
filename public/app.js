import {
  buildMailto,
  formatBytes,
  slugify,
  toMarkdown,
  toPlainText,
  validateFile,
} from './format.js';

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
  request: null, // in-flight XMLHttpRequest
  result: null,
};

/* ---------- configuration ---------- */

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(String(res.status));
    const config = await res.json();
    state.maxBytes = config.maxFileBytes;
    els.hint.textContent = `PDF only, up to ${formatBytes(config.maxFileBytes)}`;
    els.privacy.textContent =
      config.mode === 'ai'
        ? 'Your PDF is processed in memory and is not stored. Its text is sent to Anthropic’s Claude API to write the summary.'
        : 'Your PDF is processed in memory on the server and is not stored.';
  } catch {
    // Defaults are fine; the server enforces the real limits anyway.
    els.privacy.textContent = 'Your PDF is processed in memory and is not stored.';
  }
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

/** Upload the file and resolve with the parsed JSON response. */
function summarize(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    state.request = xhr;
    xhr.open('POST', '/api/summarize');
    xhr.responseType = 'text';

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      if (event.loaded < event.total) {
        setProgress(`Uploading… ${Math.round((event.loaded / event.total) * 100)}%`, (event.loaded / event.total) * 100);
      } else {
        setProgress('Reading and summarizing your book. Long books can take a minute or two.', null);
      }
    });

    xhr.addEventListener('load', () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Not JSON, e.g. an error page from a proxy.
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) return resolve(body);
      const fallback =
        xhr.status === 413
          ? `That file is larger than the ${formatBytes(state.maxBytes)} limit.`
          : 'Something went wrong while summarizing. Please try again.';
      reject(new Error(body?.error || fallback));
    });
    xhr.addEventListener('error', () =>
      reject(new Error('We could not reach the server. Check your connection and try again.')),
    );
    xhr.addEventListener('abort', () => reject(Object.assign(new Error('Cancelled'), { cancelled: true })));

    const data = new FormData();
    data.append('file', file);
    setProgress('Uploading… 0%', 0);
    xhr.send(data);
  });
}

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.file || state.request) return;

  showError(null);
  setBusy(true);
  try {
    const result = await summarize(state.file);
    showResult(result);
  } catch (err) {
    setBusy(false);
    if (!err.cancelled) showError(err.message);
    els.submit.focus();
  } finally {
    state.request = null;
  }
});

els.cancel.addEventListener('click', () => state.request?.abort());

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
