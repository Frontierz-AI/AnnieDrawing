import { describe, expect, it } from 'vitest';
import { createDoc, type DocModel, type Item, type NewItem, type Op } from '../src/core';
import { boundsOf } from '../src/geo/box';
import { FELLOW, FOUNDERZ, measure, run, SCENARIOS } from './helpers/scenarios';
import baseline from './fixtures/layout-scenarios-0.8.0.json';

const VIEW = { w: 920, h: 455 } as const;
const STEPS = [
  '1. Definir objetivos',
  '2. Preparar agenda',
  '3. Invitar a participantes clave',
  '4. Conducir la reunión',
  '5. Enviar el resumen',
];

const fresh = () => createDoc(undefined, FOUNDERZ);
const apply = (doc: DocModel, ops: Op[], options = {}) =>
  doc.apply(ops, { ...FELLOW, viewport: VIEW, ...options });
const add = (item: NewItem, extra: Partial<Extract<Op, { op: 'add' }>> = {}): Op => ({
  op: 'add',
  item,
  ...extra,
});
const rect = (id: string, label: string, extra: Partial<NewItem> = {}) =>
  add({ id, kind: 'rect', text: { value: label }, ...extra });
const arrows = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    add({
      id: `arrow${index + 1}`,
      kind: 'arrow',
      from: `node${index + 1}`,
      to: `node${index + 2}`,
    }),
  );
const nodes = (doc: DocModel) => doc.query().filter((item) => item.kind !== 'connector');
const positions = (doc: DocModel) =>
  Object.fromEntries(nodes(doc).map((item) => [item.id, [item.x, item.y, item.w, item.h]]));
const rows = (doc: DocModel) => new Set(nodes(doc).map((item) => item.y + item.h / 2)).size;
const overlap = (a: Item, b: Item) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const anyOverlap = (doc: DocModel) =>
  nodes(doc).some((a, index) =>
    nodes(doc)
      .slice(index + 1)
      .some((b) => overlap(a, b)),
  );

/** The five-step flow; `place` is chained on steps 2 to 5 in the given style. */
function steps(chain?: 'item' | 'op'): Op[] {
  return [
    ...STEPS.map((label, index) => {
      const place = index ? { rightOf: `node${index}` } : undefined;
      if (!place || !chain) return rect(`node${index + 1}`, label);
      return chain === 'item'
        ? rect(`node${index + 1}`, label, { place } as Partial<NewItem>)
        : add({ id: `node${index + 1}`, kind: 'rect', text: { value: label } }, { place });
    }),
    ...arrows(4),
  ];
}

