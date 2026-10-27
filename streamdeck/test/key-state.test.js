import test from 'node:test';
import assert from 'node:assert';

import { keyState } from '../src/key-state.js';

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
