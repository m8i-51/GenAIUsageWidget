const fs = require('fs');
const os = require('os');
const path = require('path');
const { notConfigured } = require('./not-configured');
const {
  authExpired,
  isAuthStatus,
  findExecutable,
  spawnCli,
  throttled,
  markHealthy,
} = require('./cli-refresh');

const CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CLI_TIMEOUT_MS = 30 * 1000;

function readCredentials() {
  let raw;
  try {
    raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw notConfigured('Claude Code is not signed in on this machine');
    }
    throw err;
  }
  const creds = JSON.parse(raw);
  const token = creds?.claudeAiOauth?.accessToken;
  if (!token) {
    throw notConfigured('accessToken not found in credentials file');
  }
  const expiresAt = creds.claudeAiOauth.expiresAt;
  return { token, expiresAt: typeof expiresAt === 'number' ? expiresAt : null };
}

function isExpired(creds) {
  return creds.expiresAt != null && creds.expiresAt <= Date.now();
}

// Starting Claude Code makes it refresh its own sign-in and save the new one
// to .credentials.json. `auth status` is the lightest command that loads it.
function runClaudeAuthStatus(claudePath) {
  return new Promise((resolve) => {
    const child = spawnCli(claudePath, ['auth', 'status', '--json']);
    const timer = setTimeout(() => child.kill(), CLI_TIMEOUT_MS);
    child.stdin.end();
    child.stdout.resume();
    child.stderr.resume();
    child.on('error', (err) => {
      clearTimeout(timer);
      console.warn('Claude CLI refresh failed:', err.message);
      resolve();
    });
    child.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// Lets the CLI refresh the sign-in, then returns the credentials it saved if
// they're different from the ones that stopped working.
async function refreshViaCli(staleToken) {
  const claudePath = findExecutable('claude', [path.join(os.homedir(), '.claude', 'local')]);
  if (!claudePath) return null;
  await throttled('claude', () => runClaudeAuthStatus(claudePath));
  const creds = readCredentials();
  if (creds.token === staleToken || isExpired(creds)) return null;
  return creds;
}

async function fetchClaudeUsage() {
  let creds = readCredentials();
  if (isExpired(creds)) {
    creds = await refreshViaCli(creds.token);
    if (!creds) throw authExpired('Claude sign-in expired');
  }

  try {
    const usage = await requestUsage(creds.token);
    markHealthy('claude');
    return usage;
  } catch (err) {
    if (!isAuthStatus(err.status)) throw err;
    const fresh = await refreshViaCli(creds.token);
    if (!fresh) throw authExpired('Claude sign-in expired');
    const usage = await requestUsage(fresh.token);
    markHealthy('claude');
    return usage;
  }
}

async function requestUsage(token) {
  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
    },
  });

  if (!res.ok) {
    const err = new Error(`Claude usage request failed: ${res.status}`);
    err.status = res.status;
    const retryAfter = Number(res.headers.get('retry-after'));
    if (retryAfter > 0) err.retryAfterMs = retryAfter * 1000;
    throw err;
  }

  const data = await res.json();

  return {
    session: {
      percent: data.five_hour?.utilization ?? null,
      resetsAt: data.five_hour?.resets_at ?? null,
    },
    week: {
      percent: data.seven_day?.utilization ?? null,
      resetsAt: data.seven_day?.resets_at ?? null,
    },
    weekScoped: (() => {
      const scoped = data.limits?.find((l) => l.kind === 'weekly_scoped');
      if (!scoped) return null;
      return {
        percent: scoped.percent ?? null,
        resetsAt: scoped.resets_at ?? null,
        // The model this weekly cap is scoped to (e.g. "Fable", "Opus").
        name: scoped.scope?.model?.display_name ?? null,
      };
    })(),
  };
}

module.exports = { fetchClaudeUsage };
