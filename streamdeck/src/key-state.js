import { PROVIDERS, listLimits } from './limits.js';

export const DEFAULT_PROVIDER = 'claude';

/**
 * What a key should show for its settings and its provider's latest payload.
 * @param {{ provider?: string, limit?: string, limitLabel?: string, label?: string }} settings
 * @param {object | undefined} payload fetchWithCache-shaped result, or undefined before the first fetch
 */
export function keyState(settings, payload) {
  const provider = settings.provider || DEFAULT_PROVIDER;
  const providerName = PROVIDERS[provider] ?? provider;
  const limits = payload?.ok ? listLimits(provider, payload.usage) : [];
  const limit = (settings.limit && limits.find((l) => l.id === settings.limit))
    ?? (settings.limit ? null : limits[0] ?? null);

  const limitLabel = limit?.label ?? settings.limitLabel;
  const title = settings.label || (limitLabel ? `${providerName} · ${limitLabel}` : providerName);

  if (!payload) return { title, status: 'loading' };
  if (!payload.ok) {
    if (payload.needsWidget) return { title, status: 'needsWidget' };
    if (payload.authExpired) return { title, status: 'reauth' };
    if (payload.notConfigured) return { title, status: 'signin' };
    return { title, status: 'error' };
  }
  if (!limit) return { title, status: 'error' };
  return { title, status: 'ok', percent: limit.percent, resetsAt: limit.resetsAt, stale: !!payload.stale };
}

export const CLOSEST_TITLE = 'Closest limit';

/**
 * The limit nearest its cap among the included providers, like the tray icon.
 * @param {{ exclude?: string[] }} settings
 * @param {Record<string, object>} results provider id -> latest payload
 * @param {string[]} providerIds every provider this key can consider
 */
export function closestState(settings, results, providerIds) {
  const excluded = new Set(settings.exclude ?? []);
  const included = providerIds.filter((id) => !excluded.has(id));
  let best = null;
  for (const provider of included) {
    const payload = results[provider];
    if (!payload?.ok) continue;
    for (const limit of listLimits(provider, payload.usage)) {
      if (!best || limit.percent > best.limit.percent) best = { provider, limit, stale: !!payload.stale };
    }
  }
  if (!best) {
    const allLoaded = included.every((id) => results[id] !== undefined);
    return { title: CLOSEST_TITLE, status: allLoaded ? 'none' : 'loading' };
  }
  return {
    title: `${PROVIDERS[best.provider] ?? best.provider} · ${best.limit.label}`,
    status: 'ok',
    percent: best.limit.percent,
    resetsAt: best.limit.resetsAt,
    stale: best.stale,
  };
}
