import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { createDoc, kindsSince, LIMITS } from '../src/core';
import { runTool } from '../src/agent';
import { toolSchemas } from '../src/agent/toolDefs';
import { cellAt, layoutTable, TABLE } from '../src/core/table';
import { wrapPlainText } from '../src/core/textFit';
import type { Item } from '../src/core/types';
import { routeConnector } from '../src/geo';
import { exportSVG } from '../src/porter/svg';

const fellow = { origin: 'agent:fellow' } as const;
/** Four columns, three rows, header included, with cells long enough to wrap. */
const rows = [
  ['Current point', 'Next focus', 'Task category', 'Owner'],
  [
    'End of session 2, after the recap of the inbox triage exercise',
    'Session 3',
    'Inbox, calendar, meetings, and the weekly review that ties them together',
    'Learner',
  ],
  ['Session 3', 'Session 4', 'Reports', 'Tutor'],
];

function addTable(extra: Partial<Item> = {}) {
  const doc = createDoc();
  const result = doc.apply(
    [{ op: 'add', item: { id: 't1', kind: 'table', rows, header: true, ...extra } }],
    fellow,
  );
  expect(result.errors).toEqual([]);
  return { doc, table: doc.get('t1')! };
}

/** Every wrapped line fits its column, and every cell's lines fit its row. */
function expectFits(table: Item) {
  const layout = layoutTable(table);
  expect(layout.w).toBeCloseTo(table.w, 6);
  expect(layout.h).toBeCloseTo(table.h, 6);
  layout.lines.forEach((row, r) =>
    row.forEach((lines, c) => {
      const advance = r === 0 ? 0.68 : 0.62;
      for (const line of lines)
        expect(line.length * TABLE.font * advance).toBeLessThanOrEqual(
          layout.cols[c] - TABLE.padX * 2 + 1e-6,
        );
      expect(lines.length * TABLE.font * TABLE.line + TABLE.padY * 2).toBeLessThanOrEqual(
        layout.rows[r] + 1e-6,
      );
      expect(lines.join(' ').replace(/\s+/g, '')).toBe(layout.cells[r][c].replace(/\s+/g, ''));
    }),
  );
}

