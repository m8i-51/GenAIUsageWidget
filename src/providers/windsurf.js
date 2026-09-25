const fs = require('fs');
const os = require('os');
const path = require('path');
const initSqlJs = require('sql.js');
const { notConfigured } = require('./not-configured');

// Windsurf caches its plan status here and refreshes it while the app runs.
// There is no local credential for the live API (it lives in the browser),
// so the card can lag until Windsurf is opened again.
const PLAN_INFO_KEY = 'windsurf.settings.cachedPlanInfo';

function getStateDbPath() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA, 'Windsurf', 'User', 'globalStorage', 'state.vscdb');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Windsurf', 'User', 'globalStorage', 'state.vscdb');
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdgConfig, 'Windsurf', 'User', 'globalStorage', 'state.vscdb');
}

// state.vscdb declares value as BLOB; older builds wrote UTF-16.
function decodeValue(value) {
  if (typeof value === 'string') return value;
  if (!value) return null;
  const buf = Buffer.from(value);
  for (const encoding of ['utf8', 'utf16le']) {
    const text = buf.toString(encoding).replace(/^[\u0000-\u001f﻿]+|[\u0000-\u001f]+$/g, '');
    try {
      JSON.parse(text);
      return text;
    } catch {
      // try the next encoding
    }
  }
  return null;
}

async function readPlanInfo() {
  let fileBuffer;
  try {
    fileBuffer = fs.readFileSync(getStateDbPath());
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw notConfigured('Windsurf is not installed on this machine');
    }
    throw err;
  }
  const SQL = await initSqlJs();
  const db = new SQL.Database(fileBuffer);
  const result = db.exec(`SELECT value FROM ItemTable WHERE key = '${PLAN_INFO_KEY}'`);
  db.close();

  const raw = decodeValue(result?.[0]?.values?.[0]?.[0]);
  if (!raw) {
    throw notConfigured('Windsurf is not signed in on this machine');
  }
  return JSON.parse(raw);
}

function unixToIso(seconds) {
  return typeof seconds === 'number' && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

function msToIso(ms) {
  return typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : null;
}

function quotaWindow(remainingPercent, resetAtUnix) {
  if (typeof remainingPercent !== 'number') return null;
  return {
    percent: Math.max(0, Math.min(100, 100 - remainingPercent)),
    resetsAt: unixToIso(resetAtUnix),
  };
}

function countWindow(used, remaining, total, resetsAt) {
  if (typeof total !== 'number' || total <= 0) return null;
  const spent = typeof used === 'number'
    ? used
    : (typeof remaining === 'number' ? total - remaining : null);
  if (spent == null) return null;
  const clamped = Math.max(0, Math.min(total, spent));
  return { percent: (clamped / total) * 100, used: clamped, limit: total, resetsAt };
}

// The cache is only as fresh as the last time Windsurf ran. Once a window's
// reset has passed, nothing can have been spent since, so show it as empty.
function afterReset(window) {
  if (!window?.resetsAt || new Date(window.resetsAt).getTime() > Date.now()) return window;
  return { ...window, percent: 0, used: window.used == null ? undefined : 0, resetsAt: null };
}

async function fetchWindsurfUsage() {
  const info = await readPlanInfo();
  const quota = info.quotaUsage;
  const usage = info.usage;
  const cycleEnd = msToIso(info.endTimestamp);

  // Current plans report daily/weekly quota; older ones count prompt credits.
  let primary = quotaWindow(quota?.dailyRemainingPercent, quota?.dailyResetAtUnix);
  let secondary = quotaWindow(quota?.weeklyRemainingPercent, quota?.weeklyResetAtUnix);
  let kind = 'quota';
  if (!primary && !secondary && usage) {
    kind = 'credits';
    primary = countWindow(usage.usedMessages, usage.remainingMessages, usage.messages, cycleEnd);
    secondary = countWindow(usage.usedFlowActions, usage.remainingFlowActions, usage.flowActions, cycleEnd);
  }

  return {
    primary: afterReset(primary),
    secondary: afterReset(secondary),
    kind,
    plan: info.planName ?? null,
  };
}

module.exports = { fetchWindsurfUsage };
