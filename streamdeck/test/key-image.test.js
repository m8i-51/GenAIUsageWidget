import test from 'node:test';
import assert from 'node:assert';

import { renderKey, formatReset, COLORS } from '../src/key-image.js';

const NOW = Date.parse('2026-10-27T12:00:00Z');
const at = (minutes) => new Date(NOW + minutes * 60 * 1000).toISOString();
// Text in drawing order: the label is drawn last so it sits on top of the fill.
const text = (svg) => svg.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('formats the time until reset compactly', () => {
  assert.strictEqual(formatReset(at(42), NOW), '42m');
  assert.strictEqual(formatReset(at(134), NOW), '2h14m');
  assert.strictEqual(formatReset(at(60), NOW), '1h00m');
  assert.strictEqual(formatReset(at(3 * 24 * 60 + 4 * 60 + 30), NOW), '3d 4h');
  assert.strictEqual(formatReset(at(-5), NOW), null);
  assert.strictEqual(formatReset(null, NOW), null);
});

test('fills the key from the bottom by the percent used', () => {
  const svg = renderKey({ title: 'Claude · 5h', status: 'ok', percent: 25, now: NOW });
  assert.match(svg, /<rect id="fill" x="0" y="108" width="144" height="36"/);
  assert.strictEqual(text(svg), '25 % Claude · 5h');
});

test('colors the level with the widget thresholds', () => {
  const color = (percent) => renderKey({ title: 't', status: 'ok', percent, now: NOW }).match(/id="level"[^>]*fill="([^"]+)"/)[1];
  assert.strictEqual(color(44), COLORS.ok);
  assert.strictEqual(color(45), COLORS.warning);
  assert.strictEqual(color(70), COLORS.critical);
});

test('shows the reset countdown in reset view, localized', () => {
  const key = { title: 'Codex · Week', status: 'ok', percent: 50, resetsAt: at(134), view: 'reset', now: NOW };
  assert.strictEqual(text(renderKey(key)), '2h14m to reset Codex · Week');
  assert.strictEqual(text(renderKey({ ...key, lang: 'ja' })), '2h14m でリセット Codex · Week');
  assert.strictEqual(text(renderKey({ ...key, resetsAt: null })), '— to reset Codex · Week');
});

test('dims stale data and marks it with a clock', () => {
  const svg = renderKey({ title: 't', status: 'ok', percent: 50, stale: true, now: NOW });
  assert.match(svg, /id="stale"/);
  assert.match(svg, /<g opacity="0.5">/);
  assert.doesNotMatch(renderKey({ title: 't', status: 'ok', percent: 50, now: NOW }), /id="stale"/);
});

test('explains keys without numbers', () => {
  const message = (status, lang) => text(renderKey({ title: 'Claude · 5h', status, now: NOW, lang }));
  assert.strictEqual(message('signin'), 'Sign in Claude · 5h');
  assert.strictEqual(message('signin', 'ja'), '未ログイン Claude · 5h');
  assert.strictEqual(message('reauth'), 'Sign in again Claude · 5h');
  assert.strictEqual(message('needsWidget'), 'Needs widget Claude · 5h');
  assert.strictEqual(message('error'), '— Claude · 5h');
  assert.strictEqual(message('loading'), '… Claude · 5h');
});

test('escapes the title and shrinks long ones to fit', () => {
  const svg = renderKey({ title: 'A&B <x> Antigravity · Flash', status: 'loading', now: NOW });
  assert.match(svg, /A&amp;B &lt;x&gt;/);
  const size = Number(svg.match(/id="title"[^>]*font-size="([\d.]+)"/)[1]);
  assert.ok(size < 16 && size >= 9, `font size ${size}`);
});

test('says when no provider is signed in', () => {
  assert.strictEqual(text(renderKey({ title: 'Closest limit', status: 'none', now: NOW })), 'No sign-ins Closest limit');
  assert.strictEqual(text(renderKey({ title: 'Closest limit', status: 'none', now: NOW, lang: 'ja' })), 'サインインなし Closest limit');
});

test('breaks the level line around the label so it never strikes through it', () => {
  const svg = renderKey({ title: 'Codex · 5h', status: 'ok', percent: 81, now: NOW });
  const segments = [...svg.matchAll(/<rect id="level[^"]*" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)]
    .map((m) => [Number(m[1]), Number(m[1]) + Number(m[2])]);
  assert.strictEqual(segments.length, 2);
  assert.strictEqual(segments[0][0], 0);
  assert.strictEqual(segments[1][1], 144);
  assert.ok(segments[0][1] < 40 && segments[1][0] > 104, JSON.stringify(segments));
  // Below the label the line is one piece.
  assert.strictEqual([...renderKey({ title: 'Codex · 5h', status: 'ok', percent: 50, now: NOW }).matchAll(/id="level/g)].length, 1);
});
