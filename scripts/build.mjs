// Assemble the static site in dist/: the page, the shared modules it imports, and pdf.js.
// The result runs on any static host (Netlify uses it as-is) or behind server.js.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const pdfjsDir = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);

cpSync(path.join(root, 'public'), dist, { recursive: true });
cpSync(path.join(root, 'shared'), path.join(dist, 'shared'), { recursive: true });

const vendor = path.join(dist, 'vendor', 'pdfjs');
// The "legacy" build polyfills very new JavaScript (e.g. Map.getOrInsertComputed) that the
// standard build calls directly, so it also works in older Safari, Chrome and Firefox.
for (const file of ['legacy/build/pdf.min.mjs', 'legacy/build/pdf.worker.min.mjs', 'LICENSE']) {
  cpSync(path.join(pdfjsDir, file), path.join(vendor, path.basename(file)));
}
// Character maps and standard fonts let pdf.js extract text from CJK, Cyrillic and
// other PDFs whose fonts don't embed a Unicode mapping.
cpSync(path.join(pdfjsDir, 'cmaps'), path.join(vendor, 'cmaps'), { recursive: true });
cpSync(path.join(pdfjsDir, 'standard_fonts'), path.join(vendor, 'standard_fonts'), { recursive: true });

console.log(`Built site in ${path.relative(process.cwd(), dist) || dist}`);
