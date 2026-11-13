import { describe, expect, it } from 'vitest';
import { createDoc } from '../src/core';
import { runTool } from '../src/agent';
import type { NewItem } from '../src/core/types';

const rect = (id: string, x = 0, extra: Partial<NewItem> = {}): NewItem => ({
  id,
  kind: 'rect',
  x,
  y: 0,
  w: 100,
  h: 80,
  ...extra,
});

describe('ApplyResult updated and removed', () => {
  it('reports created, updated, and removed ids as arrays on every result', () => {
    const doc = createDoc();
    const first = doc.apply([{ op: 'add', item: rect('a') }]);
    expect(first).toMatchObject({ ok: true, created: ['a'], updated: [], removed: [] });
    doc.apply([{ op: 'add', item: rect('b', 200) }]);
    const result = doc.apply([
      { op: 'set', id: 'a', patch: { x: 10 } },
      { op: 'order', id: 'b', to: 'back' },
      { op: 'remove', id: 'b' },
      { op: 'add', item: rect('c', 400) },
    ]);
    expect(result).toMatchObject({ ok: true, created: ['c'], updated: ['a'], removed: ['b'] });
    const failed = doc.apply([{ op: 'remove', id: 'missing' }]);
    expect(failed).toMatchObject({ ok: false, created: [], updated: [], removed: [] });
  });

  it('lists descendants of a removed group and children dropped by a children set', () => {
    const doc = createDoc();
    doc.apply([
      {
        op: 'add',
        item: {
          id: 'g',
          kind: 'group',
          x: 0,
          y: 0,
          w: 300,
          h: 100,
          children: [rect('g1'), rect('g2', 150)],
        },
      },
      {
        op: 'add',
        item: {
          id: 'h',
          kind: 'group',
          x: 0,
          y: 300,
          w: 300,
          h: 100,
          children: [rect('h1'), rect('h2', 150)],
        },
      },
    ]);
    const removed = doc.apply([{ op: 'remove', id: 'g' }]);
    expect(removed.removed.sort()).toEqual(['g', 'g1', 'g2']);
    expect(removed.updated).toEqual([]);
    const replaced = doc.apply([{ op: 'set', id: 'h', patch: { children: [rect('h3')] } }]);
    expect(replaced.created).toEqual(['h3']);
    expect(replaced.removed.sort()).toEqual(['h1', 'h2']);
    expect(replaced.updated).toEqual(['h']);
  });

  it('counts created-then-edited as created only and created-then-removed as neither', () => {
    const doc = createDoc();
    const result = doc.apply([
      { op: 'add', item: rect('a') },
      { op: 'set', id: 'a', patch: { x: 50 } },
      { op: 'add', item: rect('temp', 300) },
      { op: 'remove', id: 'temp' },
    ]);
    expect(result).toMatchObject({ created: ['a'], updated: [], removed: [] });
    expect(doc.get('temp')).toBeUndefined();
  });

  it('reports reparent and order, detached connectors, and skips no-op sets', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'add', item: rect('a') },
      { op: 'add', item: rect('b', 300) },
      { op: 'add', item: { id: 'g', kind: 'group', x: 0, y: 300, w: 200, h: 100, children: [] } },
      { op: 'add', item: { id: 'c', kind: 'connector', from: { item: 'a' }, to: { item: 'b' } } },
    ]);
    const result = doc.apply([
      { op: 'set', id: 'a', patch: { x: 0 } },
      { op: 'reparent', id: 'a', parent: 'g' },
      { op: 'remove', id: 'b' },
    ]);
    expect(result.removed).toEqual(['b']);
    expect(result.updated.sort()).toEqual(['a', 'c']);
    expect(doc.get('c')?.to).not.toHaveProperty('item');
  });

  it('dry runs report what would happen without committing', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: rect('a') }]);
    const result = doc.apply(
      [
        { op: 'set', id: 'a', patch: { x: 5 } },
        { op: 'remove', id: 'a' },
      ],
      { dryRun: true },
    );
    expect(result).toMatchObject({ ok: true, updated: [], removed: ['a'] });
    const edit = doc.apply([{ op: 'set', id: 'a', patch: { x: 5 } }], { dryRun: true });
    expect(edit.updated).toEqual(['a']);
    expect(doc.get('a')?.x).toBe(0);
  });

  it('does not count items moved only to make room as updated', () => {
    const doc = createDoc();
    doc.apply(
      [
        { op: 'add', item: { id: 'a', kind: 'rect', text: 'Draft' } },
        { op: 'add', item: { id: 'b', kind: 'rect', text: 'Send' } },
        { op: 'add', item: { id: 'ab', kind: 'arrow', from: 'a', to: 'b' } },
      ],
      { origin: 'agent:test' },
    );
    const result = doc.apply(
      [
        { op: 'add', item: { id: 'x', kind: 'rect', text: 'Review' }, place: { rightOf: 'a' } },
        { op: 'add', item: { id: 'ax', kind: 'arrow', from: 'a', to: 'x' } },
        { op: 'add', item: { id: 'xb', kind: 'arrow', from: 'x', to: 'b' } },
      ],
      { origin: 'agent:test' },
    );
    expect(result.ok).toBe(true);
    expect(result.moved).toContain('b');
    for (const id of result.moved ?? []) expect(result.updated).not.toContain(id);
  });

  it('runTool board_apply returns the new fields', async () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: rect('a') }]);
    expect(await runTool(doc, 'board_apply', { ops: [{ op: 'remove', id: 'a' }] })).toMatchObject({
      ok: true,
      created: [],
      updated: [],
      removed: ['a'],
    });
  });
});

