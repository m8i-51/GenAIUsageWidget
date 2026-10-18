const fs = require('fs');
const os = require('os');
const path = require('path');
const initSqlJs = require('sql.js');
const { notConfigured } = require('./not-configured');
const { authExpired } = require('./cli-refresh');

function getStateDbPath() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdgConfig, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

async function readAccessToken() {
  const dbPath = getStateDbPath();
  let fileBuffer;
  try {
    fileBuffer = fs.readFileSync(dbPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw notConfigured('Cursor is not installed on this machine');
    }
    throw err;
  }
  const SQL = await initSqlJs();
  const db = new SQL.Database(fileBuffer);

  const result = db.exec("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'");
  db.close();

  const token = result?.[0]?.values?.[0]?.[0];
  if (!token) {
    throw notConfigured('Cursor is not signed in on this machine');
  }
  return token;
}

function deriveUserId(token) {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('Unexpected Cursor access token format');
  }
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
  const sub = payload.sub;
  if (!sub) {
    throw new Error('sub claim missing from Cursor access token');
  }
  return sub.split('|').pop();
}

async function fetchSandUsage(cookie) {
  try {
    const res = await fetch('https://cursor.com/api/dashboard/get-sand-usage-status', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: 'https://cursor.com',
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function displayPlanName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

function normalizeSand(data) {
  if (!data || typeof data !== 'object') return null;
  const percent = finiteNumber(data.usagePercent);
  return {
    isUnified: data.isUnified === true,
    percent,
    resetsAt: typeof data.nextResetTimestampUtc === 'string' ? data.nextResetTimestampUtc : null,
    plan: displayPlanName(data.cursorPlanName),
    hasIncluded: data.hasNonZeroIncludedLimit === true && percent != null,
  };
}

function pickOnDemand(summary) {
  const individual = summary?.individualUsage?.onDemand;
  const team = summary?.teamUsage?.onDemand;
  const usable = (bucket) => finiteNumber(bucket?.used) != null;
  if (summary?.limitType === 'team' && usable(team)) return team;
  if (usable(individual)) return individual;
  if (usable(team)) return team;
  return null;
}

// Third-party model spend stays on the monthly cycle. A reported zero is left
// off: unified personal accounts can show 0 here while the dashboard does not.
function projectApiSpend(summary) {
  const bucket = pickOnDemand(summary);
  const usedCents = finiteNumber(bucket?.used);
  if (usedCents == null || usedCents <= 0) return null;
  return {
    usedCents,
    limitCents: finiteNumber(bucket.limit),
    resetsAt: typeof summary?.billingCycleEnd === 'string' ? summary.billingCycleEnd : null,
  };
}

/**
 * The X Subscription (`isUnified`) is one weekly pool shared by Cursor, Grok,
 * and Grok Bot. `usage-summary` can still describe the previous monthly cycle
 * for those accounts, so included usage comes from sand status instead.
 * Older plans keep Total / Auto / API, plus a separate Grok Bot week.
 */
function projectCursorUsage(summary, sandData) {
  const sand = normalizeSand(sandData);
  if (sand?.isUnified) {
    const usage = {
      unified: true,
      plan: sand.plan,
      percent: sand.percent,
      autoPercent: null,
      apiPercent: null,
      billingCycleEnd: sand.resetsAt,
      grokBot: null,
    };
    const apiSpend = projectApiSpend(summary);
    if (apiSpend) usage.apiSpend = apiSpend;
    return usage;
  }

  const plan = summary?.individualUsage?.plan;
  return {
    unified: false,
    percent: plan?.totalPercentUsed ?? null,
    autoPercent: plan?.autoPercentUsed ?? null,
    apiPercent: plan?.apiPercentUsed ?? null,
    billingCycleEnd: summary?.billingCycleEnd ?? null,
    grokBot: sand?.hasIncluded
      ? { percent: sand.percent, resetsAt: sand.resetsAt }
      : null,
  };
}

async function fetchCursorUsage() {
  const token = await readAccessToken();
  const userId = deriveUserId(token);
  const cookie = `WorkosCursorSessionToken=${userId}%3A%3A${token}`;

  const [summary, sand] = await Promise.all([
    fetch('https://cursor.com/api/usage-summary', {
      headers: { Cookie: cookie },
    }).then(async (res) => {
      if (res.status === 401) {
        throw authExpired('Cursor sign-in expired');
      }
      if (!res.ok) {
        throw new Error(`Cursor usage request failed: ${res.status}`);
      }
      return res.json();
    }),
    fetchSandUsage(cookie),
  ]);

  return projectCursorUsage(summary, sand);
}

module.exports = { fetchCursorUsage, projectCursorUsage };
