/**
 * Where a key's numbers come from: the widget's loopback API when the widget
 * is running (so the two never both poll a provider), otherwise the shared
 * provider code run inside the plugin.
 */

export const WIDGET_URL = 'http://127.0.0.1:47821/v1/usage';

/**
 * @param {object} options
 * @param {(providerId: string) => Promise<object>} options.localFetch
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 */
export function createUsageSource({ localFetch, fetchImpl = fetch, timeoutMs = 800 }) {
  async function fromWidget(providerIds) {
    try {
      const res = await fetchImpl(`${WIDGET_URL}?providers=${providerIds.join(',')}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      const body = await res.json();
      // Something else could own the port; only trust the widget's own reply.
      if (body?.app !== 'GenAIUsageWidget' || typeof body.providers !== 'object') return null;
      return body.providers;
    } catch {
      return null;
    }
  }

  async function fromPlugin(providerIds) {
    const results = await Promise.all(providerIds.map((id) => (
      Promise.resolve().then(() => localFetch(id)).catch((err) => ({ ok: false, error: err.message }))
    )));
    return Object.fromEntries(providerIds.map((id, i) => [id, results[i]]));
  }

  return {
    /** @returns {Promise<{ via: 'widget' | 'local' | null, results: Record<string, object> }>} */
    async get(providerIds) {
      if (providerIds.length === 0) return { via: null, results: {} };
      const widget = await fromWidget(providerIds);
      if (widget) return { via: 'widget', results: widget };
      return { via: 'local', results: await fromPlugin(providerIds) };
    },
  };
}
