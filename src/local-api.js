/**
 * Read-only usage feed on 127.0.0.1 for companions such as the Stream Deck
 * plugin. It serves the same cached results the cards show, so a companion
 * polling it never adds provider API calls, and it never returns credentials.
 */
const http = require('http');

const LOCAL_API_PORT = 47821;

/**
 * @param {object} options
 * @param {number} [options.port]
 * @param {string[]} options.providerIds
 * @param {(providerId: string) => Promise<object>} options.getUsage
 * @param {string} options.version
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<http.Server | null>} null when the port is unavailable
 */
function startLocalApi({ port = LOCAL_API_PORT, providerIds, getUsage, version, log = console.warn }) {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      log(`Local API request failed: ${err.message}`);
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
    });
  });

  async function handle(req, res) {
    // A page on another site can resolve its own hostname to 127.0.0.1; it
    // still sends its own Host header, so only answer loopback names.
    const boundPort = server.address().port;
    const allowedHosts = [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`];
    if (!allowedHosts.includes(req.headers.host)) {
      send(res, 403, { error: 'forbidden' });
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname !== '/v1/usage') {
      send(res, 404, { error: 'not found' });
      return;
    }
    if (req.method !== 'GET') {
      send(res, 405, { error: 'method not allowed' });
      return;
    }

    const requested = url.searchParams.get('providers');
    const ids = requested
      ? providerIds.filter((id) => requested.split(',').includes(id))
      : providerIds;
    const results = await Promise.all(ids.map((id) => (
      Promise.resolve().then(() => getUsage(id)).catch((err) => ({ ok: false, error: err.message }))
    )));
    const providers = Object.fromEntries(ids.map((id, i) => [id, results[i]]));
    send(res, 200, { app: 'GenAIUsageWidget', version, at: new Date().toISOString(), providers });
  }

  return new Promise((resolve) => {
    server.once('error', (err) => {
      log(`Local API not started on 127.0.0.1:${port}: ${err.message}`);
      resolve(null);
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

module.exports = { startLocalApi, LOCAL_API_PORT };
