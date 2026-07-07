const fs = require('fs');
const os = require('os');
const path = require('path');

const CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

function readAccessToken() {
  const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
  const creds = JSON.parse(raw);
  const token = creds?.claudeAiOauth?.accessToken;
  if (!token) {
    throw new Error('accessToken not found in credentials file');
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
    throw new Error(`Claude usage request failed: ${res.status}`);
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
    weekScoped: data.limits?.find((l) => l.kind === 'weekly_scoped') ?? null,
  };
}

module.exports = { fetchClaudeUsage };
