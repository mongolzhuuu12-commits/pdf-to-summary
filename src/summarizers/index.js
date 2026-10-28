import { createClaudeSummarizer, DEFAULT_MODEL } from './claude.js';

/**
 * @typedef {object} Summarizer
 * @property {'ai'} mode
 * @property {string} model
 * @property {(input: {title: string, text: string, signal?: AbortSignal}) => Promise<{paragraphs: string[]}>} summarize
 */

/**
 * Choose the server-side summarizer from the environment. The quick extractive summary
 * always runs in the browser, so the server only ever offers AI summaries.
 *
 * SUMMARIZER=auto (default)  Claude when an API credential is present, otherwise none.
 * SUMMARIZER=ai              Claude; fails at startup when no credential is present.
 * SUMMARIZER=extractive      No AI, even if a key is present.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Summarizer | null}
 */
export function createSummarizerFromEnv(env = process.env) {
  const choice = (env.SUMMARIZER ?? 'auto').toLowerCase();
  if (!['auto', 'ai', 'extractive'].includes(choice)) {
    throw new Error(`SUMMARIZER must be "auto", "ai" or "extractive" (got "${env.SUMMARIZER}")`);
  }
  const hasCredential = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);

  if (choice === 'ai' && !hasCredential) {
    throw new Error('SUMMARIZER=ai requires ANTHROPIC_API_KEY to be set.');
  }
  if (choice === 'extractive' || !hasCredential) return null;

  return createClaudeSummarizer({
    model: env.SUMMARY_MODEL || DEFAULT_MODEL,
    ...(env.SUMMARY_EFFORT && { effort: env.SUMMARY_EFFORT }),
  });
}
