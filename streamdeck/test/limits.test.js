import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

import { PROVIDERS, listLimits, findLimit } from '../src/limits.js';

const require = createRequire(import.meta.url);
const demo = require('../../src/demo-usage.js');

const ids = (providerId, usage) => listLimits(providerId, usage).map((l) => `${l.id}=${l.label}:${l.percent}`);

test('every provider the widget knows has a label', () => {
  assert.deepStrictEqual(Object.keys(PROVIDERS).sort(), [
    'antigravity', 'claude', 'codex', 'copilot', 'cursor', 'gemini', 'kiro', 'windsurf', 'zai',
  ]);
});

test('lists each provider\'s limits from the demo payloads', () => {
  assert.deepStrictEqual(ids('claude', demo.claude().usage), ['session=5h:73', 'week=Week:7']);
  assert.deepStrictEqual(ids('codex', demo.codex().usage), ['primary=5h:21', 'secondary=Week:9']);
  assert.deepStrictEqual(ids('cursor', demo.cursor().usage), ['total=Week:10.2']);
  assert.deepStrictEqual(ids('antigravity', demo.antigravity().usage), ['Gemini/Pro=Pro:34', 'Gemini/Flash=Flash:11']);
  assert.deepStrictEqual(ids('copilot', demo.copilot().usage), ['primary=Premium:38', 'secondary=Chat:12']);
  assert.deepStrictEqual(ids('gemini', demo.gemini().usage), ['primary=Pro:44', 'secondary=Flash:6']);
  assert.deepStrictEqual(ids('windsurf', demo.windsurf().usage), ['primary=Day:64', 'secondary=Week:41']);
  assert.deepStrictEqual(ids('kiro', demo.kiro().usage), ['primary=Credits:27.5', 'secondary=Bonus:12']);
  assert.deepStrictEqual(ids('zai', demo.zai().usage), ['primary=5h:44', 'secondary=Week:18', 'mcp=MCP:6']);
});

test('names Claude\'s model-scoped weekly cap after the model', () => {
  const usage = { ...demo.claude().usage, weekScoped: { percent: 40, resetsAt: null, name: 'Fable' } };
  assert.deepStrictEqual(ids('claude', usage), ['session=5h:73', 'week=Week:7', 'weekScoped=Fable wk:40']);
});

test('covers Cursor\'s legacy plan and a capped API spend', () => {
  const legacy = {
    percent: 52, autoPercent: 48, apiPercent: 12, billingCycleEnd: null,
    grokBot: { percent: 18, resetsAt: null },
    apiSpend: { usedCents: 250, limitCents: 1000, resetsAt: null },
  };
  assert.deepStrictEqual(ids('cursor', legacy), [
    'total=Total:52', 'auto=Auto:48', 'api=API:12', 'grokBot=Grok Bot:18', 'apiSpend=API $:25',
  ]);
});

test('uses Windsurf credit labels on credit plans', () => {
  const usage = { primary: { percent: 10, resetsAt: null }, secondary: { percent: 20, resetsAt: null }, kind: 'credits' };
  assert.deepStrictEqual(ids('windsurf', usage), ['primary=Prompts:10', 'secondary=Flow:20']);
});

test('clamps percents and skips windows without a number', () => {
  const usage = { primary: { percent: 130, resetsAt: null }, secondary: { percent: null, resetsAt: null } };
  assert.deepStrictEqual(ids('codex', usage), ['primary=5h:100']);
});

test('findLimit returns the chosen limit with its reset time, or null', () => {
  const usage = demo.codex().usage;
  const limit = findLimit('codex', 'secondary', usage);
  assert.strictEqual(limit.percent, 9);
  assert.strictEqual(limit.resetsAt, usage.secondary.resetsAt);
  assert.strictEqual(findLimit('codex', 'nope', usage), null);
  assert.strictEqual(findLimit('codex', 'primary', null), null);
});
