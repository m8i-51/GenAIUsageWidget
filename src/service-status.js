/**
 * Provider service health, read from each vendor's public status page
 * (all Atlassian Statuspage-compatible `/api/v2/summary.json`). Checked in
 * the background at most every few minutes, so a slow status page never
 * delays the usage cards; callers read the last known value with get().
 */

const REFRESH_MS = 5 * 60 * 1000;
const RETRY_MS = 60 * 1000;
// Drop a status we could not refresh for this long rather than show an old outage.
const MAX_AGE_MS = 20 * 60 * 1000;
const TIMEOUT_MS = 10 * 1000;

/**
 * `components` narrows a shared page to what this app's provider uses (for
 * example Copilot on githubstatus.com). When none of the page's components
 * match, the page-wide indicator is used instead.
 */
const STATUS_PAGES = {
  claude: {
    page: 'https://status.claude.com',
    components: /claude code|claude\.ai|claude api/i,
  },
  codex: {
    page: 'https://status.openai.com',
    components: /codex|^cli$|vs code extension/i,
  },
  cursor: {
    page: 'https://status.cursor.com',
  },
  copilot: {
    page: 'https://www.githubstatus.com',
    components: /copilot/i,
  },
};

// Ordered from healthy to worst; maintenance ranks below real outages.
const LEVELS = ['none', 'maintenance', 'minor', 'major', 'critical'];

const COMPONENT_LEVELS = {
  operational: 'none',
  under_maintenance: 'maintenance',
  degraded_performance: 'minor',
  partial_outage: 'major',
  major_outage: 'critical',
};

const LEVEL_LABELS = {
  maintenance: 'Maintenance',
  minor: 'Degraded performance',
  major: 'Partial outage',
  critical: 'Major outage',
};

function worse(a, b) {
  return LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a;
}

/**
 * Reduce a Statuspage summary to one status for this provider.
 * @returns {{ level: string, label: string | null, title: string | null, url: string }}
 */
function parseSummary(providerId, summary) {
  const { page, components: pattern } = STATUS_PAGES[providerId];
  const matched = pattern
    ? (summary.components || []).filter((c) => !c.group && pattern.test(c.name || ''))
    : [];

  let level;
  let title = null;
  if (matched.length > 0) {
    level = matched.reduce((acc, c) => worse(acc, COMPONENT_LEVELS[c.status] ?? 'none'), 'none');
    if (level !== 'none') {
      const ids = new Set(matched.map((c) => c.id));
      const incident = [...(summary.incidents || []), ...(summary.scheduled_maintenances || [])]
        .find((i) => (i.components || []).some((c) => ids.has(c.id)));
      const hit = matched.find((c) => COMPONENT_LEVELS[c.status] === level);
      title = incident?.name ?? hit?.name ?? null;
    }
  } else {
    const indicator = summary.status?.indicator;
    level = LEVELS.includes(indicator) ? indicator : 'none';
    if (level !== 'none') {
      const incident = summary.incidents?.[0] ?? summary.scheduled_maintenances?.[0];
      title = incident?.name ?? summary.status?.description ?? null;
    }
  }

  return { level, label: LEVEL_LABELS[level] ?? null, title, url: page };
}

/** @type {Map<string, { status: object, at: number }>} */
const known = new Map();
/** @type {Map<string, number>} next time each provider may be fetched */
const nextFetch = new Map();
const inFlight = new Set();
const listeners = new Set();

async function fetchStatus(providerId) {
  const res = await fetch(`${STATUS_PAGES[providerId].page}/api/v2/summary.json`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`status page returned ${res.status}`);
  return parseSummary(providerId, await res.json());
}

function refresh(providerId) {
  if (inFlight.has(providerId)) return;
  inFlight.add(providerId);
  fetchStatus(providerId)
    .then((status) => {
      const before = known.get(providerId)?.status;
      known.set(providerId, { status, at: Date.now() });
      nextFetch.set(providerId, Date.now() + REFRESH_MS);
      for (const cb of listeners) cb(providerId, status, before ?? null);
    })
    .catch((err) => {
      console.warn(`Service status check failed for ${providerId}:`, err.message);
      nextFetch.set(providerId, Date.now() + RETRY_MS);
    })
    .finally(() => inFlight.delete(providerId));
}

/**
 * Last known status for a provider (null when unknown or unsupported), and
 * kick off a background refresh when it is due.
 */
function get(providerId) {
  if (!STATUS_PAGES[providerId]) return null;
  if (Date.now() >= (nextFetch.get(providerId) ?? 0)) refresh(providerId);
  const entry = known.get(providerId);
  if (!entry || Date.now() - entry.at > MAX_AGE_MS) return null;
  return entry.status;
}

/** Called with (providerId, status, previousStatus) after each successful check. */
function onChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function isSupported(providerId) {
  return !!STATUS_PAGES[providerId];
}

function pageUrl(providerId) {
  return STATUS_PAGES[providerId]?.page ?? null;
}

function isIncident(status) {
  return !!status && status.level !== 'none';
}

module.exports = {
  STATUS_PAGES,
  LEVEL_LABELS,
  parseSummary,
  get,
  onChange,
  isSupported,
  pageUrl,
  isIncident,
};