describe('same-batch place is a hint', () => {
  it('lays out a chained flow exactly like the flow without place', () => {
    const plain = fresh();
    expect(apply(plain, steps()).ok).toBe(true);
    const expected = positions(plain);
    const box = boundsOf(nodes(plain), nodes(plain));
    expect([box.w, box.h]).toEqual([1057, 340]);
    expect(rows(plain)).toBe(2);
    for (const chain of ['item', 'op'] as const) {
      const doc = fresh();
      const result = apply(doc, steps(chain));
      expect(result.ok, chain).toBe(true);
      expect(positions(doc), chain).toEqual(expected);
      expect(measure(doc, VIEW).bounds, chain).toEqual(measure(plain, VIEW).bounds);
      expect(rows(doc), chain).toBe(2);
      expect(JSON.stringify(doc.toJSON()), chain).not.toContain('"place"');
    }
  });

  it('lays out leftOf chains the same, written backward or forward', () => {
    const plain = fresh();
    apply(plain, steps());
    const leftOf = (index: number) => ({ place: { leftOf: `node${index + 2}` } });
    // Last step first, each earlier step leftOf the one after it: references point back.
    const backward = [...STEPS.keys()]
      .reverse()
      .map((index) =>
        rect(
          `node${index + 1}`,
          STEPS[index],
          index < 4 ? (leftOf(index) as Partial<NewItem>) : {},
        ),
      );
    // First step first: every reference points forward.
    const forward = [...STEPS.keys()].map((index) =>
      add(
        { id: `node${index + 1}`, kind: 'rect', text: { value: STEPS[index] } },
        index < 4 ? leftOf(index) : {},
      ),
    );
    // Batch order is node order, so compare with the plain flow in the same order.
    const plainBackward = fresh();
    apply(plainBackward, [
      ...[...STEPS.keys()].reverse().map((index) => rect(`node${index + 1}`, STEPS[index])),
      ...arrows(4),
    ]);
    const doc = fresh();
    expect(apply(doc, [...backward, ...arrows(4)]).ok).toBe(true);
    expect(positions(doc)).toEqual(positions(plainBackward));
    const ahead = fresh();
    expect(apply(ahead, [...forward, ...arrows(4)]).ok).toBe(true);
    expect(positions(ahead)).toEqual(positions(plain));
  });

  it('commits a forward reference with the node beside it at the per-node gap', () => {
    const doc = fresh();
    const result = apply(doc, [
      rect('n1', 'A', { place: { leftOf: 'n2' } } as Partial<NewItem>),
      rect('n2', 'B'),
    ]);
    expect(result.ok).toBe(true);
    expect(result.created).toEqual(['n1', 'n2']);
    const n1 = doc.get('n1')!,
      n2 = doc.get('n2')!;
    expect(n1.x + n1.w + 120).toBe(n2.x);
    expect(n1.y + n1.h / 2).toBe(n2.y + n2.h / 2);
  });

  it('puts two unconnected new nodes next to each other on the stated side', () => {
    const cases = {
      rightOf: (a: Item, b: Item) => b.x === a.x + a.w + 120 && b.y === a.y,
      leftOf: (a: Item, b: Item) => b.x + b.w + 120 === a.x && b.y === a.y,
      below: (a: Item, b: Item) => b.y === a.y + a.h + 120,
      above: (a: Item, b: Item) => b.y + b.h + 120 === a.y,
    };
    for (const [side, check] of Object.entries(cases)) {
      for (const order of ['back', 'ahead']) {
        const doc = fresh();
        const a = rect('a', 'Alpha'),
          b = add({ id: 'b', kind: 'rect', text: { value: 'Beta' } }, { place: { [side]: 'a' } });
        expect(apply(doc, order === 'back' ? [a, b] : [b, a]).ok).toBe(true);
        expect(check(doc.get('a')!, doc.get('b')!), `${side} ${order}`).toBe(true);
      }
    }
  });

  it('ignores a hint between nodes the arrows already connect', () => {
    const plain = fresh();
    apply(plain, steps());
    const doc = fresh();
    const ops = steps();
    // node4 follows node3 by arrows; a hint that puts it below node1 changes nothing.
    (ops[3] as Extract<Op, { op: 'add' }>).place = { below: 'node1' };
    (ops[4] as Extract<Op, { op: 'add' }>).place = { leftOf: 'node1' };
    expect(apply(doc, ops).ok).toBe(true);
    expect(positions(doc)).toEqual(positions(plain));
  });

  it('rejects a reference that exists nowhere, with the same message as before', () => {
    const doc = fresh();
    const result = apply(doc, [
      rect('n1', 'A', { place: { leftOf: 'ghost' } } as Partial<NewItem>),
      rect('n2', 'B'),
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toBe('add #1: Placement reference ghost does not exist.');
    expect(doc.query()).toEqual([]);
    const self = apply(doc, [rect('n1', 'A', { place: { rightOf: 'n1' } } as Partial<NewItem>)]);
    expect(self.errors[0].message).toBe('add #1: Placement reference n1 does not exist.');
  });

  it('drops a hint whose reference was skipped in lenient mode', () => {
    const doc = fresh();
    const result = apply(
      doc,
      [
        rect('n1', 'A', { place: { leftOf: 'n2' } } as Partial<NewItem>),
        // Fails: a parent that does not exist.
        add({ id: 'n2', kind: 'rect', text: { value: 'B' } }, { parent: 'missing' }),
        rect('n3', 'C', { place: { below: 'n2' } } as Partial<NewItem>),
      ],
      { lenient: true },
    );
    expect(result.ok).toBe(true);
    expect(result.skipped?.map((issue) => issue.index)).toEqual([1]);
    expect(result.created).toEqual(['n1', 'n3']);
    // Both are laid out as plain unconnected nodes: one row of two.
    const n1 = doc.get('n1')!,
      n3 = doc.get('n3')!;
    expect(n3.x).toBe(n1.x + n1.w + 120);
    expect(n3.y).toBe(n1.y);
  });

  it('keeps a place beside an item that existed before the batch where placeAgentItem puts it', () => {
    const setup = (doc: DocModel) =>
      apply(doc, [rect('base', 'Existing step', { x: 200, y: 100 } as Partial<NewItem>)]);
    const batch = [
      rect('next', 'Next step', { place: { rightOf: 'base' } } as Partial<NewItem>),
      rect('other', 'Unrelated'),
    ];
    const auto = fresh(),
      none = fresh();
    setup(auto);
    setup(none);
    expect(apply(auto, batch).ok).toBe(true);
    expect(apply(none, batch, { layout: 'none' }).ok).toBe(true);
    const base = auto.get('base')!;
    expect(auto.get('next')).toMatchObject({
      x: base.x + base.w + 120,
      y: base.y + (base.h - auto.get('next')!.h) / 2,
    });
    expect(auto.get('next')).toMatchObject({ x: none.get('next')!.x, y: none.get('next')!.y });
  });

  it('places a node beside a pinned same-batch node the same in either order', () => {
    const fixed = rect('fixed', 'Fixed', { x: 300, y: 200 } as Partial<NewItem>);
    const beside = rect('beside', 'Beside', { place: { below: 'fixed' } } as Partial<NewItem>);
    const back = fresh(),
      ahead = fresh();
    expect(apply(back, [fixed, beside]).ok).toBe(true);
    expect(apply(ahead, [beside, fixed]).ok).toBe(true);
    const f = back.get('fixed')!;
    expect(back.get('beside')).toMatchObject({ y: f.y + f.h + 120 });
    expect(positions(ahead)).toEqual(positions(back));
  });

  it("keeps 'none' and non-agent origins as before, including a failing forward reference", () => {
    const forward = [
      rect('n1', 'A', { place: { leftOf: 'n2' } } as Partial<NewItem>),
      rect('n2', 'B'),
    ];
    expect(apply(fresh(), forward, { layout: 'none' }).errors[0].message).toBe(
      'add #1: Placement reference n2 does not exist.',
    );
    const user = fresh();
    expect(
      user.apply(
        [
          add({ id: 'n1', kind: 'rect', w: 100, h: 60 }, { place: { leftOf: 'n2' } }),
          add({ id: 'n2', kind: 'rect', w: 100, h: 60 }),
        ],
        { origin: 'user' },
      ).ok,
    ).toBe(false);
    // Backward chains still place node by node under 'none': one long row.
    const none = fresh();
    expect(apply(none, steps('item'), { layout: 'none' }).ok).toBe(true);
    expect(rows(none)).toBe(1);
    const tool = fresh();
    expect(
      tool.apply(
        [
          add({ id: 'a', kind: 'rect', w: 100, h: 60 }),
          add({ id: 'b', kind: 'rect', w: 100, h: 60 }, { place: { rightOf: 'a' } }),
        ],
        { origin: 'user' },
      ).ok,
    ).toBe(true);
    expect(tool.get('b')).toMatchObject({ x: 132, y: 0 });
  });

  it('places an unconnected note below its flow step without moving the flow', () => {
    const plain = fresh();
    apply(plain, steps());
    const doc = fresh();
    const result = apply(doc, [
      ...steps(),
      add(
        { id: 'note', kind: 'note', text: { value: 'Send the agenda a day early' } },
        {
          place: { below: 'node3' },
        },
      ),
    ]);
    expect(result.ok).toBe(true);
    const { note, ...flow } = positions(doc);
    expect(flow).toEqual(positions(plain));
    const step = doc.get('node3')!,
      placed = doc.get('note')!;
    expect(placed.y).toBe(step.y + step.h + 120);
    expect(placed.x + placed.w / 2).toBe(step.x + step.w / 2);
    expect(note).toBeDefined();
    expect(anyOverlap(doc)).toBe(false);
    expect(measure(doc, VIEW).overlaps).toEqual([]);
  });

  it('keeps eleven text lines chained below each other in one batch as a tight column', () => {
    const doc = fresh();
    const result = apply(
      doc,
      Array.from({ length: 11 }, (_, index) =>
        rect(
          `t${index}`,
          index ? `Line ${index} of the lesson` : 'Lesson title',
          index
            ? ({ kind: 'text', place: { below: `t${index - 1}` } } as Partial<NewItem>)
            : { kind: 'text' },
        ),
      ),
    );
    expect(result.ok).toBe(true);
    const lines = Array.from({ length: 11 }, (_, index) => doc.get(`t${index}`)!);
    // The positions 0.8.0 gave: one line height (25) plus a one-line gap (25) apart.
    expect(lines.map((line) => [line.x, line.y])).toEqual(lines.map((_, i) => [0, i * 50]));
    const box = boundsOf(lines, lines);
    expect(box.h).toBeLessThan(600);
  });

  it('honors a stated gap and alignment between two new nodes', () => {
    const doc = fresh();
    const result = apply(doc, [
      add({ id: 'first', kind: 'note', text: { value: 'Prepare' } }),
      add(
        { id: 'second', kind: 'note', text: { value: 'Follow up' } },
        { place: { rightOf: 'first', gap: 40, align: 'start' } },
      ),
    ]);
    expect(result.ok).toBe(true);
    const first = doc.get('first')!,
      second = doc.get('second')!;
    expect(second.x).toBe(first.x + first.w + 40);
    expect(second.y).toBe(first.y);
  });

  it('stacks several hinted nodes beside one reference without overlap', () => {
    const doc = fresh();
    const result = apply(doc, [
      rect('hub', 'Topic'),
      ...['One', 'Two', 'Three'].map((label) =>
        add({ id: label, kind: 'note', text: { value: label } }, { place: { rightOf: 'hub' } }),
      ),
    ]);
    expect(result.ok).toBe(true);
    expect(anyOverlap(doc)).toBe(false);
    const hub = doc.get('hub')!;
    for (const id of ['One', 'Two', 'Three']) expect(doc.get(id)!.x).toBe(hub.x + hub.w + 120);
  });

  it('keeps undo, redo, stored adds, and output deterministic', () => {
    const batch = [
      rect('n1', 'A', { place: { leftOf: 'n2' } } as Partial<NewItem>),
      rect('n2', 'B'),
      ...steps('item'),
    ];
    const doc = fresh();
    const result = apply(doc, batch);
    expect(result.ok).toBe(true);
    const after = JSON.stringify(doc.toJSON());
    const again = fresh();
    apply(again, batch);
    expect(JSON.stringify(again.toJSON())).toBe(after);
    expect(doc.undo()).toBe(true);
    expect(doc.query()).toEqual([]);
    expect(doc.redo()).toBe(true);
    expect(JSON.stringify(doc.toJSON())).toBe(after);
    // Stored adds carry the final coordinates, so replaying them gives the same board.
    const stored = doc.changesSince(0).changes.flatMap((slice) => slice.ops);
    expect(stored.length).toBeGreaterThan(0);
    const replay = createDoc(undefined, FOUNDERZ);
    expect(replay.apply(stored, { origin: 'user' }).ok).toBe(true);
    expect(positions(replay)).toEqual(positions(doc));
    for (const op of stored) if (op.op === 'add') expect(op.item).not.toHaveProperty('place');
  });

  it('reports existing agent nodes the layout moves and places a hinted node beside the insert', () => {
    const doc = fresh();
    apply(doc, [
      rect('a', 'Draft'),
      rect('c', 'Send'),
      add({ id: 'ac', kind: 'arrow', from: 'a', to: 'c' }),
    ]);
    const c = doc.get('c')!;
    const result = apply(doc, [
      { op: 'remove', id: 'ac' },
      // A forward reference to the inserted step, which only the arrows place.
      rect('note', 'Reviewer notes', { place: { below: 'b' } } as Partial<NewItem>),
      rect('b', 'Review'),
      add({ kind: 'arrow', from: 'a', to: 'b' }),
      add({ kind: 'arrow', from: 'b', to: 'c' }),
    ]);
    expect(result.ok).toBe(true);
    expect(result.moved).toEqual(['c']);
    expect(doc.get('c')!.x).toBeGreaterThan(c.x);
    const b = doc.get('b')!;
    expect(doc.get('note')!.y).toBe(b.y + b.h + 120);
    expect(doc.undo()).toBe(true);
    expect(doc.get('c')).toMatchObject({ x: c.x, y: c.y });
  });
});

describe('Founderz scenarios keep their 0.8.0 positions', () => {
  for (const [name, viewport] of [
    ['1280x760', undefined],
    ['920x455', VIEW],
  ] as const)
    it(`at ${name}`, () => {
      for (const entry of SCENARIOS) {
        const { doc } = run(entry, viewport ? { viewport } : {});
        expect(positions(doc), entry.id).toEqual(
          (baseline as Record<string, Record<string, unknown>>)[name][entry.id],
        );
      }
    });
});
