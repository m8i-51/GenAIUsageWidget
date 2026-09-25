const WARNING_ENTER = 70;
const WARNING_EXIT = 65;
const CRITICAL_ENTER = 90;
const CRITICAL_EXIT = 85;

const PROVIDER_LABELS = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  antigravity: 'Antigravity',
  copilot: 'Copilot',
  gemini: 'Gemini',
};

// Per provider: { warning: 'below'|'notified', critical: 'below'|'notified' }.
// Memory only — re-alerting after a restart while still over a threshold is fine.
const state = new Map();

/**
 * The percent shown on each card's summary ring (must match renderer.js).
 * @returns {{ percent: number, label: string } | null}
 */
function headlineUsage(providerId, usage) {
  if (!usage) return null;
  switch (providerId) {
    case 'claude':
      return usage.session ? { percent: usage.session.percent, label: 'session' } : null;
    case 'codex':
      return usage.primary ? { percent: usage.primary.percent, label: 'session' } : null;
    case 'cursor':
      return { percent: usage.percent, label: 'total' };
    case 'antigravity': {
      const buckets = (usage.groups ?? []).flatMap((g) => g.buckets ?? []);
      if (buckets.length === 0) return null;
      return { percent: Math.max(...buckets.map((b) => b.percent ?? 0)), label: 'highest model' };
    }
    case 'copilot': {
      const headline = usage.primary ?? usage.secondary;
      return headline ? { percent: headline.percent, label: usage.primary ? 'premium' : 'chat' } : null;
    }
    case 'gemini': {
      const headline = usage.primary ?? usage.secondary;
      return headline ? { percent: headline.percent, label: usage.primary ? 'Pro' : 'Flash' } : null;
    }
    default:
      return null;
  }
}

function nextLevel(percent, enter, exit, current) {
  if (percent >= enter) return 'notified';
  if (percent < exit) return 'below';
  return current;
}

/**
 * Evaluate a fetch result (the `{ ok, usage, stale }` payload the usage IPC
 * handlers return) and fire a notification when a threshold is first crossed.
 * @param {string} providerId
 * @param {object} result
 * @param {{ enabled: boolean, notify: (title: string, body: string) => void }} options
 */
function checkAndNotify(providerId, result, { enabled, notify }) {
  if (!result || !result.ok || result.stale) return;
  const headline = headlineUsage(providerId, result.usage);
  if (!headline || typeof headline.percent !== 'number' || !Number.isFinite(headline.percent)) return;

  const { percent, label } = headline;
  const prev = state.get(providerId) ?? { warning: 'below', critical: 'below' };
  const next = {
    warning: nextLevel(percent, WARNING_ENTER, WARNING_EXIT, prev.warning),
    critical: nextLevel(percent, CRITICAL_ENTER, CRITICAL_EXIT, prev.critical),
  };
  state.set(providerId, next);
  // Keep tracking while disabled so re-enabling doesn't alert for a level already reached.
  if (!enabled) return;

  const name = PROVIDER_LABELS[providerId] ?? providerId;
  const body = `Usage at ${Math.round(percent)}% (${label})`;
  // A jump straight past 90% only shows the critical alert.
  if (next.critical === 'notified' && prev.critical === 'below') {
    notify(`${name} usage critical`, body);
  } else if (next.warning === 'notified' && prev.warning === 'below') {
    notify(`${name} usage warning`, body);
  }
}

function resetState() {
  state.clear();
}

module.exports = {
  checkAndNotify,
  headlineUsage,
  resetState,
  WARNING_ENTER,
  WARNING_EXIT,
  CRITICAL_ENTER,
  CRITICAL_EXIT,
};
