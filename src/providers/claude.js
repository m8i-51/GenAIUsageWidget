const fs = require('fs');
const os = require('os');
const path = require('path');
const { notConfigured } = require('./not-configured');

const CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

function readAccessToken() {
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
  return token;
}

async function fetchClaudeUsage() {
  const token = readAccessToken();

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
