const fs = require('fs');
const os = require('os');
const path = require('path');
const initSqlJs = require('sql.js');

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
  const fileBuffer = fs.readFileSync(dbPath);
  const SQL = await initSqlJs();
  const db = new SQL.Database(fileBuffer);

  const result = db.exec("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'");
  db.close();

  const token = result?.[0]?.values?.[0]?.[0];
  if (!token) {
    throw new Error('cursorAuth/accessToken not found in state.vscdb');
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

async function fetchCursorUsage() {
  const token = await readAccessToken();
  const userId = deriveUserId(token);
  const cookie = `WorkosCursorSessionToken=${userId}%3A%3A${token}`;

  const res = await fetch('https://cursor.com/api/usage-summary', {
    headers: { Cookie: cookie },
  });

  if (!res.ok) {
    throw new Error(`Cursor usage request failed: ${res.status}`);
  }

  const data = await res.json();
  const plan = data.individualUsage?.plan;

  return {
    percent: plan?.totalPercentUsed ?? null,
    billingCycleEnd: data.billingCycleEnd ?? null,
  };
}

module.exports = { fetchCursorUsage };
