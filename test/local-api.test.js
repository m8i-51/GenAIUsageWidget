const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { startLocalApi } = require('../src/local-api');

async function withServer(options, fn) {
  const server = await startLocalApi({ port: 0, version: '1.2.3', ...options });
  const { port } = server.address();
  try {
    await fn(port);
  } finally {
    server.close();
  }
}

// fetch() refuses to override Host, so spoofed-Host requests need http.request.
function get(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: { get: (name) => res.headers[name] ?? null },
        json: async () => JSON.parse(body),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

const providerIds = ['claude', 'codex', 'cursor'];

test('returns usage for the requested providers only', async () => {
  const asked = [];
  const getUsage = async (id) => {
    asked.push(id);
    return { ok: true, usage: { id } };
  };
  await withServer({ providerIds, getUsage }, async (port) => {
    const res = await get(port, '/v1/usage?providers=codex,nope,claude');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('access-control-allow-origin'), null);
    const body = await res.json();
    assert.strictEqual(body.app, 'GenAIUsageWidget');
    assert.strictEqual(body.version, '1.2.3');
    assert.deepStrictEqual(Object.keys(body.providers).sort(), ['claude', 'codex']);
    assert.deepStrictEqual(body.providers.codex, { ok: true, usage: { id: 'codex' } });
    assert.deepStrictEqual(asked.sort(), ['claude', 'codex']);
  });
});

test('returns every provider when none are listed, and reports fetch errors per provider', async () => {
  const getUsage = async (id) => {
    if (id === 'cursor') throw new Error('boom');
    return { ok: true, usage: {} };
  };
  await withServer({ providerIds, getUsage }, async (port) => {
    const body = await (await get(port, '/v1/usage')).json();
    assert.deepStrictEqual(Object.keys(body.providers).sort(), providerIds);
    assert.deepStrictEqual(body.providers.cursor, { ok: false, error: 'boom' });
  });
});

test('rejects requests whose Host is not loopback (DNS rebinding)', async () => {
  await withServer({ providerIds, getUsage: async () => ({ ok: true }) }, async (port) => {
    const res = await get(port, '/v1/usage', { Host: `evil.example:${port}` });
    assert.strictEqual(res.status, 403);
    const local = await get(port, '/v1/usage', { Host: `localhost:${port}` });
    assert.strictEqual(local.status, 200);
  });
});

test('only serves GET /v1/usage', async () => {
  await withServer({ providerIds, getUsage: async () => ({ ok: true }) }, async (port) => {
    assert.strictEqual((await get(port, '/other')).status, 404);
    const post = await fetch(`http://127.0.0.1:${port}/v1/usage`, { method: 'POST' });
    assert.strictEqual(post.status, 405);
  });
});

test('resolves to null instead of throwing when the port is taken', async () => {
  await withServer({ providerIds, getUsage: async () => ({ ok: true }) }, async (port) => {
    const second = await startLocalApi({ port, providerIds, getUsage: async () => ({}), version: 'x', log: () => {} });
    assert.strictEqual(second, null);
  });
});
