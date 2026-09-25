// z.ai / GLM Coding Plan: API-key based, entered in the settings window.
// Quota mapping follows CodexBar's docs/zai.md (MIT).
const { notConfigured } = require('./not-configured');
const secrets = require('../secrets');
const { loadSettings } = require('../settings');

const HOSTS = {
  global: 'https://api.z.ai',
  cn: 'https://open.bigmodel.cn',
};

const DASHBOARDS = {
  global: 'https://z.ai/manage-apikey/coding-plan/personal/my-plan',
  cn: 'https://bigmodel.cn/coding-plan/personal/usage',
};

// Limit `unit` codes → minutes.
const UNIT_MINUTES = { 1: 1440, 3: 60, 5: 1, 6: 10080 };

function readApiKey() {
  const key = secrets.getApiKey('zai') || process.env.Z_AI_API_KEY;
  if (!key) throw notConfigured('No z.ai API key set');
  return key.trim();
}

function region() {
  return loadSettings().zaiRegion === 'cn' ? 'cn' : 'global';
}

function parseLimit(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!['TOKENS_LIMIT', 'CREDIT_LIMIT', 'TIME_LIMIT'].includes(raw.type)) return null;
  if (!Number.isFinite(raw.percentage)) return null;

  let percent = raw.percentage;
  const limit = Number.isFinite(raw.usage) ? raw.usage : null;
  if (limit && limit > 0) {
    let used = null;
    if (Number.isFinite(raw.remaining)) used = limit - raw.remaining;
    else if (Number.isFinite(raw.currentValue)) used = raw.currentValue;
    if (used != null) percent = (Math.max(0, Math.min(limit, used)) / limit) * 100;
  }
  percent = Math.max(0, Math.min(100, Math.round(percent * 10) / 10));

  const windowMinutes = raw.number > 0 && UNIT_MINUTES[raw.unit] ? raw.number * UNIT_MINUTES[raw.unit] : null;
  let resetsAt = Number.isFinite(raw.nextResetTime) ? new Date(raw.nextResetTime).toISOString() : null;
  // A five-hour window cannot reset more than five hours out; drop bad clocks.
  if (resetsAt && windowMinutes === 300 && raw.nextResetTime > Date.now() + (5 * 3600 + 60) * 1000) {
    resetsAt = null;
  }
  return { type: raw.type, percent, resetsAt, windowMinutes };
}

function windowLabel(limit) {
  if (limit.windowMinutes === 300) return '5-hour';
  if (limit.windowMinutes === 10080) return 'Weekly';
  if (limit.windowMinutes === 1440) return 'Daily';
  if (limit.windowMinutes && limit.windowMinutes % 1440 === 0) return `${limit.windowMinutes / 1440}-day`;
  if (limit.windowMinutes && limit.windowMinutes % 60 === 0) return `${limit.windowMinutes / 60}-hour`;
  return 'Quota';
}

function toWindow(limit) {
  return limit ? { percent: limit.percent, resetsAt: limit.resetsAt, label: windowLabel(limit) } : null;
}

async function fetchZaiUsage() {
  const key = readApiKey();
  const res = await fetch(`${HOSTS[region()]}/api/monitor/usage/quota/limit`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const err = new Error(`z.ai usage request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const body = await res.json();
  if (!body || body.success !== true || !Array.isArray(body.data?.limits)) {
    throw new Error(`z.ai usage request failed: ${body?.msg || 'invalid response'}`);
  }

  const limits = body.data.limits.map(parseLimit).filter(Boolean);
  // Coding Plan windows, shortest first: the 5-hour session, then weekly if present.
  const planLimits = limits
    .filter((l) => l.type !== 'TIME_LIMIT')
    .sort((a, b) => (a.windowMinutes ?? Infinity) - (b.windowMinutes ?? Infinity));
  const mcp = limits.filter((l) => l.type === 'TIME_LIMIT').pop() ?? null;

  const mcpWindow = mcp ? { percent: mcp.percent, resetsAt: mcp.resetsAt, label: 'MCP' } : null;
  const data = body.data;
  return {
    plan: data.planName ?? data.plan ?? data.plan_type ?? data.packageName ?? null,
    // With no Coding Plan window, the MCP quota is the headline.
    primary: planLimits.length > 0 ? toWindow(planLimits[0]) : mcpWindow,
    secondary: planLimits.length >= 2 ? toWindow(planLimits[planLimits.length - 1]) : null,
    mcp: planLimits.length > 0 ? mcpWindow : null,
  };
}

function dashboardUrl() {
  return DASHBOARDS[region()];
}

module.exports = { fetchZaiUsage, dashboardUrl };
