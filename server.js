import { createApp } from './src/app.js';
import { createSummarizerFromEnv } from './src/summarizers/index.js';

const port = Number(process.env.PORT) || 3000;
const summarizer = createSummarizerFromEnv();

createApp({ summarizer }).listen(port, () => {
  const how =
    summarizer.mode === 'ai'
      ? `AI summaries with ${summarizer.model}`
      : 'extractive summaries (set ANTHROPIC_API_KEY for AI summaries)';
  console.log(`PDF book summarizer listening on http://localhost:${port} — ${how}`);
});
