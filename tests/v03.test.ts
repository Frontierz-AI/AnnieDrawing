import { describe, expect, it } from 'vitest';
import { LIMITS, createDoc, type Op } from '../src/core';
const rect = (id: string, x = 0, y = 0) => ({ kind: 'rect' as const, id, x, y, w: 100, h: 80 });
describe('session revision', () => {
  it('steps once per committed apply; dryRun does not step; load and clear reset to 0', () => {
    const doc = createDoc();
    expect(doc.revision).toBe(0);
    expect(doc.apply([{ op: 'add', item: rect('a') }]).ok).toBe(true);
    expect(doc.revision).toBe(1);
    expect(doc.apply([{ op: 'add', item: rect('b', 200) }], { dryRun: true }).ok).toBe(true);
    expect(doc.revision).toBe(1);
    expect(doc.apply([{ op: 'add', item: rect('b', 200) }]).ok).toBe(true);
    expect(doc.revision).toBe(2);
    doc.load(doc.toJSON());
    expect(doc.revision).toBe(0);
    expect(doc.changesSince(0).changes).toEqual([]);
    expect(doc.apply([{ op: 'add', item: rect('c') }]).ok).toBe(true);
    expect(doc.revision).toBe(1);
    doc.clear();
    expect(doc.revision).toBe(0);
    expect(doc.get('c')).toBeUndefined();
    expect(doc.canUndo).toBe(false);
    expect('revision' in doc.toJSON()).toBe(false);
  });
  it('returns two slices after two applies and an empty log at the cursor', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: rect('a') }], { origin: 'user', label: 'one' });
    doc.apply([{ op: 'add', item: rect('b', 200) }], { origin: 'api', label: 'two' });
    const log = doc.changesSince(0);
    expect(log.cursor).toBe(2);
    expect(log.changes).toHaveLength(2);
    expect(log.changes[0]).toMatchObject({ revision: 1, origin: 'user', label: 'one' });
    expect(log.changes[1]).toMatchObject({ revision: 2, origin: 'api', label: 'two' });
    expect(doc.changesSince(log.cursor).changes).toEqual([]);
    expect(doc.changesSince(99).changes).toEqual([]);
  });
  it('filters changesSince by exact origin and by any agent origin', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: rect('a') }], { origin: 'user' });
    doc.apply([{ op: 'add', item: rect('b', 200) }], { origin: 'agent:x' });
    expect(doc.changesSince(0, { origin: 'user' }).changes.map((slice) => slice.origin)).toEqual([
      'user',
    ]);
    expect(doc.changesSince(0, { origin: 'agent' }).changes.map((slice) => slice.origin)).toEqual([
      'agent:x',
    ]);
    expect(doc.changesSince(0, { origin: 'agent:x' }).changes).toHaveLength(1);
  });
  it('keeps later slices after history trim and marks a truncated window', () => {
    const doc = createDoc();
    for (let index = 0; index < LIMITS.maxHistory + 1; index++)
      doc.apply([{ op: 'add', item: rect(`h${index}`, index * 10) }]);
    expect(doc.revision).toBe(LIMITS.maxHistory + 1);
    expect(doc.changesSince(0).changes.length).toBe(LIMITS.maxHistory + 1);
    expect(doc.canUndo).toBe(true);
    for (let index = LIMITS.maxHistory + 1; index < LIMITS.maxSessionLog + 1; index++)
      doc.apply([{ op: 'add', item: rect(`s${index}`, 0, index) }]);
    expect(doc.revision).toBe(LIMITS.maxSessionLog + 1);
    expect(doc.changesSince(0)).toMatchObject({ changes: [], truncated: true });
    const kept = doc.changesSince(1);
    expect(kept.truncated).toBeUndefined();
    expect(kept.changes).toHaveLength(LIMITS.maxSessionLog);
    expect(kept.changes[0].revision).toBe(2);
  });
  it('describes only items written or removed after a revision', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: { ...rect('keep'), text: { value: 'Keep' } } }]);
    const cursor = doc.revision;
    doc.apply(
      [
        { op: 'add', item: { ...rect('new', 200), text: { value: 'New' } } },
        { op: 'set', id: 'keep', patch: { x: 20 } },
      ],
      { origin: 'agent:tool' },
    );
    const delta = doc.describe({ since: cursor, detail: 'normal' });
    expect(delta).toContain('new rect "New"');
    expect(delta).toContain('keep rect "Keep"');
    expect(delta).toContain(', by agent');
    doc.apply([{ op: 'remove', id: 'new' }]);
    const removed = doc.describe({ since: cursor + 1, detail: 'normal' });
    expect(removed).toContain('removed new rect');
    expect(removed).not.toContain('keep rect');
    expect(doc.describe({ since: doc.revision })).toBe(
      `No changes since revision ${doc.revision}.`,
    );
    expect(doc.describe({ since: cursor, detail: 'brief' })).toContain('removed new');
  });
});
describe('agent history and lenient apply', () => {
  it('hides agent origins from default undo and keeps origin undo', () => {
    const doc = createDoc(undefined, { agentHistory: 'hidden' });
    doc.apply([{ op: 'add', item: rect('a') }], { origin: 'agent:x' });
    doc.apply([{ op: 'set', id: 'a', patch: { x: 50 } }], { origin: 'user' });
    expect(doc.canUndo).toBe(true);
    expect(doc.undo()).toBe(true);
    expect(doc.get('a')).toMatchObject({ x: 0 });
    expect(doc.get('a')).toBeDefined();
    expect(doc.undo()).toBe(false);
    expect(doc.undo({ origin: 'agent:x' })).toBe(true);
    expect(doc.get('a')).toBeUndefined();
  });
  it('commits good operations when lenient and rolls back when not', () => {
    const ops: Op[] = [
      { op: 'add', item: rect('good') },
      { op: 'set', id: 'missing', patch: { x: 90 } },
      { op: 'add', item: rect('also', 200) },
    ];
    const lenient = createDoc();
    const accepted = lenient.apply(ops, { lenient: true });
    expect(accepted.ok).toBe(true);
    expect(accepted.errors).toEqual([]);
    expect(accepted.skipped).toEqual([expect.objectContaining({ index: 1 })]);
    expect(lenient.get('good')).toBeDefined();
    expect(lenient.get('also')).toBeDefined();
    expect(lenient.revision).toBe(1);
    const atomic = createDoc();
    const rejected = atomic.apply(ops, { lenient: false });
    expect(rejected.ok).toBe(false);
    expect(rejected.skipped).toBeUndefined();
    expect(atomic.get('good')).toBeUndefined();
    expect(atomic.revision).toBe(0);
  });
  it('uses agentPlaceGap only when place.gap is omitted', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    doc.apply([{ op: 'add', item: rect('a') }]);
    doc.apply([{ op: 'add', item: { ...rect('b'), w: 100, h: 80 }, place: { rightOf: 'a' } }], {
      origin: 'agent:tool',
    });
    expect(doc.get('b')!.x).toBe(220);
    doc.apply(
      [{ op: 'add', item: { ...rect('c'), w: 100, h: 80 }, place: { rightOf: 'b', gap: 10 } }],
      { origin: 'agent:tool' },
    );
    expect(doc.get('c')!.x).toBe(330);
    doc.apply([{ op: 'add', item: { ...rect('d'), w: 100, h: 80 }, place: { rightOf: 'c' } }], {
      origin: 'user',
    });
    expect(doc.get('d')!.x).toBe(462);
  });
});
describe('host vocabulary aliases', () => {
  it('stores rectangle and arrow as AnnieDrawing kinds', () => {
    const doc = createDoc();
    expect(
      doc.apply([
        { op: 'add', item: { id: 'box', kind: 'rectangle', x: 0, y: 0, w: 120, h: 80 } },
        {
          op: 'add',
          item: {
            id: 'link',
            kind: 'arrow',
            from: { item: 'box', side: 'right' },
            to: { x: 300, y: 40 },
          },
        },
      ]).ok,
    ).toBe(true);
    expect(doc.get('box')!.kind).toBe('rect');
    expect(doc.get('link')).toMatchObject({
      kind: 'connector',
      heads: { end: 'arrow' },
      route: 'elbow',
    });
    expect(doc.query({ kind: 'arrow' }).map((item) => item.id)).toEqual(['link']);
    expect(doc.query({ kind: 'rectangle' }).map((item) => item.id)).toEqual(['box']);
  });
  it('stores color aliases as tokens in compact JSON', () => {
    const doc = createDoc();
    doc.apply([
      {
        op: 'add',
        item: { ...rect('a'), style: { stroke: 'black', fill: 'light-blue' } },
      },
    ]);
    expect(doc.get('a')!.style).toMatchObject({ stroke: 'ink', fill: 'sky' });
    const compact = doc.toJSON();
    expect(compact.pages[0].items[0].style).toMatchObject({ fill: 'sky' });
    expect(JSON.stringify(compact)).not.toContain('black');
  });
  it('stores a string connector endpoint as an auto side', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'add', item: rect('a') },
      { op: 'add', item: rect('b', 200) },
      { op: 'add', item: { id: 'i_link', kind: 'connector', from: 'a', to: 'b' } },
    ]);
    expect(doc.get('i_link')).toMatchObject({
      from: { item: 'a', side: 'auto' },
      to: { item: 'b', side: 'auto' },
    });
    const compact = JSON.stringify(doc.toJSON());
    expect(compact).toContain('"item":"a"');
    expect(compact).not.toMatch(/"from":"a"/);
  });
});
