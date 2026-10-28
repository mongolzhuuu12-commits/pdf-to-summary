import { existsSync } from 'node:fs';
import { createApp } from './src/app.js';
import { createSummarizerFromEnv } from './src/summarizers/index.js';

if (!existsSync(new URL('./dist/index.html', import.meta.url))) {
  console.error('The site has not been built yet. Run `npm run build` (or just `npm start`).');
  process.exit(1);
}

const port = Number(process.env.PORT) || 3000;
const summarizer = createSummarizerFromEnv();

createApp({ summarizer }).listen(port, () => {
  const how = summarizer
    ? `AI summaries with ${summarizer.model}`
    : 'quick summaries in the browser (set ANTHROPIC_API_KEY for AI summaries)';
  console.log(`Book summarizer listening on http://localhost:${port} — ${how}`);
});
