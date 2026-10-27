/**
 * Fetches usage inside the plugin with the widget's own provider code and
 * cache rules (Claude's 150 s TTL, 429 backoff, last-good snapshots).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import usageCache from '../../src/usage-cache.js';
import claude from '../../src/providers/claude.js';
import codex from '../../src/providers/codex.js';
import cursor from '../../src/providers/cursor.js';
import antigravity from '../../src/providers/antigravity.js';
import copilot from '../../src/providers/copilot.js';
import gemini from '../../src/providers/gemini.js';
import windsurf from '../../src/providers/windsurf.js';
import kiro from '../../src/providers/kiro.js';

// z.ai keeps its API key in Electron's safeStorage, which only the widget can read.
const FETCHERS = {
  claude: claude.fetchClaudeUsage,
  codex: codex.fetchCodexUsage,
  cursor: cursor.fetchCursorUsage,
  antigravity: antigravity.fetchAntigravityUsage,
  copilot: copilot.fetchCopilotUsage,
  gemini: gemini.fetchGeminiUsage,
  windsurf: windsurf.fetchWindsurfUsage,
  kiro: kiro.fetchKiroUsage,
};

const dataDir = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'GenAIUsageWidget', 'streamdeck');
fs.mkdirSync(dataDir, { recursive: true });
usageCache.setDataDir(dataDir);

export function localFetch(providerId) {
  const fetchUsage = FETCHERS[providerId];
  if (!fetchUsage) {
    return Promise.resolve({ ok: false, needsWidget: true, error: `${providerId} is only available through the widget` });
  }
  return usageCache.fetchWithCache(providerId, fetchUsage);
}

/** Drop the cached result unless it is too recent; returns ms to wait, 0 when dropped. */
export function requestLocalRefresh(providerId) {
  return FETCHERS[providerId] ? usageCache.requestRefresh(providerId) : 0;
}
