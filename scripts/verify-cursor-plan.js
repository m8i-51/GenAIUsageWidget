/**
 * Cursor usage projection: The X Subscription's shared weekly pool vs legacy plans.
 * Run: node scripts/verify-cursor-plan.js
 */
const assert = require('node:assert/strict');
const { projectCursorUsage } = require('../src/providers/cursor');

// Same-account responses captured 2026-10-16 (CodexBar issue 4545). Identifiers removed.
const unifiedSummary = {
  billingCycleStart: '2026-10-01T00:00:00.000Z',
  billingCycleEnd: '2026-11-01T00:00:00.000Z',
  membershipType: 'enterprise',
  limitType: 'team',
  isUnlimited: false,
  individualUsage: {
    plan: {
      enabled: true,
      used: 4615,
      limit: 4615,
      remaining: 0,
      breakdown: { included: 4615, bonus: 2288, total: 6903 },
      autoPercentUsed: 62.860238353196095,
      apiPercentUsed: 0,
      totalPercentUsed: 100,
    },
    onDemand: { enabled: true, used: 447, limit: null, remaining: null },
  },
  teamUsage: {
    onDemand: { enabled: true, used: 447, limit: 0, remaining: 0 },
  },
};

const unifiedSand = {
  currentPeriodStart: '2026-10-15T10:27:36.178Z',
  nextResetTimestampUtc: '2026-10-22T10:27:36.178Z',
  usagePercent: 10.205850487540628,
  hasAvailableUsage: true,
  hasNonZeroIncludedLimit: true,
  grokPlanLabel: 'Grok Bot Plan',
  cursorPlanName: 'Premium',
  isUnified: true,
  billingBrand: 'SAND_BILLING_BRAND_GROK',
};

const legacySummary = {
  billingCycleEnd: '2026-11-01T00:00:00.000Z',
  limitType: 'user',
  individualUsage: {
    plan: {
      totalPercentUsed: 40,
      autoPercentUsed: 28,
      apiPercentUsed: 12,
    },
    onDemand: { enabled: true, used: 500, limit: 2000, remaining: 1500 },
  },
};

const legacySand = {
  usagePercent: 18,
  nextResetTimestampUtc: '2026-10-20T00:00:00.000Z',
  hasNonZeroIncludedLimit: true,
  grokPlanLabel: 'Grok Bot Plan',
};

function assertUnifiedIgnoresStaleMonthlyCycle() {
  const usage = projectCursorUsage(unifiedSummary, unifiedSand);
  assert.equal(usage.unified, true);
  assert.equal(usage.plan, 'Premium');
  assert.equal(usage.percent, 10.205850487540628);
  assert.equal(usage.billingCycleEnd, '2026-10-22T10:27:36.178Z');
  assert.equal(usage.autoPercent, null);
  assert.equal(usage.apiPercent, null);
  assert.equal(usage.grokBot, null);
  assert.deepEqual(usage.apiSpend, {
    usedCents: 447,
    limitCents: 0,
    resetsAt: '2026-11-01T00:00:00.000Z',
  });
  console.log('ok - unified weekly pool replaces the stale monthly total');
}

function assertLegacyKeepsSeparateGrokBot() {
  const usage = projectCursorUsage(legacySummary, legacySand);
  assert.equal(usage.unified, false);
  assert.equal(usage.percent, 40);
  assert.equal(usage.autoPercent, 28);
  assert.equal(usage.apiPercent, 12);
  assert.equal(usage.billingCycleEnd, '2026-11-01T00:00:00.000Z');
  assert.deepEqual(usage.grokBot, {
    percent: 18,
    resetsAt: '2026-10-20T00:00:00.000Z',
  });
  assert.equal(usage.apiSpend, undefined);
  console.log('ok - legacy plan keeps Total/Auto/API and a separate Grok Bot week');
}

function assertBillingBrandAloneDoesNotSwitch() {
  const usage = projectCursorUsage(unifiedSummary, { ...unifiedSand, isUnified: false });
  assert.equal(usage.unified, false);
  assert.equal(usage.percent, 100);
  assert.equal(usage.grokBot.percent, unifiedSand.usagePercent);
  console.log('ok - billing brand without isUnified stays on the legacy card');
}

function assertMissingSandPercentDoesNotUseStaleTotal() {
  const usage = projectCursorUsage(unifiedSummary, { ...unifiedSand, usagePercent: null });
  assert.equal(usage.unified, true);
  assert.equal(usage.percent, null);
  assert.notEqual(usage.percent, 100);
  console.log('ok - unified account without a sand percent does not show the old 100%');
}

function assertZeroOnDemandIsOmitted() {
  const summary = {
    ...unifiedSummary,
    individualUsage: {
      ...unifiedSummary.individualUsage,
      onDemand: { enabled: true, used: 0, limit: null },
    },
    teamUsage: { onDemand: { enabled: true, used: 0, limit: 1000 } },
  };
  const usage = projectCursorUsage(summary, unifiedSand);
  assert.equal(usage.apiSpend, undefined);
  console.log('ok - a reported zero spend is not shown as an empty API meter');
}

function assertPersonalSpendUsesIndividualBucket() {
  const summary = {
    billingCycleEnd: '2026-11-01T00:00:00.000Z',
    limitType: 'user',
    individualUsage: {
      plan: { totalPercentUsed: 100 },
      onDemand: { enabled: true, used: 725, limit: 1000 },
    },
  };
  const usage = projectCursorUsage(summary, unifiedSand);
  assert.deepEqual(usage.apiSpend, {
    usedCents: 725,
    limitCents: 1000,
    resetsAt: '2026-11-01T00:00:00.000Z',
  });
  console.log('ok - personal unified spend uses the individual on-demand bucket');
}

function assertNoSandLeavesLegacyUntouched() {
  const usage = projectCursorUsage(legacySummary, null);
  assert.equal(usage.unified, false);
  assert.equal(usage.percent, 40);
  assert.equal(usage.grokBot, null);
  console.log('ok - a failed sand read still shows the monthly plan');
}

assertUnifiedIgnoresStaleMonthlyCycle();
assertLegacyKeepsSeparateGrokBot();
assertBillingBrandAloneDoesNotSwitch();
assertMissingSandPercentDoesNotUseStaleTotal();
assertZeroOnDemandIsOmitted();
assertPersonalSpendUsesIndividualBucket();
assertNoSandLeavesLegacyUntouched();
console.log('cursor plan projection ok');
