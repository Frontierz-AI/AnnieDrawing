import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const vite = await createServer({
  root,
  configFile: new URL('../../vite.demo.config.ts', import.meta.url).pathname,
  server: { host: '127.0.0.1', port: 0 },
});
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
const token = randomBytes(32).toString('hex');
const server = spawn(
  process.execPath,
  [new URL('./server.mjs', import.meta.url).pathname, '--live'],
  {
    cwd: root,
    env: {
      ...process.env,
      ANNIEDRAWING_BRIDGE_TOKEN: token,
      ANNIEDRAWING_BRIDGE_ORIGIN: origin,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  },
);
let buffer = '',
  stderr = '',
  nextId = 0;
const requests = new Map();
server.stdout.setEncoding('utf8');
server.stderr.setEncoding('utf8');
server.stderr.on('data', (chunk) => {
  stderr += chunk;
});
server.stdout.on('data', (chunk) => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const response = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const request = requests.get(response.id);
    if (request) {
      clearTimeout(request.timer);
      requests.delete(response.id);
      request.resolve(response);
    }
  }
});
function request(method, params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP ${method} timed out. ${stderr}`)), 20000);
    requests.set(id, { resolve, timer });
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}
let browser;
try {
  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'browser-smoke', version: '1' },
  });
  for (let attempt = 0; attempt < 100 && !stderr.includes('/bridge'); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  const url = stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/bridge/)?.[0];
  assert(url, 'Live bridge should announce its randomly allocated URL');
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => window.__anniedrawing?.length);
  await page.evaluate(
    async ({ url, token }) => {
      const board = window.__anniedrawing[0];
      await board.ready;
      const { attachLiveBridge } = await import('/examples/mcp/bridge.mjs');
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Browser authentication timed out')), 5000);
        window.disconnectAnnieBridge = attachLiveBridge(board, {
          url,
          token,
          onStatus(status) {
            if (status === 'connected') {
              clearTimeout(timer);
              resolve();
            }
          },
        });
      });
    },
    { url, token },
  );
  const applied = await request('tools/call', {
    name: 'board_apply',
    arguments: {
      origin: 'agent:smoke',
      label: 'Live integration check',
      ops: [
        {
          op: 'add',
          item: {
            id: 'i_mcp_live',
            kind: 'note',
            x: 80,
            y: 100,
            text: { value: 'Edited through MCP' },
          },
        },
      ],
    },
  });
  assert.equal(JSON.parse(applied.result.content[0].text).ok, true);
  assert.equal(
    await page.evaluate(() => window.__anniedrawing[0].get('i_mcp_live').text.value),
    'Edited through MCP',
  );
  await request('tools/call', {
    name: 'board_view_fit',
    arguments: { ids: ['i_mcp_live'] },
  });
  const snapshot = await request('tools/call', {
    name: 'board_snapshot',
    arguments: { labels: true },
  });
  assert.equal(snapshot.result.content[0].type, 'image');
  assert.equal(snapshot.result.content[0].mimeType, 'image/png');
  assert(
    Buffer.from(snapshot.result.content[0].data, 'base64')
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  );
  await page.evaluate(() => window.disconnectAnnieBridge());
  console.log(
    'Live MCP browser passed: authenticated connection, real atomic edit, camera tool and PNG snapshot.',
  );
} finally {
  for (const entry of requests.values()) clearTimeout(entry.timer);
  await browser?.close();
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await once(server, 'exit');
  }
  await vite.close();
}
