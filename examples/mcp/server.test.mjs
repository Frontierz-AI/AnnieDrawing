import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';

function client(args = [], env = {}) {
  const process = spawn(
    globalThis.process.execPath,
    [new URL('./server.mjs', import.meta.url).pathname, ...args],
    {
      env: { ...globalThis.process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  let stdout = '',
    stderr = '',
    nextId = 0;
  const waiting = new Map();
  process.stdout.setEncoding('utf8');
  process.stderr.setEncoding('utf8');
  process.stdout.on('data', (chunk) => {
    stdout += chunk;
    let newline;
    while ((newline = stdout.indexOf('\n')) >= 0) {
      const message = JSON.parse(stdout.slice(0, newline));
      stdout = stdout.slice(newline + 1);
      const waiter = waiting.get(message.id);
      if (waiter) {
        clearTimeout(waiter.timer);
        waiting.delete(message.id);
        waiter.resolve(message);
      }
    }
  });
  process.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  return {
    process,
    request(method, params) {
      const id = ++nextId;
      const promise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout for ${method}. ${stderr}`)), 5000);
        waiting.set(id, { resolve, timer });
      });
      process.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return promise;
    },
    async initialize() {
      return this.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      });
    },
    async bridgeURL() {
      for (let attempt = 0; attempt < 100; attempt++) {
        const match = stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/bridge/);
        if (match) return match[0];
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`No bridge started: ${stderr}`);
    },
    async close() {
      for (const waiter of waiting.values()) clearTimeout(waiter.timer);
      if (process.exitCode === null) {
        process.kill('SIGTERM');
        await once(process, 'exit');
      }
    },
  };
}
const resultJSON = (response) => JSON.parse(response.result.content[0].text);

test('stdio MCP negotiates, validates atomic edits and returns a readable document', async (t) => {
  const c = client();
  t.after(() => c.close());
  assert.equal((await c.request('tools/list')).error.code, -32002);
  const started = await c.initialize();
  assert.equal(started.result.protocolVersion, '2025-06-18');
  assert.deepEqual(started.result.serverInfo, { name: 'anniedrawing-mcp', version: '0.1.0' });
  const tools = (await c.request('tools/list')).result.tools;
  assert.equal(tools.length, 6);
  assert(tools.every((tool) => tool.name && tool.inputSchema?.type === 'object'));
  assert.equal((await c.request('tools/call', { name: 'missing' })).error.code, -32602);
  const applied = resultJSON(
    await c.request('tools/call', {
      name: 'board_apply',
      arguments: {
        ops: [
          {
            op: 'add',
            item: { id: 'i_a', kind: 'rect', text: { value: 'API' } },
          },
          {
            op: 'add',
            item: { id: 'i_b', kind: 'ellipse' },
            place: { rightOf: 'i_a' },
          },
          {
            op: 'add',
            item: {
              id: 'i_link',
              kind: 'connector',
              from: { item: 'i_a' },
              to: { item: 'i_b' },
            },
          },
        ],
        origin: 'agent:test',
      },
    }),
  );
  assert.equal(applied.ok, true);
  assert.deepEqual(applied.created, ['i_a', 'i_b', 'i_link']);
  const rejected = await c.request('tools/call', {
    name: 'board_apply',
    arguments: {
      ops: [
        { op: 'set', id: 'i_a', patch: { x: 900 } },
        { op: 'remove', id: 'i_missing' },
      ],
    },
  });
  assert.equal(rejected.result.isError, true);
  const read = resultJSON(await c.request('tools/call', { name: 'board_read', arguments: {} }));
  assert.equal(read.version, 2);
  assert.equal('sheets' in read, false);
  assert.equal(read.pages[0].items[0].x, 0);
  const describe = await c.request('tools/call', {
    name: 'board_describe',
    arguments: {},
  });
  assert.match(describe.result.content[0].text, /API/);
  const snapshot = await c.request('tools/call', {
    name: 'board_snapshot',
    arguments: {},
  });
  assert.equal(snapshot.result.isError, true);
  assert.match(snapshot.result.content[0].text, /requires --live/);
});

test('headless persistence writes successful commits and skips dry runs', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'annie-mcp-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'test.annie');
  await writeFile(
    path,
    JSON.stringify({
      format: 'anniedrawing',
      version: 2,
      meta: { title: 'Test' },
      pages: [{ id: 'p_main', name: 'Main', items: [] }],
      media: {},
    }),
  );
  const c = client(['--document', path, '--persist']);
  t.after(() => c.close());
  await c.initialize();
  const ops = [{ op: 'add', page: 'p_main', item: { id: 'i_saved', kind: 'note' } }];
  await c.request('tools/call', {
    name: 'board_apply',
    arguments: { ops, dryRun: true },
  });
  assert.equal(JSON.parse(await readFile(path, 'utf8')).pages[0].items.length, 0);
  await c.request('tools/call', { name: 'board_apply', arguments: { ops } });
  assert.equal(JSON.parse(await readFile(path, 'utf8')).pages[0].items[0].id, 'i_saved');
});

test('live bridge rejects a wrong origin/token, forwards calls and reports disconnects', async (t) => {
  const token = randomBytes(32).toString('hex');
  const origin = 'http://localhost:45678';
  const c = client(['--live'], {
    ANNIEDRAWING_BRIDGE_TOKEN: token,
    ANNIEDRAWING_BRIDGE_ORIGIN: origin,
  });
  t.after(() => c.close());
  await c.initialize();
  const url = await c.bridgeURL();
  const forbidden = new WebSocket(url, { origin: 'https://untrusted.example' });
  await new Promise((resolve) => forbidden.once('error', resolve));
  const unauthenticated = new WebSocket(url, { origin });
  await once(unauthenticated, 'open');
  unauthenticated.send(JSON.stringify({ type: 'hello', token: 'incorrect' }));
  const [code] = await once(unauthenticated, 'close');
  assert.equal(code, 1008);
  const malformed = new WebSocket(url, { origin });
  await once(malformed, 'open');
  malformed.send('null');
  assert.equal((await once(malformed, 'close'))[0], 1008);
  const socket = new WebSocket(url, { origin });
  t.after(() => socket.terminate());
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: 'hello', token }));
  assert.equal(JSON.parse((await once(socket, 'message'))[0]).type, 'ready');
  socket.on('message', (raw) => {
    const call = JSON.parse(raw);
    if (call.type === 'call')
      socket.send(
        JSON.stringify({
          type: 'result',
          id: call.id,
          result: `Live ${call.name}`,
        }),
      );
  });
  const response = await c.request('tools/call', {
    name: 'board_describe',
    arguments: {},
  });
  assert.equal(response.result.content[0].text, 'Live board_describe');
  socket.close();
  await once(socket, 'close');
  const disconnected = await c.request('tools/call', {
    name: 'board_read',
    arguments: {},
  });
  assert.equal(disconnected.result.isError, true);
  assert.match(disconnected.result.content[0].text, /No live board connected/);
});

test('headless tools accept canonical page operations and page-scoped queries', async (t) => {
  const c = client();
  t.after(() => c.close());
  await c.initialize();
  const created = resultJSON(
    await c.request('tools/call', {
      name: 'board_apply',
      arguments: {
        ops: [
          { op: 'page.add', page: { id: 'p_plan', name: 'Plan', items: [] } },
          {
            op: 'add',
            page: 'p_plan',
            item: { id: 'i_next', kind: 'note', text: { value: 'Our next step' } },
          },
        ],
      },
    }),
  );
  assert.equal(created.ok, true);
  const query = resultJSON(
    await c.request('tools/call', {
      name: 'board_query',
      arguments: { page: 'p_plan' },
    }),
  );
  assert.deepEqual(
    query.map((item) => item.id),
    ['i_next'],
  );
  const renamed = resultJSON(
    await c.request('tools/call', {
      name: 'board_apply',
      arguments: { ops: [{ op: 'page.set', id: 'p_plan', patch: { name: 'Next steps' } }] },
    }),
  );
  assert.equal(renamed.ok, true);
  const read = resultJSON(await c.request('tools/call', { name: 'board_read', arguments: {} }));
  assert.equal(read.version, 2);
  assert.equal(read.pages.find((page) => page.id === 'p_plan').name, 'Next steps');
  const removed = resultJSON(
    await c.request('tools/call', {
      name: 'board_apply',
      arguments: { ops: [{ op: 'page.remove', id: 'p_plan' }] },
    }),
  );
  assert.equal(removed.ok, true);
  const final = resultJSON(await c.request('tools/call', { name: 'board_read', arguments: {} }));
  assert.equal(
    final.pages.some((page) => page.id === 'p_plan'),
    false,
  );
});

test('legacy version 1 files migrate on read and persist version 2 without losing content', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'annie-mcp-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'legacy.annie');
  const legacy = {
    format: 'anniedrawing',
    version: 1,
    meta: { title: 'Legacy idea' },
    media: {},
    sheets: [
      {
        id: 's_legacy',
        name: 'Keep this name',
        items: [
          { id: 'i_legacy', kind: 'note', x: 11, y: 22, text: { value: 'Keep these words' } },
        ],
      },
    ],
  };
  await writeFile(path, JSON.stringify(legacy));
  const c = client(['--document', path, '--persist']);
  t.after(() => c.close());
  await c.initialize();
  const read = resultJSON(await c.request('tools/call', { name: 'board_read', arguments: {} }));
  assert.equal(read.version, 2);
  assert.equal('sheets' in read, false);
  assert.equal(read.pages[0].id, 's_legacy');
  assert.equal(read.pages[0].name, 'Keep this name');
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), legacy);
  const result = resultJSON(
    await c.request('tools/call', {
      name: 'board_apply',
      arguments: { ops: [{ op: 'meta.set', patch: { title: 'Continued idea' } }] },
    }),
  );
  assert.equal(result.ok, true);
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.version, 2);
  assert.equal('sheets' in saved, false);
  assert.equal(saved.meta.title, 'Continued idea');
  assert.equal(saved.pages[0].id, 's_legacy');
  assert.equal(saved.pages[0].name, 'Keep this name');
  assert.equal(saved.pages[0].items[0].id, 'i_legacy');
  assert.equal(saved.pages[0].items[0].text.value, 'Keep these words');
  assert.equal(saved.pages[0].items[0].x, 11);
  assert.equal(saved.pages[0].items[0].y, 22);
});
