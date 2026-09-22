import { describe, expect, it } from 'vitest';
import { createDoc, type Op } from '../src/core';

const fellow = { origin: 'agent:fellow' as const };
const labels = [
  'Start',
  'Store extracted data and draft the invoice',
  'Send the quotation to the customer',
  'Record it in the CRM',
  'Done',
];

function flowchart(at?: { x: number; y: number }): Op[] {
  const ops: Op[] = labels.map((label, index) => ({
    op: 'add',
    item: { id: `s${index}`, kind: 'rect', text: { value: label }, ...at },
  }));
  for (let index = 0; index < labels.length - 1; index++)
    ops.push({
      op: 'add',
      item: { id: `e${index}`, kind: 'arrow', from: `s${index}`, to: `s${index + 1}` },
    });
  return ops;
}

function expectRow(
  doc: ReturnType<typeof createDoc>,
  origin: { x: number; y: number },
  warnings: { code: string }[],
) {
  const nodes = labels.map((_, index) => doc.get(`s${index}`)!);
  expect(nodes[0]).toMatchObject(origin);
  for (let index = 1; index < nodes.length; index++)
    expect(nodes[index].x).toBe(nodes[index - 1].x + nodes[index - 1].w + 120);
  for (let index = 0; index < labels.length - 1; index++)
    expect(doc.get(`e${index}`)).toMatchObject({
      from: { item: `s${index}` },
      to: { item: `s${index + 1}` },
    });
  expect(warnings.some((warning) => warning.code === 'OVERLAPS_EXISTING')).toBe(false);
}

