const fs = require('fs');
const os = require('os');
const path = require('path');
const initSqlJs = require('sql.js');
const { notConfigured } = require('./not-configured');

// The Kiro IDE and kiro-cli own these tokens and refresh them; we only read.
const IDE_TOKEN_PATH = path.join(os.homedir(), '.aws', 'sso', 'cache', 'kiro-auth-token.json');

const ENDPOINTS = {
  'us-east-1': 'https://codewhisperer.us-east-1.amazonaws.com/',
  'eu-central-1': 'https://q.eu-central-1.amazonaws.com/',
};

function cliDatabasePaths() {
  if (process.env.KIRO_DATA_DIR) {
    return [path.join(process.env.KIRO_DATA_DIR, 'data.sqlite3')];
  }
  if (process.platform === 'win32') {
    return [process.env.LOCALAPPDATA, process.env.APPDATA]
      .filter(Boolean)
      .map((dir) => path.join(dir, 'kiro-cli', 'data.sqlite3'));
  }
  if (process.platform === 'darwin') {
    return [path.join(os.homedir(), 'Library', 'Application Support', 'kiro-cli', 'data.sqlite3')];
  }
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return [path.join(dataHome, 'kiro-cli', 'data.sqlite3')];
}

function readIdeIdentity() {
  let raw;
  try {
    raw = fs.readFileSync(IDE_TOKEN_PATH, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const token = JSON.parse(raw);
  if (!token.accessToken) return null;
  return {
    accessToken: token.accessToken,
    profileArn: token.profileArn ?? null,
    region: token.region ?? null,
    expiresAt: token.expiresAt ?? null,
    source: 'ide',
  };
}

function queryJson(db, sql) {
  const value = db.exec(sql)?.[0]?.values?.[0]?.[0];
  if (value == null) return null;
  try {
    return JSON.parse(typeof value === 'string' ? value : Buffer.from(value).toString('utf8'));
  } catch {
    return null;
  }
}

async function readCliIdentity() {
  for (const dbPath of cliDatabasePaths()) {
    let fileBuffer;
    try {
      fileBuffer = fs.readFileSync(dbPath);
    } catch {
      continue;
    }
    const SQL = await initSqlJs();
    const db = new SQL.Database(fileBuffer);
    try {
      const token = queryJson(db, "SELECT value FROM auth_kv WHERE key = 'kirocli:odic:token'");
      const profile = queryJson(db, "SELECT value FROM state WHERE key = 'api.codewhisperer.profile'");
      if (token?.access_token) {
        return {
          accessToken: token.access_token,
          profileArn: profile?.arn ?? null,
          region: null,
          expiresAt: token.expires_at ?? null,
          source: 'cli',
        };
      }
    } catch {
      // Schema changed or tables missing: treat as not signed in.
    } finally {
      db.close();
    }
  }
  return null;
}

function regionFor(identity) {
  // arn:aws:codewhisperer:<region>:<account>:profile/<id>
  const fromArn = identity.profileArn?.split(':')[3];
  return fromArn || identity.region || 'us-east-1';
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function resetIso(seconds) {
  // Unix seconds; anything else is a unit change, not a date.
  const s = finite(seconds);
  return s != null && s > 1e9 && s < 4.2e9 ? new Date(s * 1000).toISOString() : null;
}

function meter(used, limit, resetsAt) {
  if (used == null || !limit) return null;
  return { percent: Math.min(100, (used / limit) * 100), used, limit, resetsAt };
}

function parseUsageLimits(data) {
  const credit = (data.usageBreakdownList ?? []).find((b) => b.resourceType === 'CREDIT')
    ?? (data.usageBreakdownList ?? [])[0];
  if (!credit) throw new Error('Kiro reported no credit balance');

  const resetsAt = resetIso(credit.nextDateReset ?? data.nextDateReset);
  const limit = finite(credit.usageLimitWithPrecision ?? credit.usageLimit);
  const total = finite(credit.currentUsageWithPrecision ?? credit.currentUsage);
  // currentUsage includes overage; the plan meter shows plan credits only.
  const overage = finite(credit.currentOveragesWithPrecision ?? credit.currentOverages) ?? 0;
  const planUsed = total == null ? null : Math.max(0, total - overage);

  const overageEnabled = String(data.overageConfiguration?.overageStatus ?? '').toUpperCase() === 'ENABLED';
  const overageCap = overageEnabled ? finite(credit.overageCapWithPrecision ?? credit.overageCap) : null;

  const trial = credit.freeTrialInfo;
  const bonus = trial && String(trial.freeTrialStatus ?? 'ACTIVE').toUpperCase() === 'ACTIVE'
    ? meter(
      finite(trial.currentUsageWithPrecision ?? trial.currentUsage),
      finite(trial.usageLimitWithPrecision ?? trial.usageLimit),
      resetIso(trial.freeTrialExpiry),
    )
    : null;

  return {
    primary: meter(planUsed, limit, resetsAt),
    secondary: overageCap ? meter(overage, overageCap, resetsAt) : bonus,
    secondaryKind: overageCap ? 'overage' : (bonus ? 'bonus' : null),
    plan: data.subscriptionInfo?.subscriptionTitle ?? null,
  };
}

async function fetchKiroUsage() {
  const identity = readIdeIdentity() ?? await readCliIdentity();
  if (!identity) {
    throw notConfigured('Kiro is not signed in on this machine');
  }

  const endpoint = ENDPOINTS[regionFor(identity)] ?? ENDPOINTS['us-east-1'];
  const body = identity.profileArn ? { profileArn: identity.profileArn } : {};
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.0',
      'X-Amz-Target': 'AmazonCodeWhispererService.GetUsageLimits',
      Authorization: `Bearer ${identity.accessToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const expired = identity.expiresAt && new Date(identity.expiresAt).getTime() < Date.now();
    const hint = expired ? ' (sign-in expired)' : '';
    throw new Error(`Kiro usage request failed: ${res.status}${hint}`);
  }
  return parseUsageLimits(await res.json());
}

module.exports = { fetchKiroUsage };
