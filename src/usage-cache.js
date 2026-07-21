const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_CACHE_TTL_MS = 60 * 1000;
const CLAUDE_CACHE_TTL_MS = 150 * 1000;
const DEFAULT_429_BACKOFF_MS = 10 * 60 * 1000;

/** @type {Map<string, { at: number, ttl: number, payload: object }>} */
const caches = new Map();
/** @type {Map<string, Promise<object>>} */
const pending = new Map();
/** @type {Map<string, { usage: object, at: number } | null>} */
const lastGood = new Map();

function userDataPath() {
  return app.getPath('userData');
}

function lastGoodPath(providerId) {
  if (providerId === 'claude') {
    const legacy = path.join(userDataPath(), 'claude-last-good.json');
    const modern = path.join(userDataPath(), 'last-good-claude.json');
    if (fs.existsSync(legacy) && !fs.existsSync(modern)) {
      return legacy;
    }
    return modern;
  }
  return path.join(userDataPath(), `last-good-${providerId}.json`);
}

function loadLastGood(providerId) {
  if (lastGood.has(providerId)) return lastGood.get(providerId);
  try {
    const saved = JSON.parse(fs.readFileSync(lastGoodPath(providerId), 'utf8'));
    if (saved && saved.usage && saved.at) {
      lastGood.set(providerId, saved);
      return saved;
    }
  } catch {
    // No snapshot yet.
  }
  lastGood.set(providerId, null);
  return null;
}

function saveLastGood(providerId, snapshot) {
  lastGood.set(providerId, snapshot);
  try {
    fs.writeFileSync(lastGoodPath(providerId), JSON.stringify(snapshot));
  } catch (err) {
    console.warn(`Failed to save last-good snapshot for ${providerId}:`, err.message);
  }
}

function getCacheTtl(providerId) {
  return providerId === 'claude' ? CLAUDE_CACHE_TTL_MS : DEFAULT_CACHE_TTL_MS;
}

/**
 * @param {string} providerId
 * @param {() => Promise<object>} fetchUsage
 * @returns {Promise<object>}
 */
async function fetchWithCache(providerId, fetchUsage) {
  const cache = caches.get(providerId);
  if (cache && Date.now() - cache.at < cache.ttl) {
    return cache.payload;
  }

  if (!pending.has(providerId)) {
    pending.set(providerId, (async () => {
      let payload;
      let ttl = getCacheTtl(providerId);
      const snapshot = loadLastGood(providerId);

      try {
        const usage = await fetchUsage();
        const good = { usage, at: Date.now() };
        saveLastGood(providerId, good);
        payload = { ok: true, usage };
      } catch (err) {
        if (err.status === 429) {
          ttl = err.retryAfterMs ?? DEFAULT_429_BACKOFF_MS;
        }
        if (!err.notConfigured && snapshot) {
          payload = {
            ok: true,
            usage: snapshot.usage,
            stale: true,
            staleAt: snapshot.at,
            staleError: err.message,
          };
        } else {
          payload = { ok: false, error: err.message, notConfigured: !!err.notConfigured };
        }
      }

      caches.set(providerId, { at: Date.now(), ttl, payload });
      pending.delete(providerId);
      return payload;
    })());
  }

  return pending.get(providerId);
}

function preloadLastGood(providerIds) {
  for (const id of providerIds) {
    loadLastGood(id);
  }
}

module.exports = { fetchWithCache, preloadLastGood };
