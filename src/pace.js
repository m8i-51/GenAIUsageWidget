// Pace forecast: estimate when each usage meter hits 100% at the recent rate.
// Samples live in memory only; after a restart a forecast appears once enough
// time has been observed.

// Rate is measured over the last hour; windows that reset more than a day out
// (weekly, monthly) use a longer lookback so one busy hour doesn't dominate.
const LOOKBACK_MS = 60 * 60 * 1000;
const LONG_WINDOW_LOOKBACK_MS = 6 * 60 * 60 * 1000;
const LONG_WINDOW_MS = 24 * 60 * 60 * 1000;
const MIN_SPAN_MS = 10 * 60 * 1000;
// Providers recompute resetsAt from "seconds until reset", so it jitters a little.
const RESET_TOLERANCE_MS = 10 * 60 * 1000;
// A drop this large means the window reset (or the plan changed), not noise.
const RESET_DROP_PERCENT = 5;

/** @type {Map<string, { resetsAt: number | null, samples: { t: number, p: number }[] }>} */
const history = new Map();

/**
 * Every meter with a limit, keyed the same way the renderer looks forecasts up.
 * @returns {{ key: string, percent: number, resetsAt: string | null }[]}
 */
function meters(providerId, usage) {
  if (!usage) return [];
  const list = [];
  const add = (key, window, resetsAt = window?.resetsAt) => {
    if (window && typeof window.percent === 'number' && Number.isFinite(window.percent)) {
      list.push({ key, percent: window.percent, resetsAt: resetsAt ?? null });
    }
  };
  switch (providerId) {
    case 'claude':
      add('session', usage.session);
      add('week', usage.week);
      add('weekScoped', usage.weekScoped);
      break;
    case 'codex':
    case 'copilot':
    case 'windsurf':
    case 'kiro':
      add('primary', usage.primary);
      add('secondary', usage.secondary);
      break;
    case 'cursor':
      add('total', usage, usage.billingCycleEnd);
      add('grokBot', usage.grokBot);
      break;
    case 'antigravity':
      for (const g of usage.groups ?? []) {
        if (g.buckets && g.buckets.length > 0) {
          for (const b of g.buckets) add(`${g.name}/${b.name}`, b);
        } else {
          add(g.name, g);
        }
      }
      break;
    default:
      break;
  }
  return list;
}

function parseTime(iso) {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}

function record(id, percent, resetsAt, now) {
  let entry = history.get(id);
  const last = entry?.samples[entry.samples.length - 1];
  const resetMoved = entry && resetsAt != null && entry.resetsAt != null
    && Math.abs(resetsAt - entry.resetsAt) > RESET_TOLERANCE_MS;
  if (!entry || resetMoved || (last && last.p - percent >= RESET_DROP_PERCENT)) {
    entry = { resetsAt, samples: [] };
    history.set(id, entry);
  }
  if (resetsAt != null) entry.resetsAt = resetsAt;
  entry.samples.push({ t: now, p: percent });
  const lookback = resetsAt != null && resetsAt - now > LONG_WINDOW_MS
    ? LONG_WINDOW_LOOKBACK_MS
    : LOOKBACK_MS;
  // Keep one sample older than the lookback so the rate spans all of it.
  while (entry.samples.length > 2 && entry.samples[1].t <= now - lookback) {
    entry.samples.shift();
  }
  return entry;
}

/**
 * @returns {{ limitAt: string | null, beforeReset: boolean } | null}
 *   limitAt is when 100% is reached at the recent rate (null when usage is flat);
 *   beforeReset says whether that happens before the window resets.
 */
function forecast(entry, percent, resetsAt, now) {
  if (percent >= 100) return null;
  const first = entry.samples[0];
  const span = now - first.t;
  if (span < MIN_SPAN_MS) return null;

  const ratePerMs = (percent - first.p) / span;
  if (ratePerMs <= 0) {
    return resetsAt != null ? { limitAt: null, beforeReset: false } : null;
  }
  const limitAt = now + (100 - percent) / ratePerMs;
  return {
    limitAt: new Date(limitAt).toISOString(),
    beforeReset: resetsAt == null || limitAt < resetsAt,
  };
}

/**
 * Record the latest usage and return a copy of the result with `forecasts`
 * ({ [meterKey]: forecast }) attached. Stale snapshots are not sampled.
 */
function withForecasts(providerId, result, now = Date.now()) {
  if (!result || !result.ok || result.stale || !result.usage) return result;
  const forecasts = {};
  for (const { key, percent, resetsAt } of meters(providerId, result.usage)) {
    const resetTime = parseTime(resetsAt);
    const entry = record(`${providerId}:${key}`, percent, resetTime, now);
    const f = forecast(entry, percent, resetTime, now);
    if (f) forecasts[key] = f;
  }
  return { ...result, forecasts };
}

/** Seed history with an earlier sample (used by demo mode). */
function seedSample(providerId, key, percent, resetsAt, at) {
  record(`${providerId}:${key}`, percent, parseTime(resetsAt), at);
}

module.exports = { withForecasts, seedSample, meters };
