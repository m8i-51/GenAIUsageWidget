const fs = require('fs');
const os = require('os');
const path = require('path');
const { notConfigured } = require('./not-configured');

const AUTH_PATH = path.join(os.homedir(), '.codex', 'auth.json');
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

function readAccessToken() {
  let raw;
  try {
    raw = fs.readFileSync(AUTH_PATH, 'utf8');
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

async function fetchCodexUsage() {
  const token = readAccessToken();

  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Codex usage request failed: ${res.status}`);
  }

  const data = await res.json();
  const primary = data.rate_limit?.primary_window;
  const secondary = data.rate_limit?.secondary_window;

  return {
    primary: primary
      ? {
          percent: primary.used_percent ?? null,
          resetsAt: primary.reset_at ? new Date(primary.reset_at * 1000).toISOString() : null,
        }
      : null,
    secondary: secondary
      ? {
          percent: secondary.used_percent ?? null,
          resetsAt: secondary.reset_at ? new Date(secondary.reset_at * 1000).toISOString() : null,
        }
      : null,
  };
}

module.exports = { fetchCodexUsage };
