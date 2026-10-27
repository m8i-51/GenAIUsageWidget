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
