const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cache = require('../src/usage-cache');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-cache-'));
cache.setDataDir(dir);

test('works outside Electron once a data dir is set', async () => {
  const result = await cache.fetchWithCache('codex', async () => ({ primary: { percent: 12 } }));
  assert.deepStrictEqual(result, { ok: true, usage: { primary: { percent: 12 } } });
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'last-good-codex.json'), 'utf8'));
  assert.deepStrictEqual(saved.usage, { primary: { percent: 12 } });
});

test('serves the last good snapshot from the data dir as stale when a fetch fails', async () => {
  fs.writeFileSync(path.join(dir, 'last-good-kiro.json'), JSON.stringify({ usage: { primary: { percent: 5 } }, at: 1 }));
  const result = await cache.fetchWithCache('kiro', async () => {
    const err = new Error('rate limited');
    err.status = 429;
    throw err;
  });
  assert.strictEqual(result.stale, true);
  assert.deepStrictEqual(result.usage, { primary: { percent: 5 } });
});
