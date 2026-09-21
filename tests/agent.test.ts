import { describe, expect, it } from 'vitest';
import { createDoc } from '../src/core';
import { runTool, toolDefs } from '../src/agent';
describe('agent tools and spatial editing', () => {
  it('creates, queries and describes pages using canonical version-two vocabulary', async () => {
    const doc = createDoc();
    expect(
      await runTool(doc, 'board_apply', {
        ops: [
          { op: 'add', item: { id: 'first', kind: 'note', text: { value: 'First page idea' } } },
          { op: 'page.add', page: { id: 'p_second', name: 'Page 2' } },
          {
            op: 'add',
            page: 'p_second',
            item: { id: 'second', kind: 'note', text: { value: 'Second page idea' } },
          },
        ],
      }),
    ).toMatchObject({ ok: true });
    expect(await runTool(doc, 'board_query', { page: 'p_second' })).toEqual([
      expect.objectContaining({ id: 'second' }),
    ]);
    const description = await runTool(doc, 'board_describe', { scope: 'page', page: 'p_second' });
    expect(description).toContain('Page "Page 2" (p_second)');
    expect(description).toContain('Second page idea');
    expect(description).not.toContain('First page idea');
    expect(await runTool(doc, 'board_read')).toMatchObject({
      version: 2,
      pages: [{ id: 'p_main' }, { id: 'p_second' }],
    });
  });
  it('exports JSON Schemas from the validators and rejects invalid tool input', async () => {
    expect(toolDefs.map((t) => t.name)).toEqual([
      'board_describe',
      'board_read',
      'board_query',
      'board_apply',
      'board_snapshot',
      'board_view_fit',
    ]);
    expect(toolDefs.find((t) => t.name === 'board_apply')!.inputSchema).toHaveProperty(
      'properties.ops',
    );
    expect(toolDefs.find((t) => t.name === 'board_snapshot')!.inputSchema).toMatchObject({
      properties: {
        scope: { default: 'viewport' },
        scale: { default: 2 },
        labels: { default: true },
        colors: { default: 32 },
        maxBytes: { default: 245760 },
      },
    });
    expect(await runTool(createDoc(), 'board_apply', { ops: 'bad' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(await runTool(createDoc(), 'missing', {})).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_TOOL' },
    });
  });
  it('completes an API-cache-database edit as a single tool transaction', async () => {
    const doc = createDoc();
    const result = await runTool(doc, 'board_apply', {
      label: 'Architecture',
      ops: [
        {
          op: 'add',
          item: { id: 'api', kind: 'rect', x: 0, y: 0, w: 160, h: 100, text: { value: 'API' } },
        },
        {
          op: 'add',
          item: {
            id: 'cache',
            kind: 'rect',
            w: 160,
            h: 100,
            text: { value: 'Cache' },
            data: { owner: 'platform' },
          },
          place: { rightOf: 'api', gap: 60 },
        },
        {
          op: 'add',
          item: { id: 'db', kind: 'ellipse', w: 160, h: 100, text: { value: 'Database' } },
          place: { rightOf: 'cache', gap: 60 },
        },
        {
          op: 'add',
          item: {
            id: 'reads',
            kind: 'connector',
            from: { item: 'api' },
            to: { item: 'cache' },
            text: { value: 'reads' },
          },
        },
        {
          op: 'add',
          item: { id: 'stores', kind: 'connector', from: { item: 'cache' }, to: { item: 'db' } },
        },
      ],
    });
    expect(result).toMatchObject({ ok: true, created: ['api', 'cache', 'db', 'reads', 'stores'] });
    expect(doc.get('cache')!.x).toBe(220);
    expect(doc.get('db')!.x).toBe(440);
    expect(doc.query({ connectedTo: 'cache', direction: 'out' }).map((i) => i.id)).toEqual([
      'stores',
    ]);
    expect(
      doc.query({ kind: 'rect', text: /cache/i, data: { owner: 'platform' } }).map((i) => i.id),
    ).toEqual(['cache']);
    expect(doc.query({ within: { x: 200, y: 0, w: 200, h: 200 } }).map((i) => i.id)).toEqual([
      'cache',
    ]);
    expect(await runTool(doc, 'board_snapshot')).toMatchObject({
      ok: false,
      error: { code: 'BROWSER_REQUIRED' },
    });
    expect(doc.undo({ origin: 'agent:tool' })).toBe(true);
    expect(doc.query()).toEqual([]);
  });
  it('places a second copy when the same create ids are reused', async () => {
    const doc = createDoc();
    const ops = [
      { op: 'add' as const, item: { id: 'api', kind: 'rect', x: 0, y: 0, w: 160, h: 100 } },
      {
        op: 'add' as const,
        item: { id: 'cache', kind: 'rect', w: 160, h: 100 },
        place: { rightOf: 'api', gap: 60 },
      },
      {
        op: 'add' as const,
        item: { id: 'link', kind: 'connector', from: { item: 'api' }, to: { item: 'cache' } },
      },
    ];
    expect(await runTool(doc, 'board_apply', { ops })).toMatchObject({
      ok: true,
      created: ['api', 'cache', 'link'],
    });
    const retry = await runTool(doc, 'board_apply', { ops });
    expect(retry).toMatchObject({
      ok: true,
      created: ['api_1', 'cache_1', 'link_1'],
    });
    expect(doc.get('link_1')).toMatchObject({
      from: { item: 'api_1' },
      to: { item: 'cache_1' },
    });
  });
  it('prevents callers from bypassing agent safety by claiming user origin', async () => {
    const doc = createDoc();
    const result = await runTool(doc, 'board_apply', {
      origin: 'user',
      ops: [
        {
          op: 'media.set',
          id: 'm',
          media: { mime: 'image/png', w: 10, h: 10, src: 'https://untrusted.example/a.png' },
        },
      ],
    });
    expect(result).toMatchObject({ ok: false });
  });
  it('forwards an optional visiting-cursor name on apply', async () => {
    const doc = createDoc();
    const apply = doc.apply.bind(doc);
    let seen: { agentName?: string } | undefined;
    doc.apply = (ops, options) => {
      seen = options;
      return apply(ops, options);
    };
    expect(
      await runTool(doc, 'board_apply', {
        ops: [{ op: 'add', item: { kind: 'note' } }],
        agentName: 'planner',
      }),
    ).toMatchObject({ ok: true });
    expect(seen).toMatchObject({ agentName: 'planner', origin: 'agent:tool' });
  });
  it('places inside free group slots and combines AND queries', () => {
    const doc = createDoc();
    const result = doc.apply([
      { op: 'add', item: { id: 'f', kind: 'group', x: 0, y: 0, w: 500, h: 400, children: [] } },
      {
        op: 'add',
        item: { id: 'a', kind: 'rect', w: 100, h: 80, text: { value: 'Hello' } },
        place: { inside: 'f', gap: 20 },
      },
      {
        op: 'add',
        item: { id: 'b', kind: 'note', w: 100, h: 80, text: { value: 'Hello again' } },
        place: { inside: 'f', gap: 20 },
      },
    ]);
    expect(result.ok).toBe(true);
    expect(doc.get('a')).toMatchObject({ x: 20, y: 20 });
    expect(doc.get('b')).toMatchObject({ x: 140, y: 20 });
    expect(doc.query({ inside: 'f', kind: 'note', text: 'hello' }).map((i) => i.id)).toEqual(['b']);
  });
  it('produces stable readable descriptions, limits output and reports free space', () => {
    const doc = createDoc();
    doc.apply([
      {
        op: 'add',
        item: {
          id: 'b',
          kind: 'ellipse',
          x: 300,
          y: 0,
          w: 100,
          h: 80,
          text: { value: 'Database' },
        },
      },
      {
        op: 'add',
        item: {
          id: 'a',
          kind: 'rect',
          x: 0,
          y: 0,
          w: 100,
          h: 80,
          text: { value: 'API' },
          data: { owner: 'platform' },
        },
      },
      {
        op: 'add',
        item: {
          id: 'c',
          kind: 'connector',
          from: { item: 'a' },
          to: { item: 'b' },
          text: { value: 'reads' },
        },
      },
    ]);
    const text = doc.describe({ detail: 'full', relations: true, freeSpace: true });
    expect(text).toContain('a rect "API" at (0,0) 100×80 [data.owner="platform"]');
    expect(text).toContain('a → b "reads" (straight)');
    expect(text).toContain('gap 200');
    expect(text).toContain('Free space:');
    expect(doc.describe({ maxItems: 1 })).toContain('2 more items');
    expect(text).toBe(doc.describe({ detail: 'full', relations: true, freeSpace: true }));
  });
  it('orders items forward and backward', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'add', item: { id: 'a', kind: 'rect', x: 0, y: 0, w: 40, h: 40 } },
      { op: 'add', item: { id: 'b', kind: 'rect', x: 60, y: 0, w: 40, h: 40 } },
      { op: 'add', item: { id: 'c', kind: 'rect', x: 120, y: 0, w: 40, h: 40 } },
    ]);
    expect(doc.apply([{ op: 'order', id: 'a', to: 'forward' }]).ok).toBe(true);
    expect(doc.toJSON({ compact: false }).pages[0].items.map((item) => item.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
    expect(doc.apply([{ op: 'order', id: 'c', to: 'backward' }]).ok).toBe(true);
    expect(doc.toJSON({ compact: false }).pages[0].items.map((item) => item.id)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });
});

