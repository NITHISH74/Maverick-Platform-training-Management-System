// Azure Functions Timer Trigger — fires every 30 minutes and POSTs to the Node API,
// which in turn dispatches the FastAPI CrewAI agent. Survives App Service restarts.

const https = require('https');
const http = require('http');

module.exports = async function (context, myTimer) {
  const NODE_API_URL = process.env.NODE_API_URL;
  const INTERNAL_SHARED_SECRET = process.env.INTERNAL_SHARED_SECRET;

  if (!NODE_API_URL || !INTERNAL_SHARED_SECRET) {
    context.log.error('Missing NODE_API_URL or INTERNAL_SHARED_SECRET');
    return;
  }

  const url = new URL('/internal/agent/run', NODE_API_URL);
  const lib = url.protocol === 'https:' ? https : http;
  const body = JSON.stringify({ source: 'azure-functions', ts: new Date().toISOString() });

  await new Promise((resolve) => {
    const req = lib.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-internal-token': INTERNAL_SHARED_SECRET,
      },
      timeout: 90_000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { context.log(`agent trigger ${res.statusCode}: ${data}`); resolve(); });
    });
    req.on('error', (e) => { context.log.error('agent trigger failed', e); resolve(); });
    req.write(body); req.end();
  });
};