describe('describe for a host model', () => {
  it('ends the overflow line neutrally unless the hint is requested', async () => {
    const doc = createDoc();
    doc.apply([
      { op: 'add', item: rect('a') },
      { op: 'add', item: rect('b', 200) },
      { op: 'add', item: rect('c', 400) },
    ]);
    const text = doc.describe({ maxItems: 1 });
    expect(text).toContain('2 more items not listed: 2 near (0,0).');
    expect(text).not.toContain('query()');
    expect(doc.describe({ maxItems: 1, overflowHint: true })).toContain(
      'Use query() or increase maxItems for detail.',
    );
    expect(await runTool(doc, 'board_describe', { maxItems: 1 })).toContain('Use query()');
  });

  it('carries stroke and dash when they differ from the default, quoted like fills', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'add', item: rect('plain', 0, { style: { stroke: 'ink', dash: 'solid' } }) },
      { op: 'add', item: rect('red', 200, { style: { stroke: 'rose', dash: 'dashed' } }) },
      { op: 'add', item: rect('odd', 400, { style: { stroke: 'x, fill teal' } }) },
      {
        op: 'add',
        item: {
          id: 'c',
          kind: 'connector',
          from: { item: 'plain' },
          to: { item: 'red' },
          style: { stroke: 'sky', dash: 'dotted' },
        },
      },
    ]);
    const lines = doc.describe().split('\n');
    expect(lines.find((line) => line.startsWith('plain '))).not.toMatch(/stroke|dash/);
    expect(lines.find((line) => line.startsWith('red '))).toContain(', stroke rose, dash dashed');
    expect(lines.find((line) => line.startsWith('odd '))).toContain(', stroke "x, fill teal"');
    expect(lines.find((line) => line.startsWith('  c:'))).toContain(
      '(straight), stroke sky, dash dotted',
    );
    expect(doc.describe({ detail: 'brief' })).not.toContain('stroke');
  });

  it('marks the creator, not the last writer', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: rect('mine') }], { origin: 'user' });
    doc.apply([{ op: 'add', item: rect('theirs', 200) }], { origin: 'agent:fellow' });
    const cursor = doc.revision;
    doc.apply([{ op: 'set', id: 'mine', patch: { x: 20 } }], { origin: 'agent:fellow' });
    doc.apply([{ op: 'set', id: 'theirs', patch: { x: 220 } }], { origin: 'user' });
    const lines = doc.describe().split('\n');
    expect(lines.find((line) => line.startsWith('mine '))).not.toContain('by agent');
    expect(lines.find((line) => line.startsWith('theirs '))).toContain(', by agent');
    const delta = doc.describe({ since: cursor });
    expect(delta).toContain('mine rect');
    expect(delta).toContain('theirs rect');
    expect(delta.split('\n').find((line) => line.startsWith('theirs '))).toContain('by agent');
  });

  it('keeps the creator through undo and redo of a removal', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: rect('a') }], { origin: 'agent:fellow' });
    doc.apply([{ op: 'remove', id: 'a' }], { origin: 'user' });
    doc.undo();
    expect(doc.describe()).toContain(', by agent');
  });

  it('does not credit an agent for an item that predates the session', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: rect('old') }]);
    doc.load(doc.toJSON());
    doc.apply([{ op: 'set', id: 'old', patch: { x: 30 } }], { origin: 'agent:fellow' });
    expect(doc.describe()).not.toContain('by agent');
  });

  it('keeps an id that predates the session unmarked when it is removed and comes back', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: rect('old') }]);
    doc.load(doc.toJSON());
    doc.apply([{ op: 'remove', id: 'old' }], { origin: 'user' });
    doc.apply([{ op: 'add', item: rect('old') }], { origin: 'agent:fellow' });
    expect(doc.describe()).not.toContain('by agent');
  });
});
