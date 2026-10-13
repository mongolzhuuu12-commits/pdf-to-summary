import { createClaudeSummarizer, DEFAULT_MODEL } from './claude.js';
import { createExtractiveSummarizer } from './extractive.js';

/**
 * @typedef {object} Summarizer
 * @property {'ai'|'extractive'} mode
 * @property {string|null} model
 * @property {(input: {title: string, text: string, signal?: AbortSignal}) => Promise<{paragraphs: string[]}>} summarize
 */

/**
 * Choose a summarizer from the environment.
 *
 * SUMMARIZER=auto (default)  Claude when an API credential is present, otherwise extractive.
 * SUMMARIZER=ai              Claude; fails at startup when no credential is present.
 * SUMMARIZER=extractive      Offline sentence extraction, even if a key is present.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Summarizer}
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
  if (choice === 'extractive' || (choice === 'auto' && !hasCredential)) {
    return createExtractiveSummarizer();
  }
  return createClaudeSummarizer({
    model: env.SUMMARY_MODEL || DEFAULT_MODEL,
    ...(env.SUMMARY_EFFORT && { effort: env.SUMMARY_EFFORT }),
  });
}
