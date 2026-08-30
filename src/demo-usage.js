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

module.exports = { claude, codex, cursor, antigravity };
