const fs = require('fs');
const os = require('os');
const path = require('path');
const { notConfigured } = require('./not-configured');
const {
  authExpired,
  isAuthStatus,
  jwtExpiryMs,
  findExecutable,
  spawnCli,
  throttled,
  markHealthy,
} = require('./cli-refresh');

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const RPC_TIMEOUT_MS = 20 * 1000;

function authPath() {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  return path.join(home, 'auth.json');
}

function readAccessToken() {
  let raw;
  try {
    raw = fs.readFileSync(authPath(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw notConfigured('Codex CLI is not signed in on this machine');
    }
    throw err;
  }
  const auth = JSON.parse(raw);
  const token = auth?.tokens?.access_token;
  if (!token) {
    throw notConfigured('access_token not found in auth file');
  }
  return token;
}

function toWindow(percent, resetAtSeconds) {
  return {
    percent: percent ?? null,
    resetsAt: resetAtSeconds ? new Date(resetAtSeconds * 1000).toISOString() : null,
  };
}

async function fetchUsageDirect(token) {
  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const err = new Error(`Codex usage request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const primary = data.rate_limit?.primary_window;
  const secondary = data.rate_limit?.secondary_window;

  return {
    primary: primary ? toWindow(primary.used_percent, primary.reset_at) : null,
    secondary: secondary ? toWindow(secondary.used_percent, secondary.reset_at) : null,
  };
}

// Asks `codex app-server` for the rate limits. The CLI refreshes an expired
// sign-in itself and saves it to auth.json, so later polls go direct again.
function fetchUsageViaCli(codexPath) {
  return new Promise((resolve, reject) => {
    const child = spawnCli(codexPath, ['-s', 'read-only', '-a', 'never', 'app-server']);
    const pending = new Map();
    let nextId = 1;
    let buffer = '';
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('codex app-server timed out')), RPC_TIMEOUT_MS);

    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const request = (method, params) => new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej });
      send({ id, method, params: params ?? {} });
    });

    child.on('error', (err) => finish(err));
    child.on('exit', (code) => finish(new Error(`codex app-server exited (${code})`)));
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        const waiter = message.id != null ? pending.get(message.id) : null;
        if (!waiter) continue;
        pending.delete(message.id);
        if (message.error) waiter.rej(new Error(message.error.message || 'codex app-server error'));
        else waiter.res(message.result);
      }
    });

    (async () => {
      await request('initialize', { clientInfo: { name: 'genai-usage-widget', version: '1.0.0' } });
      send({ method: 'initialized', params: {} });
      const result = await request('account/rateLimits/read');
      const limits = result?.rateLimits ?? {};
      finish(null, {
        primary: limits.primary ? toWindow(limits.primary.usedPercent, limits.primary.resetsAt) : null,
        secondary: limits.secondary ? toWindow(limits.secondary.usedPercent, limits.secondary.resetsAt) : null,
      });
    })().catch((err) => finish(err));
  });
}

async function fetchCodexUsage() {
  const token = readAccessToken();
  const expiresAt = jwtExpiryMs(token);
  const expired = expiresAt != null && expiresAt <= Date.now();

  if (!expired) {
    try {
      const usage = await fetchUsageDirect(token);
      markHealthy('codex');
      return usage;
    } catch (err) {
      if (!isAuthStatus(err.status)) throw err;
    }
  }

  const codexPath = findExecutable('codex');
  if (!codexPath) {
    throw authExpired('Codex sign-in expired');
  }
  let usage;
  try {
    usage = await throttled('codex', () => fetchUsageViaCli(codexPath));
  } catch (err) {
    console.warn('Codex CLI refresh failed:', err.message);
    throw authExpired('Codex sign-in expired');
  }
  if (!usage) throw authExpired('Codex sign-in expired');
  markHealthy('codex');
  return usage;
}

module.exports = { fetchCodexUsage };
