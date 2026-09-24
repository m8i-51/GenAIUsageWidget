const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { notConfigured } = require('./not-configured');

const USAGE_URL = 'https://api.github.com/copilot_internal/user';
const KEYCHAIN_SERVICE = 'copilot-cli';

function configPath() {
  const home = process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
  return path.join(home, 'config.json');
}

function tokenFromEnv() {
  return process.env.COPILOT_GITHUB_TOKEN
    || process.env.GH_TOKEN
    || process.env.GITHUB_TOKEN
    || null;
}

function parseTokenBlob(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string') return parsed;
    return parsed?.token
      || parsed?.access_token
      || parsed?.githubToken
      || parsed?.oauthToken
      || null;
  } catch {
    return trimmed;
  }
}

function readTokenFromWindowsKeychain() {
  const scriptPath = path.join(__dirname, 'win-cred-read.py').replace('app.asar', 'app.asar.unpacked');
  // keytar-style credentials are stored as "<service>/<account>", so match by prefix.
  for (const target of [KEYCHAIN_SERVICE, `${KEYCHAIN_SERVICE}*`]) {
    try {
      const output = execFileSync('python', [scriptPath, target], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const token = parseTokenBlob(output);
      if (token) return token;
    } catch {
      // Python missing, or no credential under this target.
    }
  }
  return null;
}

function readTokenFromLinuxKeyring() {
  try {
    const output = execFileSync('secret-tool', ['lookup', 'service', KEYCHAIN_SERVICE], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parseTokenBlob(output);
  } catch {
    // secret-tool not installed, or nothing stored.
    return null;
  }
}

function firstString(values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function readTokenFromConfigFile() {
  let raw;
  try {
    raw = fs.readFileSync(configPath(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    return null;
  }

  // Plaintext fallback written by `copilot login` when no keychain is available:
  // { copilot_tokens: { "<host>:<login>": "gho_..." }, last_logged_in_user: {...} }
  const tokens = config?.copilot_tokens;
  if (tokens && typeof tokens === 'object') {
    const last = config.last_logged_in_user;
    const preferredKey = last?.host && last?.login ? `${last.host}:${last.login}` : null;
    const token = firstString([preferredKey ? tokens[preferredKey] : null, ...Object.values(tokens)]);
    if (token) return token;
  }

  return firstString([
    config?.githubToken,
    config?.auth?.githubToken,
    config?.auth?.token,
    config?.oauth?.access_token,
    config?.token,
  ]);
}

function readGitHubToken() {
  const envToken = tokenFromEnv();
  if (envToken) return envToken;

  let keychainToken = null;
  if (process.platform === 'win32') {
    keychainToken = readTokenFromWindowsKeychain();
  } else if (process.platform === 'linux') {
    keychainToken = readTokenFromLinuxKeyring();
  }
  if (keychainToken) return keychainToken;

  const fileToken = readTokenFromConfigFile();
  if (fileToken) return fileToken;

  if (process.platform === 'win32') {
    throw notConfigured('GitHub Copilot CLI is not signed in (needs copilot login and Python for keychain)');
  }
  throw notConfigured('GitHub Copilot CLI is not signed in on this machine');
}

function parseResetDate(value) {
  if (!value || typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match) return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`).toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// The API reports what's left; the rings show what's used.
function makeWindow(snapshot, resetsAt) {
  if (!snapshot || snapshot.isPlaceholder || snapshot.unlimited) return null;
  const remaining = snapshot.percentRemaining ?? snapshot.percent_remaining;
  if (typeof remaining !== 'number') return null;
  return {
    percent: Math.round(Math.max(0, Math.min(100, 100 - remaining))),
    resetsAt,
  };
}

async function fetchCopilotUsage() {
  const token = readGitHubToken();

  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/json',
      'Editor-Version': 'vscode/1.96.2',
      'Editor-Plugin-Version': 'copilot-chat/0.26.7',
      'User-Agent': 'GitHubCopilotChat/0.26.7',
      'X-Github-Api-Version': '2025-04-01',
    },
  });

  if (!res.ok) {
    throw new Error(`Copilot usage request failed: ${res.status}`);
  }

  const data = await res.json();
  const snapshots = data.quotaSnapshots ?? data.quota_snapshots ?? {};
  const resetsAt = parseResetDate(data.quotaResetDate ?? data.quota_reset_date);

  return {
    primary: makeWindow(snapshots.premiumInteractions ?? snapshots.premium_interactions, resetsAt),
    secondary: makeWindow(snapshots.chat, resetsAt),
    plan: data.copilotPlan ?? data.copilot_plan ?? null,
  };
}

module.exports = { fetchCopilotUsage };