it('assigns stable varied agent fills across batches and nested groups, preserving explicit styles', () => {
  const doc = createDoc();
  doc.apply([{ op: 'add', item: { id: 'first', kind: 'rect' } }], { origin: 'agent:test' });
  doc.apply(
    [
      {
        op: 'add',
        item: {
          id: 'group',
          kind: 'group',
          children: [
            { id: 'second', kind: 'ellipse' },
            { id: 'third', kind: 'diamond' },
            { id: 'fourth', kind: 'note' },
            { id: 'explicit', kind: 'rect', style: { fill: 'red', fillMode: 'solid' } },
            { id: 'hollow', kind: 'rect', style: { fill: 'none' } },
          ],
        },
      },
    ],
    { origin: 'agent:test' },
  );
  const fills = ['first', 'second', 'third', 'fourth'].map((id) => doc.get(id)!.style!.fill);
  expect(new Set(fills).size).toBe(4);
  for (const id of ['first', 'second', 'third', 'fourth'])
    expect(doc.get(id)!.style!.fillMode).toBe('tint');
  expect(doc.get('explicit')!.style).toMatchObject({ fill: 'rose', fillMode: 'solid' });
  expect(doc.get('hollow')!.style!.fill).toBe('none');
  const snapshot = doc.toJSON();
  doc.undo({ origin: 'agent:test' });
  doc.redo();
  expect(doc.toJSON()).toEqual(snapshot);
  expect(createDoc(snapshot).toJSON()).toEqual(snapshot);
  doc.apply([{ op: 'set', id: 'first', patch: { text: { value: 'Updated' } } }], {
    origin: 'agent:test',
  });
  expect(doc.get('first')!.style!.fill).toBe(fills[0]);
});

it('leaves non-agent creation and imported default colors unchanged', () => {
  const doc = createDoc();
  doc.apply([{ op: 'add', item: { id: 'manual', kind: 'rect' } }]);
  expect(doc.get('manual')!.style?.fill).toBeUndefined();
  expect(createDoc(doc.toJSON()).get('manual')!.style?.fill).toBeUndefined();
});