describe('table kind', () => {
  it('stores a 4x3 table with long cells at a size that fits its text', () => {
    const { table } = addTable();
    expect(table.rows).toEqual(rows);
    expect(table.header).toBe(true);
    expectFits(table);
    const layout = layoutTable(table);
    expect(layout.cols).toHaveLength(4);
    expect(layout.rows).toHaveLength(3);
    // Long cells wrap at the maximum column width instead of making one very wide column.
    expect(Math.max(...layout.cols)).toBe(TABLE.maxInner + TABLE.padX * 2);
    expect(layout.lines[1][0].length).toBeGreaterThan(1);
    expect(layout.rows[1]).toBeGreaterThan(layout.rows[2]);
  });

  it('pads ragged rows, keeps a larger explicit size, and grows a smaller one', () => {
    const doc = createDoc();
    doc.apply(
      [
        { op: 'add', item: { id: 'a', kind: 'table', rows: [['A', 'B', 'C'], ['only one']] } },
        { op: 'add', item: { id: 'b', kind: 'table', rows: [['A', 'B']], w: 600, h: 200 } },
        { op: 'add', item: { id: 'c', kind: 'table', rows, w: 10, h: 10 } },
      ],
      { origin: 'user' },
    );
    expect(doc.get('a')!.rows).toEqual([
      ['A', 'B', 'C'],
      ['only one', '', ''],
    ]);
    const big = doc.get('b')!;
    expect([big.w, big.h]).toEqual([600, 200]);
    const layout = layoutTable(big);
    // Extra width and height spread over columns and rows in proportion.
    expect(layout.cols[0]).toBeCloseTo(300, 6);
    expect(layout.rows[0]).toBeCloseTo(200, 6);
    const small = doc.get('c')!;
    expect(small.w).toBeGreaterThanOrEqual(4 * (TABLE.minInner + TABLE.padX * 2));
    expectFits(small);
  });

  it('rejects missing rows, non-string cells, and oversized tables', () => {
    const doc = createDoc();
    const check = (item: Record<string, unknown>) =>
      doc.apply([{ op: 'add', item: { kind: 'table', ...item } } as never], fellow).errors[0]
        ?.message ?? '';
    expect(check({})).toMatch(/needs rows/);
    expect(check({ rows: [['a', 2]] })).toMatch(/rows/);
    expect(check({ rows: [] })).toMatch(/rows/);
    expect(check({ rows: Array.from({ length: LIMITS.maxTableRows + 1 }, () => ['x']) })).toMatch(
      /rows/,
    );
    expect(
      check({ rows: [Array.from({ length: LIMITS.maxTableColumns + 1 }, () => 'x')] }),
    ).toMatch(/rows/);
    expect(check({ rows: [['x'.repeat(LIMITS.maxCellLength + 1)]] })).toMatch(/rows/);
    expect(doc.query()).toHaveLength(0);
  });

  it('replaces rows, edits one cell, stores rows, and undoes both with the size', () => {
    const { doc, table } = addTable();
    const before = { rows: table.rows, w: table.w, h: table.h };
    const replaced = doc.apply(
      [
        {
          op: 'set',
          id: 't1',
          patch: {
            rows: [
              ['A', 'B'],
              ['1', '2'],
            ],
          },
        },
      ],
      fellow,
    );
    expect(replaced.errors).toEqual([]);
    const small = doc.get('t1')!;
    expect(small.rows).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
    // A table at its natural size follows its text, so it shrinks.
    expect(small.w).toBeLessThan(before.w);
    expectFits(small);

    const changes: unknown[] = [];
    doc.on('change', (event) => changes.push(event.ops));
    const edited = doc.apply(
      [
        {
          op: 'set',
          id: 't1',
          patch: { cells: { '1,1': 'A much longer cell that has to wrap onto more lines' } },
        },
      ],
      fellow,
    );
    expect(edited.errors).toEqual([]);
    const after = doc.get('t1')!;
    expect(after.rows).toEqual([
      ['A', 'B'],
      ['1', 'A much longer cell that has to wrap onto more lines'],
    ]);
    expect(after).not.toHaveProperty('cells');
    expect(JSON.stringify(changes)).not.toContain('"cells"');
    expect(JSON.stringify(changes)).toContain('"rows"');
    expectFits(after);
    expect(after.h).toBeGreaterThan(small.h);

    expect(doc.undo()).toBe(true);
    expect(doc.get('t1')).toMatchObject({ rows: small.rows, w: small.w, h: small.h });
    expect(doc.undo()).toBe(true);
    expect(doc.get('t1')).toMatchObject(before);
    expect(doc.redo()).toBe(true);
    expect(doc.redo()).toBe(true);
    expect(doc.get('t1')).toMatchObject({ rows: after.rows, w: after.w, h: after.h });
  });

  it('rejects out-of-range and malformed cell keys and cells on other kinds', () => {
    const { doc } = addTable();
    doc.apply([{ op: 'add', item: { id: 'r', kind: 'rect', text: 'Box' } }], fellow);
    const revision = doc.revision;
    const error = (id: string, cells: Record<string, string>) =>
      doc.apply([{ op: 'set', id, patch: { cells } }], fellow).errors[0]?.message ?? '';
    expect(error('t1', { '3,0': 'x' })).toMatch(
      /Cell 3,0 is outside table t1 \(3 rows x 4 columns/,
    );
    expect(error('t1', { '0,4': 'x' })).toMatch(/outside/);
    expect(error('t1', { a: 'x' })).toMatch(/cells/);
    expect(error('r', { '0,0': 'x' })).toMatch(/only to table/);
    expect(doc.revision).toBe(revision);
  });

  it('keeps a resized width, wraps more, and grows the height so text never clips', () => {
    const { doc, table } = addTable();
    doc.apply([{ op: 'set', id: 't1', patch: { w: table.w - 200 } }], { origin: 'user' });
    const narrow = doc.get('t1')!;
    expect(narrow.w).toBe(table.w - 200);
    expect(narrow.h).toBeGreaterThan(table.h);
    expectFits(narrow);
    doc.apply([{ op: 'set', id: 't1', patch: { h: 20 } }], { origin: 'user' });
    expect(doc.get('t1')!.h).toBe(narrow.h);
    // A person edit to a resized table keeps the width.
    doc.apply(
      [{ op: 'set', id: 't1', patch: { cells: { '2,3': 'Tutor and learner together' } } }],
      { origin: 'user' },
    );
    expect(doc.get('t1')!.w).toBe(narrow.w);
    expectFits(doc.get('t1')!);
  });

  it('accepts a connector in the same batch, bound and routed to the table edge', () => {
    const doc = createDoc();
    const result = doc.apply(
      [
        { op: 'add', item: { id: 't1', kind: 'table', rows, header: true } },
        { op: 'add', item: { id: 'next', kind: 'rect', text: 'Next step' } },
        { op: 'add', item: { id: 'c1', kind: 'arrow', from: 't1', to: 'next' } },
      ],
      fellow,
    );
    expect(result.errors).toEqual([]);
    const table = doc.get('t1')!,
      next = doc.get('next')!,
      connector = doc.get('c1')!;
    expect(connector.from).toMatchObject({ item: 't1' });
    expect(connector.to).toMatchObject({ item: 'next' });
    // The layout treats the table as a box: the next step sits clear of it, right of it or below.
    expect(
      next.x >= table.x + table.w || next.y >= table.y + table.h,
      `next at ${next.x},${next.y}`,
    ).toBe(true);
    const lookup = new Map(doc.query().map((item) => [item.id, item]));
    const start = routeConnector(connector, lookup).points[0];
    const onEdge =
      Math.abs(start.x - table.x) < 1 ||
      Math.abs(start.x - (table.x + table.w)) < 1 ||
      Math.abs(start.y - table.y) < 1 ||
      Math.abs(start.y - (table.y + table.h)) < 1;
    expect(onEdge).toBe(true);
    expect(start.x).toBeGreaterThanOrEqual(table.x - 1);
    expect(start.x).toBeLessThanOrEqual(table.x + table.w + 1);
    expect(start.y).toBeGreaterThanOrEqual(table.y - 1);
    expect(start.y).toBeLessThanOrEqual(table.y + table.h + 1);
  });

  it('exports every cell to SVG with the headless column layout', () => {
    const { doc, table } = addTable();
    const svg = exportSVG(doc.toJSON(), doc.query());
    const layout = layoutTable(table);
    for (const row of rows)
      for (const cell of row)
        for (const line of wrapPlainText(cell, 1e6, TABLE.font))
          for (const word of line.split(' ')) expect(svg).toContain(word);
    const group = svg.slice(svg.indexOf('data-ad-id="t1"'));
    const xs = [...group.matchAll(/<text x="([\d.]+)"/g)].map((match) => Number(match[1]));
    expect(new Set(xs)).toEqual(new Set(layout.x.slice(0, -1).map((x) => x + TABLE.padX)));
    // Inner column rules sit on the layout edges.
    for (const x of layout.x.slice(1, -1))
      expect(group).toContain(`M${Math.round(x * 1000) / 1000},0V`);
    expect(group).toContain('font-weight="700"');
    expect(group).not.toContain('Unknown kind');
    const dark = exportSVG(doc.toJSON(), doc.query(), { theme: 'dark' });
    expect(dark).toContain('#173D40');
  });

  it('describes size and header, and query finds a table by cell text', () => {
    const { doc } = addTable();
    expect(doc.describe()).toContain(
      't1 table 4x3 header "Current point" "Next focus" "Task category" "Owner" at (',
    );
    doc.apply(
      [{ op: 'add', item: { id: 't2', kind: 'table', rows: [['a "quoted"\nline', 'b']] } }],
      fellow,
    );
    expect(doc.describe()).toContain('t2 table 2x1 first row "a \\"quoted\\"\\nline" "b"');
    expect(doc.query({ text: 'reports' }).map((item) => item.id)).toEqual(['t1']);
    expect(doc.query({ kind: 'table', text: /quoted/ }).map((item) => item.id)).toEqual(['t2']);
  });

  it('is in the catalog at version 4 and accepted by the apply tool schema', async () => {
    const entry = kindsSince(3).kinds.find((kind) => kind.kind === 'table');
    expect(entry).toMatchObject({ since: 4 });
    expect(entry!.note).toMatch(/rows/);
    expect(entry!.note).toMatch(/cells/);
    const input = {
      ops: [
        { op: 'add', item: { id: 't1', kind: 'table', rows, header: true } },
        { op: 'set', id: 't1', patch: { cells: { '1,2': 'Reports' } } },
      ],
      origin: 'agent:fellow',
    };
    expect(v.safeParse(toolSchemas.board_apply, input).success).toBe(true);
    expect(
      v.safeParse(toolSchemas.board_apply, {
        ops: [{ op: 'add', item: { kind: 'table', rows: [[1]] } }],
      }).success,
    ).toBe(false);
    const doc = createDoc();
    const result = (await runTool(doc, 'board_apply', input)) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(doc.get('t1')!.rows![1][2]).toBe('Reports');
  });

  it('round-trips rows and header through toJSON and load', () => {
    const { doc, table } = addTable();
    const json = doc.toJSON();
    expect(json.version).toBe(2);
    const copy = createDoc();
    copy.load(JSON.parse(JSON.stringify(json)));
    expect(copy.get('t1')).toEqual(table);
    const compact = createDoc();
    compact.load(doc.toJSON({ compact: true }));
    expect(compact.get('t1')).toMatchObject({ rows, header: true, w: table.w, h: table.h });
    expect(() =>
      copy.load({
        ...json,
        pages: [{ ...json.pages[0], items: [{ id: 'x', kind: 'table', x: 0, y: 0, w: 1, h: 1 }] }],
      }),
    ).toThrow(/needs rows/);
  });

  it('finds the cell under a page point, rotation included', () => {
    const { table } = addTable({ x: 100, y: 50 });
    const layout = layoutTable(table);
    const mid = (r: number, c: number) => ({
      x: table.x + (layout.x[c] + layout.x[c + 1]) / 2,
      y: table.y + (layout.y[r] + layout.y[r + 1]) / 2,
    });
    expect(cellAt(table, mid(1, 2))).toEqual([1, 2]);
    expect(cellAt(table, { x: -1e6, y: 1e6 })).toEqual([2, 0]);
    const turned = { ...table, rotation: 180 };
    const p = mid(0, 0);
    const cx = table.x + table.w / 2,
      cy = table.y + table.h / 2;
    expect(cellAt(turned, { x: 2 * cx - p.x, y: 2 * cy - p.y })).toEqual([0, 0]);
  });
});
