import test from 'node:test';
import assert from 'node:assert';

import { createUsageSource } from '../src/usage-source.js';

function widgetResponse(body, status = 200) {
  return async () => ({ ok: status === 200, status, json: async () => body });
}

test('reads from the widget when it answers, without fetching locally', async () => {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(url);
    assert.ok(init.signal, 'request has a timeout');
    return widgetResponse({ app: 'GenAIUsageWidget', providers: { claude: { ok: true, usage: { a: 1 } } } })();
  };
  const localFetch = async () => assert.fail('should not fetch locally');
  const source = createUsageSource({ fetchImpl, localFetch });

  const { via, results } = await source.get(['claude']);
  assert.strictEqual(via, 'widget');
  assert.deepStrictEqual(results.claude, { ok: true, usage: { a: 1 } });
  assert.deepStrictEqual(urls, ['http://127.0.0.1:47821/v1/usage?providers=claude']);
});

test('falls back to local fetching when the widget is not running', async () => {
  const fetchImpl = async () => { throw new TypeError('fetch failed'); };
  const asked = [];
  const localFetch = async (id) => {
    asked.push(id);
    return { ok: true, usage: { id } };
  };
  const source = createUsageSource({ fetchImpl, localFetch });

  const { via, results } = await source.get(['codex', 'cursor']);
  assert.strictEqual(via, 'local');
  assert.deepStrictEqual(asked, ['codex', 'cursor']);
  assert.deepStrictEqual(results.cursor, { ok: true, usage: { id: 'cursor' } });
});

test('ignores something else listening on the port', async () => {
  const source = createUsageSource({
    fetchImpl: widgetResponse({ hello: 'world' }),
    localFetch: async () => ({ ok: true, usage: {} }),
  });
  assert.strictEqual((await source.get(['claude'])).via, 'local');
});

test('falls back when the widget answers with an error status', async () => {
  const source = createUsageSource({
    fetchImpl: widgetResponse({ error: 'forbidden' }, 403),
    localFetch: async () => ({ ok: true, usage: {} }),
  });
  assert.strictEqual((await source.get(['claude'])).via, 'local');
});

test('reports a local fetch that throws as an error result', async () => {
  const source = createUsageSource({
    fetchImpl: async () => { throw new Error('down'); },
    localFetch: async () => { throw new Error('boom'); },
  });
  const { results } = await source.get(['kiro']);
  assert.deepStrictEqual(results.kiro, { ok: false, error: 'boom' });
});

test('asks for nothing when no keys are visible', async () => {
  const source = createUsageSource({
    fetchImpl: async () => assert.fail('no request'),
    localFetch: async () => assert.fail('no request'),
  });
  assert.deepStrictEqual(await source.get([]), { via: null, results: {} });
});
