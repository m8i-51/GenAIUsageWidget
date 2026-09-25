function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function nextWeekdayMidnight(weekday) {
  const d = new Date();
  const add = (weekday - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + add);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function ok(usage) {
  return { ok: true, usage };
}

function claude() {
  return ok({
    session: { percent: 73, resetsAt: minutesFromNow(51) },
    week: { percent: 7, resetsAt: nextWeekdayMidnight(4) },
    weekScoped: null,
  });
}

function codex() {
  return ok({
    primary: { percent: 21, resetsAt: minutesFromNow(4 * 60 + 12) },
    secondary: { percent: 9, resetsAt: nextWeekdayMidnight(1) },
  });
}

function cursor() {
  return ok({
    percent: 52,
    autoPercent: 48,
    apiPercent: 12,
    billingCycleEnd: nextWeekdayMidnight(1),
    grokBot: { percent: 18, resetsAt: nextWeekdayMidnight(1) },
  });
}

function antigravity() {
  return ok({
    groups: [
      {
        name: 'Gemini',
        percent: 34,
        resetsAt: nextWeekdayMidnight(0),
        buckets: [
          { name: 'Pro', percent: 34, resetsAt: nextWeekdayMidnight(0) },
          { name: 'Flash', percent: 11, resetsAt: nextWeekdayMidnight(0) },
        ],
      },
    ],
  });
}

function copilot() {
  const firstOfNextMonth = new Date();
  firstOfNextMonth.setUTCMonth(firstOfNextMonth.getUTCMonth() + 1, 1);
  firstOfNextMonth.setUTCHours(0, 0, 0, 0);
  const resetsAt = firstOfNextMonth.toISOString();
  return ok({
    primary: { percent: 38, resetsAt },
    secondary: { percent: 12, resetsAt },
    plan: 'individual',
  });
}

// Percent gained over the last 40 minutes, so demo cards show a pace forecast
// right away: Claude and Cursor run out before reset, the rest last.
const PACE_GAIN = {
  claude: { session: 30, week: 0 },
  codex: { primary: 2, secondary: 0 },
  cursor: { total: 4, grokBot: 0 },
  antigravity: { 'Gemini/Pro': 0, 'Gemini/Flash': 0 },
  copilot: { primary: 3, secondary: 0 },
};

function seedPace(providerId, result, seedSample) {
  const { meters } = require('./pace');
  const gains = PACE_GAIN[providerId] ?? {};
  const at = Date.now() - 40 * 60 * 1000;
  for (const { key, percent, resetsAt } of meters(providerId, result.usage)) {
    if (key in gains) seedSample(providerId, key, percent - gains[key], resetsAt, at);
  }
}

// One provider mid-incident so the card badge, flyout line and tray dot all show.
const SERVICE_STATUS = {
  codex: {
    level: 'major',
    label: 'Partial outage',
    title: 'Elevated error rates for Codex CLI',
    url: 'https://status.openai.com',
  },
};

function serviceStatus(providerId) {
  return SERVICE_STATUS[providerId] ?? null;
}

module.exports = { claude, codex, cursor, antigravity, copilot, seedPace, serviceStatus };
