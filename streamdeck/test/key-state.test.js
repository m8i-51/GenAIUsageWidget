import test from 'node:test';
import assert from 'node:assert';

import { keyState, closestState } from '../src/key-state.js';

const usage = { primary: { percent: 21, resetsAt: '2026-10-27T16:00:00Z' }, secondary: { percent: 9, resetsAt: null } };

test('uses the chosen limit and labels it with the provider', () => {
  assert.deepStrictEqual(keyState({ provider: 'codex', limit: 'secondary' }, { ok: true, usage }), {
    title: 'Codex · Week', status: 'ok', percent: 9, resetsAt: null, stale: false,
  });
});

test('defaults to the provider\'s first limit and honors a custom label', () => {
  const state = keyState({ provider: 'codex', label: 'Work' }, { ok: true, usage });
  assert.strictEqual(state.title, 'Work');
  assert.strictEqual(state.percent, 21);
});

test('marks last-good data as stale', () => {
  assert.strictEqual(keyState({ provider: 'codex' }, { ok: true, usage, stale: true }).stale, true);
});

test('maps errors to the key messages', () => {
  const status = (payload) => keyState({ provider: 'claude', limit: 'session' }, payload).status;
  assert.strictEqual(status(undefined), 'loading');
  assert.strictEqual(status({ ok: false, notConfigured: true }), 'signin');
  assert.strictEqual(status({ ok: false, authExpired: true }), 'reauth');
  assert.strictEqual(status({ ok: false, needsWidget: true }), 'needsWidget');
  assert.strictEqual(status({ ok: false, error: 'boom' }), 'error');
  assert.strictEqual(status({ ok: true, usage: {} }), 'error');
});

test('titles keys without data from the settings', () => {
  // The Property Inspector saves the chosen limit's label alongside its id.
  assert.strictEqual(keyState({ provider: 'claude', limit: 'session', limitLabel: '5h' }, undefined).title, 'Claude · 5h');
  assert.strictEqual(keyState({ provider: 'cursor' }, undefined).title, 'Cursor');
  assert.strictEqual(keyState({}, undefined).title, 'Claude');
});

test('closest limit picks the highest percent across providers', () => {
  const results = {
    claude: { ok: true, usage: { session: { percent: 40, resetsAt: null }, week: { percent: 12, resetsAt: null } } },
    codex: { ok: true, stale: true, usage: { primary: { percent: 81, resetsAt: 'r' }, secondary: { percent: 30, resetsAt: null } } },
    cursor: { ok: false, notConfigured: true },
  };
  assert.deepStrictEqual(closestState({}, results, ['claude', 'codex', 'cursor']), {
    title: 'Codex · 5h', status: 'ok', percent: 81, resetsAt: 'r', stale: true,
  });
  assert.strictEqual(closestState({ exclude: ['codex'] }, results, ['claude', 'codex', 'cursor']).title, 'Claude · 5h');
});

test('closest limit waits for data and says when nothing is signed in', () => {
  const ids = ['claude', 'codex'];
  assert.strictEqual(closestState({}, {}, ids).status, 'loading');
  assert.strictEqual(closestState({}, { claude: { ok: false, notConfigured: true } }, ids).status, 'loading');
  const none = closestState({}, { claude: { ok: false, notConfigured: true }, codex: { ok: false, error: 'x' } }, ids);
  assert.deepStrictEqual(none, { title: 'Closest limit', status: 'none' });
});
