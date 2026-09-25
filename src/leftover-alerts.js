// Unused quota reminders: shortly before a weekly or monthly window resets,
// notify once when a good part of it is still unused, so it can be spent
// instead of expiring. Short windows (5-hour sessions, daily quotas) come
// back too often for a reminder to be worth it.

const { meters } = require('./pace');

// Remind this long before the reset.
const LEAD_MS = 24 * 60 * 60 * 1000;
// Only remind when at least this much of the window is left.
const MIN_UNUSED_PERCENT = 30;
// A meter whose reset was ever further out than this is a long window.
const LONG_WINDOW_MS = 36 * 60 * 60 * 1000;
// Providers recompute resetsAt from "seconds until reset", so it jitters a little.
const RESET_TOLERANCE_MS = 10 * 60 * 1000;

const PROVIDER_LABELS = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  antigravity: 'Antigravity',
  copilot: 'Copilot',
  windsurf: 'Windsurf',
  kiro: 'Kiro',
  gemini: 'Gemini',
  zai: 'z.ai',
};

/**
 * Meters known to reset weekly or monthly, with the name the card shows.
 * Meters not listed here still qualify once their reset has been seen more
 * than LONG_WINDOW_MS away.
 */
function knownLongMeters(providerId, usage) {
  switch (providerId) {
    case 'claude':
      return {
        week: 'weekly limit',
        weekScoped: usage.weekScoped?.name ? `weekly ${usage.weekScoped.name} limit` : 'weekly model limit',
      };
    case 'codex':
      return { secondary: 'weekly limit' };
    case 'copilot':
      return { primary: 'premium requests' };
    case 'cursor':
      return { total: 'monthly usage' };
    case 'windsurf':
      return usage.kind === 'credits'
        ? { primary: 'prompt credits', secondary: 'flow actions' }
        : { secondary: 'weekly quota' };
    case 'kiro':
      return { primary: 'monthly credits' };
    case 'zai':
      return { secondary: 'weekly limit' };
    default:
      return {};
  }
}

// Per meter ("provider:key"): { resetsAt, maxLeadMs, notified }.
// Memory only, like the usage alerts: a restart may remind once more.
const state = new Map();

function formatLead(ms) {
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h`;
  return `${Math.max(1, Math.round(ms / (60 * 1000)))}m`;
}

function sameWindow(a, b) {
  return a != null && b != null && Math.abs(a - b) <= RESET_TOLERANCE_MS;
}

/**
 * Evaluate a usage result (with pace `forecasts` attached) and notify once per
 * window for each long meter that resets soon with plenty left unused.
 * @param {string} providerId
 * @param {object} result
 * @param {{ enabled: boolean, notify: (title: string, body: string) => void, now?: number }} options
 */
function checkAndNotify(providerId, result, { enabled, notify, now = Date.now() }) {
  if (!result || !result.ok || result.stale || !result.usage) return;
  const known = knownLongMeters(providerId, result.usage);
  const due = [];

  for (const { key, percent, resetsAt } of meters(providerId, result.usage)) {
    const resetTime = resetsAt ? new Date(resetsAt).getTime() : NaN;
    if (!Number.isFinite(resetTime)) continue;
    const lead = resetTime - now;

    const id = `${providerId}:${key}`;
    let entry = state.get(id);
    if (!entry || !sameWindow(entry.resetsAt, resetTime)) {
      entry = { resetsAt: resetTime, maxLeadMs: lead, notified: false };
      state.set(id, entry);
    }
    entry.resetsAt = resetTime;
    entry.maxLeadMs = Math.max(entry.maxLeadMs, lead);

    // Antigravity keys are "group/model"; show them the way the card does.
    const label = known[key]
      ?? (entry.maxLeadMs > LONG_WINDOW_MS ? key.replace(/^(.+)\/(.+)$/, '$1 ($2)') : null);
    if (!label || entry.notified || lead <= 0 || lead > LEAD_MS) continue;
    const unused = 100 - percent;
    if (unused < MIN_UNUSED_PERCENT) continue;
    // Skip when the recent pace already uses it up before the reset.
    if (result.forecasts?.[key]?.beforeReset) continue;

    // Mark even while disabled so re-enabling doesn't remind about this window.
    entry.notified = true;
    due.push(`${Math.round(unused)}% of ${label} unused, resets in ${formatLead(lead)}`);
  }

  if (!enabled || due.length === 0) return;
  const name = PROVIDER_LABELS[providerId] ?? providerId;
  notify(`${name}: quota about to expire`, due.join('\n'));
}

function resetState() {
  state.clear();
}

module.exports = {
  checkAndNotify,
  resetState,
  LEAD_MS,
  MIN_UNUSED_PERCENT,
};
