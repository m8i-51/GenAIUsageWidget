const fs = require('fs');
const os = require('os');
const path = require('path');
const { notConfigured } = require('./not-configured');

const GEMINI_DIR = path.join(os.homedir(), '.gemini');
const CREDS_PATH = path.join(GEMINI_DIR, 'oauth_creds.json');
const SETTINGS_PATH = path.join(GEMINI_DIR, 'settings.json');
const LOAD_CODE_ASSIST_URL = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';
const QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CLI_PACKAGE = path.join('@google', 'gemini-cli');
// Refresh a little early so a token doesn't expire mid-request.
const EXPIRY_SKEW_MS = 60 * 1000;

const TIER_LABELS = {
  'free-tier': 'Free',
  'standard-tier': 'Paid',
  'legacy-tier': 'Legacy',
};

// Refreshed tokens stay in memory; the Gemini CLI's own file is never rewritten.
let refreshed = null;
/** @type {{ clientId: string, clientSecret: string } | null} */
let oauthClient = null;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readAuthType() {
  try {
    const settings = readJson(SETTINGS_PATH);
    return settings?.security?.auth?.selectedType ?? settings?.selectedAuthType ?? null;
  } catch {
    return null;
  }
}

function readCreds() {
  const authType = readAuthType();
  if (authType === 'gemini-api-key' || authType === 'vertex-ai') {
    throw notConfigured('Gemini CLI uses an API key; quota is only available with Google sign-in');
  }
  let creds;
  try {
    creds = readJson(CREDS_PATH);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw notConfigured('Gemini CLI is not signed in on this machine');
    }
    throw err;
  }
  if (!creds?.access_token && !creds?.refresh_token) {
    throw notConfigured('access_token not found in Gemini CLI oauth_creds.json');
  }
  return creds;
}

/** Directories where an npm/Homebrew/bun install of @google/gemini-cli may live. */
function cliPackageDirs() {
  const dirs = [];
  const names = process.platform === 'win32' ? ['gemini.cmd', 'gemini.ps1', 'gemini'] : ['gemini'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const bin = path.join(dir, name);
      if (!fs.existsSync(bin)) continue;
      // npm on Windows: %APPDATA%\npm\gemini.cmd next to node_modules\@google\gemini-cli.
      dirs.push(path.join(dir, 'node_modules', CLI_PACKAGE));
      // npm/nvm on Unix: <prefix>/bin/gemini next to <prefix>/lib/node_modules.
      dirs.push(path.join(dir, '..', 'lib', 'node_modules', CLI_PACKAGE));
      try {
        // Symlinked bin (npm, Homebrew, bun) resolves into the package itself.
        let cur = path.dirname(fs.realpathSync(bin));
        for (let i = 0; i < 4; i += 1) {
          dirs.push(cur);
          cur = path.dirname(cur);
        }
      } catch {
        // Broken symlink: fall through to the sibling guesses above.
      }
    }
  }
  if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'npm', 'node_modules', CLI_PACKAGE));
  return [...new Set(dirs.map((d) => path.resolve(d)))];
}

function isCliPackage(dir) {
  try {
    return readJson(path.join(dir, 'package.json')).name === '@google/gemini-cli';
  } catch {
    return false;
  }
}

/** JS files that can hold the OAuth client constants, across CLI versions. */
function candidateSources(pkgDir) {
  const files = [];
  const bundleDir = path.join(pkgDir, 'bundle');
  try {
    for (const name of fs.readdirSync(bundleDir)) {
      if (name.endsWith('.js')) files.push(path.join(bundleDir, name));
    }
  } catch {
    // Older, unbundled releases have no bundle/ directory.
  }
  const oauth2 = path.join('@google', 'gemini-cli-core', 'dist', 'src', 'code_assist', 'oauth2.js');
  files.push(path.join(pkgDir, 'node_modules', oauth2));
  files.push(path.join(pkgDir, '..', '..', oauth2));
  return files;
}

/**
 * The Gemini CLI signs in with Google's "installed app" OAuth client, and a
 * refresh must use that same client. Read it from the local install rather
 * than shipping a copy.
 */
function findOAuthClient() {
  // Only a hit is cached, so installing the CLI later is picked up.
  if (oauthClient) return oauthClient;
  for (const dir of cliPackageDirs().filter(isCliPackage)) {
    for (const file of candidateSources(dir)) {
      let text;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const id = text.match(/OAUTH_CLIENT_ID\s*=\s*['"]([^'"]+)['"]/);
      const secret = text.match(/OAUTH_CLIENT_SECRET\s*=\s*['"]([^'"]+)['"]/);
      if (id && secret) {
        oauthClient = { clientId: id[1], clientSecret: secret[1] };
        return oauthClient;
      }
    }
  }
  return null;
}

async function refreshAccessToken(refreshToken) {
  const client = refreshToken ? findOAuthClient() : null;
  if (!client) {
    throw new Error('Gemini sign-in expired and the Gemini CLI install was not found to refresh it');
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini token refresh failed: ${res.status}`);
  }
  const data = await res.json();
  refreshed = {
    refreshToken,
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return refreshed.accessToken;
}

async function accessToken(creds, { force = false } = {}) {
  const now = Date.now();
  const fileValid = creds.access_token && (!creds.expiry_date || creds.expiry_date - EXPIRY_SKEW_MS > now);
  if (!force && fileValid) return creds.access_token;
  if (!force && refreshed && refreshed.refreshToken === creds.refresh_token && refreshed.expiresAt - EXPIRY_SKEW_MS > now) {
    return refreshed.accessToken;
  }
  return refreshAccessToken(creds.refresh_token);
}

async function callCodeAssist(url, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(`Gemini request to ${url} failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function percentUsed(bucket) {
  return Math.round((1 - bucket.remainingFraction) * 100);
}

/** The model closest to its limit among those matching `test`. */
function worstBucket(buckets, test) {
  const matching = buckets.filter((b) => test(b.modelId.toLowerCase()));
  if (matching.length === 0) return null;
  const worst = matching.reduce((a, b) => (b.remainingFraction < a.remainingFraction ? b : a));
  return { percent: percentUsed(worst), resetsAt: worst.resetTime ?? null, model: worst.modelId };
}

async function fetchWithToken(token) {
  const envProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID || undefined;
  const load = await callCodeAssist(LOAD_CODE_ASSIST_URL, token, {
    cloudaicompanionProject: envProject,
    metadata: {
      ideType: 'IDE_UNSPECIFIED',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI',
      duetProject: envProject,
    },
  });
  const project = load.cloudaicompanionProject || envProject;
  const quota = await callCodeAssist(QUOTA_URL, token, project ? { project } : {});

  const buckets = (quota.buckets ?? []).filter(
    (b) => b.modelId && typeof b.remainingFraction === 'number'
  );
  const tier = load.paidTier ?? load.currentTier;
  return {
    // Pro on top, Flash below (both daily), like CodexBar's Gemini meter.
    primary: worstBucket(buckets, (id) => id.includes('pro')),
    secondary: worstBucket(buckets, (id) => id.includes('flash')),
    plan: TIER_LABELS[tier?.id] ?? tier?.name ?? null,
  };
}

async function fetchGeminiUsage() {
  const creds = readCreds();
  const token = await accessToken(creds);
  try {
    return await fetchWithToken(token);
  } catch (err) {
    // The file can hold a revoked token with a future expiry; refresh once.
    if (err.status !== 401 || !creds.refresh_token) throw err;
    return fetchWithToken(await accessToken(creds, { force: true }));
  }
}

module.exports = { fetchGeminiUsage };