describe('agent flowchart placement', () => {
  it('spaces unlabeled coordinates into a row and keeps arrows bound', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    const result = doc.apply(flowchart(), fellow);
    expect(result.ok).toBe(true);
    expectRow(doc, { x: 0, y: 0 }, result.warnings);
    expect(doc.undo()).toBe(true);
    expect(doc.get('s0')).toBeUndefined();
    expect(doc.redo()).toBe(true);
    expect(doc.get('s1')!.x).toBe(doc.get('s0')!.x + doc.get('s0')!.w + 120);
  });

  it('spaces steps that repeat one coordinate', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    const result = doc.apply(flowchart({ x: 40, y: 40 }), fellow);
    expect(result.ok).toBe(true);
    expectRow(doc, { x: 40, y: 40 }, result.warnings);
  });

  it('honors a single place nested on the item and does not store it', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    doc.apply(
      [
        {
          op: 'add',
          item: { id: 'a', kind: 'rect', x: 10, y: 30, w: 100, h: 80, text: { value: 'A' } },
        },
      ],
      fellow,
    );
    const result = doc.apply(
      [
        {
          op: 'add',
          item: {
            id: 'b',
            kind: 'rect',
            x: 900,
            y: 900,
            w: 100,
            h: 40,
            text: { value: 'B' },
            place: { rightOf: 'a', gap: 16, align: 'start' },
          },
        },
      ],
      fellow,
    );
    expect(result.ok).toBe(true);
    const a = doc.get('a')!;
    expect(doc.get('b')).toMatchObject({ x: a.x + a.w + 16, y: a.y });
    expect(doc.get('b')).not.toHaveProperty('place');
    expect(JSON.stringify(doc.toJSON())).not.toContain('"place"');
  });

  it('uses agentPlaceGap when a nested place omits gap, and drops an invalid gap', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    doc.apply(
      [{ op: 'add', item: { id: 'a', kind: 'rect', w: 100, h: 80, text: { value: 'A' } } }],
      fellow,
    );
    doc.apply(
      [
        {
          op: 'add',
          item: {
            id: 'b',
            kind: 'rect',
            w: 100,
            h: 80,
            text: { value: 'B' },
            place: { below: 'a' },
          },
        },
        {
          op: 'add',
          item: {
            id: 'c',
            kind: 'rect',
            w: 100,
            h: 80,
            text: { value: 'C' },
            place: { rightOf: 'a', gap: -5 },
          },
        },
      ],
      fellow,
    );
    const a = doc.get('a')!;
    expect(doc.get('b')).toMatchObject({ x: a.x, y: a.y + a.h + 120 });
    expect(doc.get('c')!.x).toBe(a.x + a.w + 120);
  });

  it('parents a nested inside place into the group', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    const result = doc.apply(
      [
        { op: 'add', item: { id: 'g', kind: 'group', x: 0, y: 0, w: 400, h: 300 } },
        {
          op: 'add',
          item: {
            id: 'n',
            kind: 'rect',
            w: 80,
            h: 50,
            text: { value: 'In' },
            place: { inside: 'g', gap: 12 },
          },
        },
      ],
      fellow,
    );
    expect(result.ok).toBe(true);
    expect(doc.get('n')).toMatchObject({ x: 12, y: 12 });
    expect(doc.toJSON().pages[0].items[0].children?.map((child) => child.id)).toEqual(['n']);
  });

  it('rewrites a nested place when the target id is remapped', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    const ops: Op[] = [
      { op: 'add', item: { id: 'step', kind: 'rect', w: 100, h: 80, text: { value: 'A' } } },
      {
        op: 'add',
        item: {
          id: 'next',
          kind: 'rect',
          w: 100,
          h: 80,
          text: { value: 'B' },
          place: { rightOf: 'step', gap: 20 },
        },
      },
    ];
    expect(doc.apply(ops, fellow).ok).toBe(true);
    const again = doc.apply(ops, fellow);
    expect(again.ok).toBe(true);
    expect(again.created).toEqual(['step_1', 'next_1']);
    const step = doc.get('step_1')!;
    expect(doc.get('next_1')!.x).toBe(step.x + step.w + 20);
  });

  it('keeps a small labeled ellipse inside a much larger one', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    const result = doc.apply(
      [
        {
          op: 'add',
          item: {
            id: 'moon',
            kind: 'ellipse',
            x: 10,
            y: 20,
            w: 200,
            h: 200,
            text: { value: 'Moon' },
          },
        },
        {
          op: 'add',
          item: { id: 'crater', kind: 'ellipse', x: 80, y: 90, w: 40, h: 40, text: { value: 'A' } },
        },
      ],
      fellow,
    );
    expect(result.ok).toBe(true);
    expect(doc.get('moon')).toMatchObject({ x: 10, y: 20 });
    expect(doc.get('crater')).toMatchObject({ x: 80, y: 90, w: 40, h: 40 });
  });

  it('moves a label at the 40% area boundary and leaves a smaller one', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    doc.apply(
      [
        { op: 'add', item: { id: 'wide', kind: 'rect', w: 100, h: 100, text: { value: 'A' } } },
        { op: 'add', item: { id: 'edge', kind: 'rect', w: 40, h: 100, text: { value: 'A' } } },
        {
          op: 'add',
          item: { id: 'under', kind: 'rect', x: 400, y: 0, w: 100, h: 100, text: { value: 'B' } },
        },
        {
          op: 'add',
          item: { id: 'small', kind: 'rect', x: 400, y: 0, w: 39, h: 100, text: { value: 'A' } },
        },
      ],
      fellow,
    );
    expect(doc.get('edge')).toMatchObject({ x: 100 + 120, y: 0 });
    expect(doc.get('small')).toMatchObject({ x: 400, y: 0, w: 39, h: 100 });
    expect(doc.get('under')).toMatchObject({ x: 400, y: 0 });
  });

  it('places beside the latest overlapping label', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    doc.apply([
      {
        op: 'add',
        item: { id: 'a', kind: 'rect', x: 0, y: 0, w: 100, h: 100, text: { value: 'A' } },
      },
      {
        op: 'add',
        item: { id: 'b', kind: 'rect', x: 30, y: 0, w: 100, h: 100, text: { value: 'B' } },
      },
    ]);
    doc.apply(
      [
        {
          op: 'add',
          item: { id: 'c', kind: 'rect', x: 0, y: 0, w: 100, h: 100, text: { value: 'C' } },
        },
      ],
      fellow,
    );
    expect(doc.get('c')!.x).toBe(30 + 100 + 120);
  });

  it('does not use a node removed earlier in the same batch', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    const result = doc.apply(
      [
        {
          op: 'add',
          item: {
            id: 'keep',
            kind: 'rect',
            x: 900,
            y: 40,
            w: 180,
            h: 110,
            text: { value: 'Keep' },
          },
        },
        {
          op: 'add',
          item: { id: 'temp', kind: 'rect', x: 0, y: 0, w: 180, h: 110, text: { value: 'Temp' } },
        },
        { op: 'remove', id: 'temp' },
        {
          op: 'add',
          item: { id: 'fresh', kind: 'rect', x: 0, y: 0, w: 180, h: 110, text: { value: 'Fresh' } },
        },
      ],
      fellow,
    );
    expect(result.ok).toBe(true);
    expect(doc.get('temp')).toBeUndefined();
    expect(doc.get('fresh')).toMatchObject({ x: 0, y: 0 });
    expect(doc.get('keep')).toMatchObject({ x: 900, y: 40 });
  });

  it('leaves distinct positions, explicit place, empty labels, and non-agent edits', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    const result = doc.apply(
      [
        { op: 'add', item: { id: 'a', kind: 'rect', text: { value: 'A' } } },
        { op: 'add', item: { id: 'far', kind: 'rect', x: 800, y: 40, text: { value: 'Far' } } },
        {
          op: 'add',
          item: { id: 'below', kind: 'rect', x: 0, y: 0, w: 180, h: 110, text: { value: 'Below' } },
          place: { below: 'a', gap: 10 },
        },
        { op: 'add', item: { id: 'blank', kind: 'rect' } },
        { op: 'add', item: { id: 'line', kind: 'line', x: 0, y: 0, w: 180, h: 0 } },
        {
          op: 'add',
          item: {
            id: 'path',
            kind: 'path',
            x: 0,
            y: 0,
            points: [
              [0, 0],
              [40, 20],
            ],
          },
        },
      ],
      fellow,
    );
    expect(result.ok).toBe(true);
    expect(doc.get('far')).toMatchObject({ x: 800, y: 40 });
    const a = doc.get('a')!;
    expect(doc.get('below')!.y).toBe(a.y + a.h + 10);
    expect(doc.get('blank')).toMatchObject({ x: 0, y: 0 });
    expect(doc.get('line')).toMatchObject({ x: 0, y: 0 });
    expect(doc.get('path')).toMatchObject({ x: 0, y: 0 });
    const user = createDoc(undefined, { agentPlaceGap: 120 });
    user.apply(
      [
        { op: 'add', item: { id: 'a', kind: 'rect', text: { value: 'A' } } },
        { op: 'add', item: { id: 'b', kind: 'rect', text: { value: 'B' } } },
      ],
      { origin: 'user' },
    );
    expect(user.get('b')).toMatchObject({ x: 0, y: 0 });
    const api = createDoc(undefined, { agentPlaceGap: 120 });
    api.apply([
      { op: 'add', item: { id: 'a', kind: 'rect', text: { value: 'A' } } },
      { op: 'add', item: { id: 'b', kind: 'rect', text: { value: 'B' } } },
    ]);
    expect(api.get('b')).toMatchObject({ x: 0, y: 0 });
  });

  it('spaces ellipse, diamond, note, and text off a similar label', () => {
    for (const kind of ['ellipse', 'diamond', 'note', 'text'] as const) {
      const doc = createDoc(undefined, { agentPlaceGap: 120 });
      doc.apply(
        [
          { op: 'add', item: { id: 'seed', kind, w: 180, h: 110, text: { value: 'Seed' } } },
          { op: 'add', item: { id: 'next', kind, w: 180, h: 110, text: { value: 'Next' } } },
        ],
        fellow,
      );
      const seed = doc.get('seed')!;
      expect(doc.get('next')!.x).toBe(seed.x + seed.w + 120);
    }
  });

  it('leaves a partial overlap that covers less than half the smaller box', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    doc.apply(
      [
        {
          op: 'add',
          item: { id: 'a', kind: 'rect', x: 0, y: 0, w: 200, h: 100, text: { value: 'A' } },
        },
        {
          op: 'add',
          item: { id: 'b', kind: 'rect', x: 180, y: 0, w: 200, h: 100, text: { value: 'B' } },
        },
      ],
      fellow,
    );
    expect(doc.get('b')).toMatchObject({ x: 180, y: 0 });
  });
});
