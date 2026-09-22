import { describe, expect, it } from 'vitest';
import { createDoc, type Item, type Op, type Placement } from '../src/core';

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

  it('leaves distinct positions, explicit place, strokes, and non-agent edits', () => {
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
    // An unpositioned blank box would cover A, so it goes right of the page content.
    const far = doc.get('far')!;
    expect(doc.get('blank')).toMatchObject({ x: far.x + far.w + 120, y: 0 });
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

type AddOp = Extract<Op, { op: 'add' }>;

describe('agent placement beside a taken slot', () => {
  const node = (id: string, label: string, at?: { x: number; y: number }): AddOp => ({
    op: 'add',
    item: { id, kind: 'rect', w: 180, h: 110, text: { value: label }, ...at },
  });
  const arrow = (from: string, to: string): Op => ({
    op: 'add',
    item: { id: `${from}_${to}`, kind: 'arrow', from, to },
  });
  const beside = (id: string, place: Placement, label = id): AddOp => ({
    ...node(id, label),
    place,
  });

  function row() {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    const result = doc.apply(
      [
        node('watch', 'Watch', { x: 0, y: 0 }),
        beside('triage', { rightOf: 'watch' }, 'Triage'),
        beside('print', { rightOf: 'triage' }, 'Print'),
        beside('save', { below: 'print' }, 'Save'),
        beside('review', { below: 'triage' }, 'Review?'),
        node('note', 'Legend', { x: 900, y: -600 }),
        arrow('watch', 'triage'),
        arrow('triage', 'print'),
        {
          op: 'add',
          item: {
            id: 'print_save',
            kind: 'arrow',
            from: 'print',
            to: 'save',
            waypoints: [[700, 170]],
          },
        },
        arrow('triage', 'review'),
        {
          op: 'add',
          item: {
            id: 'loop',
            kind: 'arrow',
            from: 'review',
            to: 'save',
            waypoints: [[390, 420]],
          },
        },
      ],
      fellow,
    );
    expect(result.ok).toBe(true);
    return doc;
  }

  it('inserts a step before the node it flows into and moves that side of the flow', () => {
    const doc = row();
    const before = Object.fromEntries(doc.query().map((item) => [item.id, { ...item }]));
    const result = doc.apply(
      [
        beside('extract', { rightOf: 'triage' }, 'Extract'),
        arrow('triage', 'extract'),
        arrow('extract', 'print'),
      ],
      fellow,
    );
    expect(result.ok).toBe(true);
    const { triage, extract, print, save, review, watch, note } = Object.fromEntries(
      doc.query().map((item) => [item.id, item]),
    );
    expect(extract.x).toBe(triage.x + triage.w + 120);
    expect(extract.y).toBe(triage.y);
    const delta = extract.w + 120;
    expect(print).toMatchObject({ x: before.print.x + delta, y: before.print.y });
    expect(save).toMatchObject({ x: before.save.x + delta, y: before.save.y });
    for (const id of ['watch', 'triage', 'review', 'note'] as const)
      expect(doc.get(id)).toMatchObject({ x: before[id].x, y: before[id].y });
    expect(doc.get('print_save')!.waypoints).toEqual([[700 + delta, 170]]);
    expect(doc.get('loop')!.waypoints).toEqual([[390, 420]]);
    expect(result.moved).toEqual(expect.arrayContaining(['print', 'save', 'print_save']));
    expect(result.moved).toHaveLength(3);
    expect(result.warnings.some((warning) => warning.code === 'OVERLAPS_EXISTING')).toBe(false);
    expect(doc.get('extract_print')).toMatchObject({
      from: { item: 'extract' },
      to: { item: 'print' },
    });
    void watch;
    void review;
    void note;
    expect(doc.undo()).toBe(true);
    expect(doc.get('extract')).toBeUndefined();
    for (const id of ['print', 'save'] as const)
      expect(doc.get(id)).toMatchObject({ x: before[id].x, y: before[id].y });
    expect(doc.get('print_save')!.waypoints).toEqual([[700, 170]]);
    expect(doc.redo()).toBe(true);
    expect(doc.get('print')!.x).toBe(before.print.x + delta);
  });

  it('inserts below and before a leftOf occupant when the arrows put the node between', () => {
    const doc = row();
    const print = doc.get('print')!,
      save = doc.get('save')!;
    const result = doc.apply(
      [
        beside('second', { below: 'print' }, 'Second?'),
        arrow('print', 'second'),
        arrow('second', 'save'),
      ],
      fellow,
    );
    expect(result.ok).toBe(true);
    const second = doc.get('second')!;
    expect(second.y).toBe(print.y + print.h + 120);
    expect(doc.get('save')).toMatchObject({ x: save.x, y: second.y + second.h + 120 });
    expect(doc.get('review')).toMatchObject({ x: doc.get('review')!.x });
    expect(result.moved).toEqual(['save']);

    const left = createDoc(undefined, { agentPlaceGap: 120 });
    left.apply(
      [node('p', 'P', { x: 600, y: 0 }), beside('q', { leftOf: 'p' }, 'Q'), arrow('q', 'p')],
      fellow,
    );
    const q = left.get('q')!;
    expect(
      left.apply([beside('x', { leftOf: 'p' }, 'X'), arrow('q', 'x'), arrow('x', 'p')], fellow).ok,
    ).toBe(true);
    const x = left.get('x')!;
    expect(x.x + x.w + 120).toBe(600);
    expect(left.get('q')!.x + q.w + 120).toBe(x.x);
  });

  it('goes past the occupant when the node follows it, and past a lane neighbor', () => {
    const doc = row();
    const print = doc.get('print')!;
    const result = doc.apply(
      [beside('after', { rightOf: 'triage' }, 'After'), arrow('print', 'after')],
      fellow,
    );
    expect(result.ok).toBe(true);
    expect(doc.get('after')).toMatchObject({ x: print.x + print.w + 120, y: print.y });
    expect(result.moved).toBeUndefined();
    const chain = doc.apply(
      [beside('tail', { rightOf: 'watch' }, 'Tail'), arrow('after', 'tail')],
      fellow,
    );
    expect(chain.ok).toBe(true);
    const after = doc.get('after')!;
    expect(doc.get('tail')).toMatchObject({ x: after.x + after.w + 120, y: after.y });
  });

  it('stacks unconnected siblings beside the occupant', () => {
    const doc = row();
    const triage = doc.get('triage')!;
    const result = doc.apply(
      [
        beside('branch', { rightOf: 'watch' }, 'Branch'),
        beside('other', { rightOf: 'watch' }, 'Other'),
        arrow('watch', 'branch'),
        arrow('watch', 'other'),
      ],
      fellow,
    );
    expect(result.ok).toBe(true);
    const review = doc.get('review')!;
    const branch = doc.get('branch')!;
    expect(branch).toMatchObject({ x: triage.x, y: review.y + review.h + 120 });
    expect(doc.get('other')).toMatchObject({ x: branch.x, y: branch.y + branch.h + 120 });
    expect(doc.get('triage')).toMatchObject({ x: triage.x, y: triage.y });
    expect(result.moved).toBeUndefined();

    const inboxes = createDoc(undefined, { agentPlaceGap: 120 });
    inboxes.apply([node('hub', 'Hub', { x: 600, y: 0 })], fellow);
    const fan = inboxes.apply(
      [
        beside('one', { leftOf: 'hub' }, 'One'),
        beside('two', { leftOf: 'hub' }, 'Two'),
        beside('three', { leftOf: 'hub' }, 'Three'),
        arrow('one', 'hub'),
        arrow('two', 'hub'),
        arrow('three', 'hub'),
      ],
      fellow,
    );
    expect(fan.ok).toBe(true);
    const one = inboxes.get('one')!,
      two = inboxes.get('two')!;
    expect(one.x + one.w + 120).toBe(600);
    expect(two).toMatchObject({ x: one.x, y: one.y + one.h + 120 });
    expect(inboxes.get('three')).toMatchObject({ x: one.x, y: two.y + two.h + 120 });
    expect(inboxes.get('hub')).toMatchObject({ x: 600, y: 0 });
  });

  it('leaves locked nodes in place and keeps sliding for other origins', () => {
    const doc = row();
    doc.apply([{ op: 'set', id: 'save', patch: { locked: true } }]);
    const save = doc.get('save')!;
    const result = doc.apply(
      [beside('extract', { rightOf: 'triage' }, 'Extract'), arrow('extract', 'print')],
      fellow,
    );
    expect(result.ok).toBe(true);
    expect(doc.get('save')).toMatchObject({ x: save.x, y: save.y });
    expect(result.moved).toEqual(['print']);

    const api = row();
    const print = api.get('print')!;
    expect(
      api.apply([beside('extract', { rightOf: 'triage' }, 'Extract'), arrow('extract', 'print')])
        .ok,
    ).toBe(true);
    expect(api.get('extract')!.x).toBe(print.x + print.w + 32);
    expect(api.get('print')).toMatchObject({ x: print.x });
  });
});

describe('agent nodes sent without coordinates', () => {
  const node = (id: string, label: string, at?: { x: number; y: number }): Op => ({
    op: 'add',
    item: { id, kind: 'rect', text: { value: label }, ...at },
  });
  const arrow = (from: string, to: string): Op => ({
    op: 'add',
    item: { id: `${from}_${to}`, kind: 'arrow', from, to },
  });
  const overlaps = (doc: ReturnType<typeof createDoc>) => {
    const boxes = doc.query().filter((item) => item.kind !== 'connector');
    return boxes.some((a, i) =>
      boxes
        .slice(i + 1)
        .some((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h),
    );
  };

  it('places each connected node after its source from the batch arrows', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    const result = doc.apply(
      [
        node('idea', 'Idea'),
        node('research', 'Research'),
        node('build', 'Build'),
        node('test', 'Test'),
        arrow('idea', 'research'),
        arrow('idea', 'build'),
        arrow('build', 'test'),
      ],
      fellow,
    );
    expect(result.ok).toBe(true);
    const { idea, research, build, test } = Object.fromEntries(
      doc.query().map((item) => [item.id, item]),
    );
    expect(idea).toMatchObject({ x: 0, y: 0 });
    expect(research.x).toBe(idea.x + idea.w + 120);
    // The second branch stacks beside the first instead of covering it.
    expect(build.x).toBe(research.x);
    expect(build.y).toBeGreaterThanOrEqual(research.y + research.h + 120);
    expect(test.x).toBe(build.x + build.w + 120);
    expect(overlaps(doc)).toBe(false);
    expect(result.warnings.some((warning) => warning.code === 'OVERLAPS_EXISTING')).toBe(false);
  });

  it('reads arrows sent without ids', () => {
    const doc = createDoc();
    const labels = ['A', 'B', 'C', 'D'];
    const result = doc.apply(
      [
        ...labels.map((label) => node(label.toLowerCase(), label)),
        ...['a', 'b', 'c'].map((from, index): Op => ({
          op: 'add',
          item: { kind: 'arrow', from, to: 'bcd'[index] },
        })),
      ],
      fellow,
    );
    expect(result.ok).toBe(true);
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => doc.get(id)!);
    expect([b, c, d].map((item) => item.y)).toEqual([a.y, a.y, a.y]);
    expect(c.x).toBe(b.x + b.w + 32);
    expect(d.x).toBe(c.x + c.w + 32);
  });

  it('inserts a node into an existing flow from its arrows alone', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    doc.apply([node('a', 'A'), node('c', 'C'), arrow('a', 'c')], fellow);
    const c = doc.get('c')!;
    const result = doc.apply(
      [{ op: 'remove', id: 'a_c' }, node('b', 'B'), arrow('a', 'b'), arrow('b', 'c')],
      fellow,
    );
    expect(result.ok).toBe(true);
    const a = doc.get('a')!,
      b = doc.get('b')!;
    expect(b).toMatchObject({ x: a.x + a.w + 120, y: a.y });
    expect(doc.get('c')!.x).toBe(c.x + b.w + 120);
    expect(result.moved).toEqual(['c']);
  });

  it('places a node that only points at an existing one to its left', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    doc.apply([node('goal', 'Goal', { x: 600, y: 0 })], fellow);
    expect(doc.apply([node('step', 'Step'), arrow('step', 'goal')], fellow).ok).toBe(true);
    const step = doc.get('step')!;
    expect(step.x + step.w + 120).toBe(600);
  });

  it('starts a new diagram right of existing work instead of on top of it', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    doc.apply(
      [
        { op: 'add', item: { id: 'sketch', kind: 'ellipse', x: -50, y: -40, w: 300, h: 260 } },
        { op: 'add', item: { id: 'title', kind: 'text', x: 0, y: 260, text: { value: 'Notes' } } },
      ],
      { origin: 'user' },
    );
    const result = doc.apply(
      [node('start', 'Start'), node('end', 'End'), arrow('start', 'end')],
      fellow,
    );
    expect(result.ok).toBe(true);
    const start = doc.get('start')!,
      end = doc.get('end')!,
      title = doc.get('title')!;
    expect(start).toMatchObject({ x: title.x + title.w + 120, y: -40 });
    expect(end.x).toBe(start.x + start.w + 120);
    expect(overlaps(doc)).toBe(false);
  });

  it('places a node to the right of the first arrow that points at it', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    doc.apply(
      [
        node('a', 'A', { x: 0, y: 0 }),
        node('c', 'C', { x: 0, y: 400 }),
        node('x', 'X', { x: 800, y: 400 }),
        node('b', 'B'),
        // c is already a source, but a→b is the first arrow into b.
        arrow('c', 'x'),
        arrow('a', 'b'),
        arrow('c', 'b'),
      ],
      fellow,
    );
    const a = doc.get('a')!;
    expect(doc.get('b')).toMatchObject({ x: a.x + a.w + 120, y: a.y });
  });

  it('keeps sent coordinates and explicit place over the arrows', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    doc.apply([node('a', 'A')], fellow);
    const result = doc.apply(
      [
        node('fixed', 'Fixed', { x: 40, y: 700 }),
        { ...node('below', 'Below'), place: { below: 'a' } } as Op,
        { op: 'add', item: { id: 'half', kind: 'rect', x: 900, text: { value: 'Half' } } },
        arrow('a', 'fixed'),
        arrow('a', 'below'),
        arrow('a', 'half'),
      ],
      fellow,
    );
    expect(result.ok).toBe(true);
    const a = doc.get('a')!;
    expect(doc.get('fixed')).toMatchObject({ x: 40, y: 700 });
    expect(doc.get('below')).toMatchObject({ y: a.y + a.h + 120 });
    expect(doc.get('half')).toMatchObject({ x: 900, y: 0 });
  });
});

