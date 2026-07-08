const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { notConfigured } = require('./not-configured');

const CRED_TARGET = 'gemini:antigravity';
const LINUX_TOKEN_PATH = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'antigravity-oauth-token');
const LOAD_CODE_ASSIST_URL = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';
const QUOTA_SUMMARY_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary';

function readAccessTokenWindows() {
  const scriptPath = path.join(__dirname, 'win-cred-read.py');
  let output;
  try {
    output = execFileSync('python', [scriptPath, CRED_TARGET], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    // Python missing, or the gemini:antigravity credential doesn't exist.
    throw notConfigured('Antigravity credential not available (needs agy sign-in and Python)');
  }
  const parsed = JSON.parse(output);
  const token = parsed?.token?.access_token;
  if (!token) {
    throw notConfigured('access_token not found in gemini:antigravity credential');
  }
  return token;
}

function readAccessTokenLinux() {
  let raw;
  try {
    raw = fs.readFileSync(LINUX_TOKEN_PATH, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw notConfigured('Antigravity CLI is not signed in on this machine');
    }
    throw err;
  }
  const token = JSON.parse(raw)?.token?.access_token;
  if (!token) {
    throw notConfigured('access_token not found in Antigravity oauth token file');
  }
  return token;
}

function readAccessToken() {
  if (process.platform === 'win32') return readAccessTokenWindows();
  if (process.platform === 'linux') return readAccessTokenLinux();
  throw notConfigured('Antigravity provider currently only supports Windows and Linux');
}

async function callCloudCode(url, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'antigravity',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Antigravity request to ${url} failed: ${res.status}`);
  }
  return res.json();
}

async function fetchAntigravityUsage() {
  const token = readAccessToken();

  const loadResp = await callCloudCode(LOAD_CODE_ASSIST_URL, token, {
    metadata: { ideName: 'antigravity' },
  });
  const project = loadResp.cloudaicompanionProject;

  const summary = await callCloudCode(QUOTA_SUMMARY_URL, token, { project });

  const groups = (summary.groups ?? []).map((group) => {
    const bucket = group.buckets?.[0];
    return {
      name: group.displayName,
      percent: bucket ? Math.round((1 - bucket.remainingFraction) * 100) : null,
      resetsAt: bucket?.resetTime ?? null,
    };
  });

  return { groups };
}

module.exports = { fetchAntigravityUsage };