describe('agent placement edge cases', () => {
  const box = (id: string, x: number, y: number, extra: Partial<Item> = {}): Item => ({
    id,
    kind: 'rect',
    x,
    y,
    w: 100,
    h: 60,
    ...extra,
  });
  const link = (id: string, from: string, to: string): Op => ({
    op: 'add',
    item: { id, kind: 'connector', from: { item: from }, to: { item: to } },
  });
  const insert = (place: Placement, extra: Op[] = []): Op[] => [
    { op: 'add', item: { id: 'n', kind: 'rect', w: 100, h: 60 }, place },
    ...extra,
  ];
  const overlap = (a: Item, b: Item) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const fellow = { origin: 'agent:fellow' as const };

  it('moves a connector inside a shifted group once, and undo restores it', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'add', item: box('r', 0, 0) },
      { op: 'add', item: box('h', 132, 0) },
      {
        op: 'add',
        item: {
          id: 'g',
          kind: 'group',
          x: 300,
          y: 0,
          w: 300,
          h: 60,
          children: [
            box('a', 300, 0),
            box('c', 500, 0),
            {
              id: 'inner',
              kind: 'connector',
              from: { item: 'a' },
              to: { item: 'c' },
              waypoints: [[450, 100]],
            },
          ],
        },
      },
      link('rh', 'r', 'h'),
      link('hg', 'h', 'g'),
    ]);
    const result = doc.apply(
      insert({ rightOf: 'r' }, [link('rn', 'r', 'n'), link('nh', 'n', 'h')]),
      fellow,
    );
    expect(result.ok).toBe(true);
    const dx = doc.get('a')!.x - 300;
    expect(dx).toBeGreaterThan(0);
    expect(doc.get('inner')!.waypoints).toEqual([[450 + dx, 100]]);
    expect(doc.undo()).toBe(true);
    expect(doc.get('a')!.x).toBe(300);
    expect(doc.get('inner')!.waypoints).toEqual([[450, 100]]);
  });

  it('leaves a group that holds locked work and warns when a moved node reaches it', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'add', item: box('r', 0, 0) },
      { op: 'add', item: box('h', 132, 0) },
      {
        op: 'add',
        item: {
          id: 'g',
          kind: 'group',
          x: 300,
          y: 0,
          w: 100,
          h: 60,
          children: [box('a', 300, 0, { locked: true })],
        },
      },
      link('rh', 'r', 'h'),
      link('hg', 'h', 'g'),
    ]);
    const result = doc.apply(
      insert({ rightOf: 'r' }, [link('rn', 'r', 'n'), link('nh', 'n', 'h')]),
      fellow,
    );
    expect(result.moved).toEqual(['h']);
    expect(doc.get('a')!.x).toBe(300);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'OVERLAPS_EXISTING',
        message: 'Item h, moved to make room, overlaps a.',
      }),
    );
  });

  it('stacks beside a locked occupant instead of covering it', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'add', item: box('r', 0, 0) },
      { op: 'add', item: box('b', 132, 0, { locked: true }) },
      link('rb', 'r', 'b'),
    ]);
    const result = doc.apply(
      insert({ rightOf: 'r' }, [link('rn', 'r', 'n'), link('nb', 'n', 'b')]),
      fellow,
    );
    expect(result.ok).toBe(true);
    expect(result.moved).toBeUndefined();
    expect(doc.get('b')).toMatchObject({ x: 132, y: 0 });
    expect(overlap(doc.get('n')!, doc.get('b')!)).toBe(false);
    expect(result.warnings.map((warning) => warning.code)).not.toContain('OVERLAPS_EXISTING');
  });

  it('inserts before a node that sits inside a group', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'add', item: box('r', 0, 0) },
      {
        op: 'add',
        item: {
          id: 'g',
          kind: 'group',
          x: 132,
          y: 0,
          w: 232,
          h: 60,
          children: [box('c', 132, 0), box('d', 264, 0)],
        },
      },
      link('rc', 'r', 'c'),
      link('cd', 'c', 'd'),
    ]);
    const result = doc.apply(
      insert({ rightOf: 'r' }, [link('rn', 'r', 'n'), link('nc', 'n', 'c')]),
      fellow,
    );
    expect(doc.get('n')).toMatchObject({ x: 132, y: 0 });
    expect(result.moved).toEqual(expect.arrayContaining(['c', 'd']));
    expect(doc.get('c')!.x).toBe(264);
    expect(doc.get('d')!.x).toBe(396);
  });

  it('keeps a stacked node clear of a tall reference', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'add', item: box('r', 0, 0, { h: 300 }) },
      { op: 'add', item: box('d', 132, 0, { w: 20, h: 20 }) },
    ]);
    doc.apply(
      [
        {
          op: 'add',
          item: { id: 'n', kind: 'rect', w: 180, h: 60 },
          place: { rightOf: 'r', align: 'start' },
        },
      ],
      fellow,
    );
    expect(overlap(doc.get('n')!, doc.get('r')!)).toBe(false);
    expect(overlap(doc.get('n')!, doc.get('d')!)).toBe(false);
  });

  it('places with a zero gap next to touching neighbors, for any origin', () => {
    for (const origin of ['api', 'agent:fellow'] as const) {
      const doc = createDoc();
      doc.apply([
        { op: 'add', item: box('r', 0, 0) },
        { op: 'add', item: box('a', 100, 0) },
        { op: 'add', item: box('b', 200, 0) },
      ]);
      const beside = doc.apply(insert({ rightOf: 'r', gap: 0 }), { origin });
      expect(beside.ok).toBe(true);
      expect(beside.warnings).toEqual([]);
      // Other origins slide past touching neighbors; an unconnected agent node stacks beside one.
      expect(doc.get('n')).toMatchObject(origin === 'api' ? { x: 300, y: 0 } : { x: 100, y: 60 });
      const near = doc.apply(
        [
          {
            op: 'add',
            item: { id: 'm', kind: 'rect', w: 50, h: 50 },
            place: { near: 'r', gap: 0 },
          },
        ],
        { origin },
      );
      expect(near.ok).toBe(true);
      expect(
        [doc.get('r'), doc.get('a'), doc.get('b'), doc.get('n')].some((item) =>
          overlap(item!, doc.get('m')!),
        ),
      ).toBe(false);
    }
  });

  it('warns only about overlaps on the same page', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'add', item: box('first', 0, 0) },
      { op: 'page.add', page: { id: 'p2', name: 'Two', items: [] } },
    ]);
    const result = doc.apply([{ op: 'add', page: 'p2', item: box('second', 0, 0) }], fellow);
    expect(result.warnings).toEqual([]);
  });

  it('keeps many siblings of one reference apart', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: box('r', 0, 0) }]);
    const result = doc.apply(
      Array.from({ length: 90 }, (_, i): Op => ({
        op: 'add',
        item: { id: `s${i}`, kind: 'rect', w: 100, h: 60 },
        place: { rightOf: 'r' },
      })),
      fellow,
    );
    expect(result.warnings.filter((warning) => warning.code === 'OVERLAPS_EXISTING')).toEqual([]);
  });
});
