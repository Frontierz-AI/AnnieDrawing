import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import {
  createDoc,
  itemBounds,
  kindsSince,
  markGeometry,
  OpsSchema,
  routeConnector,
  type AnnieDoc,
  type Box,
  type Item,
  type Op,
} from '../src/core';
import { markRects } from '../src/core/mark';
import { toolDefs, toolSchemas } from '../src/agent/toolDefs';
import { exportSVG } from '../src/porter/svg';

const fellow = { origin: 'agent:fellow' } as const;
const notes = 'Prepare the room. Exactly 1 trial run before the class starts, then rest.';

function board(items: Op[] = []) {
  const doc = createDoc();
  const result = doc.apply(items);
  expect(result.errors).toEqual([]);
  return doc;
}
const lookupOf = (doc: ReturnType<typeof createDoc>) =>
  new Map(doc.query().map((item) => [item.id, item]));
const boundsOfId = (doc: ReturnType<typeof createDoc>, id: string) =>
  itemBounds(doc.get(id)!, lookupOf(doc));
const notesNode = (extra: Partial<Item> = {}): Op => ({
  op: 'add',
  item: { id: 'notes', kind: 'rect', x: 100, y: 80, w: 220, h: 160, text: notes, ...extra },
});

/** The text of exporter markup: what sits between its tags, joined. Reads; it does not sanitize. */
const textBetweenTags = (markup: string) =>
  [...markup.matchAll(/(?:^|>)([^<>]*)/g)].map((piece) => piece[1]).join('');

/** Exported rows of one label: `[x, baseline y, text]`, from the exporter's own tspans. */
function exportedRows(svg: string, id: string): [number, number, string][] {
  const group = svg.slice(svg.indexOf(`data-ad-id="${id}"`));
  const text = group.slice(group.indexOf('<text'), group.indexOf('</text>'));
  const lineHeight = Number(/font-size="([\d.]+)"/.exec(text)![1]) * 1.35;
  const absolute = [
    ...text.matchAll(/<tspan x="([-\d.]+)" y="([-\d.]+)"[^>]*>((?:(?!<tspan x=).)*)/g),
  ];
  if (absolute.length)
    return absolute.map((m) => [Number(m[1]), Number(m[2]), textBetweenTags(m[3])]);
  const top = Number(/<text x="[-\d.]+" y="([-\d.]+)"/.exec(text)![1]);
  return [...text.matchAll(/<tspan x="([-\d.]+)" dy="[-\d.]+">([^<]*)<\/tspan>/g)].map((m, i) => [
    Number(m[1]),
    top + i * lineHeight,
    m[2],
  ]);
}

/** The mark group's frame translation and its first path's points. */
function exportedMark(svg: string, id: string) {
  const group = svg.slice(svg.indexOf(`data-ad-id="${id}"`));
  const [, x, y] = /<g transform="translate\(([-\d.]+) ([-\d.]+)\)/.exec(group)!;
  const d = /<path d="([^"]+)"/.exec(group)![1];
  const points = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
  return { x: Number(x), y: Number(y), points, group: group.slice(0, group.indexOf('</g></g>')) };
}

describe('mark geometry', () => {
  it('places a phrase on the rows the exporter draws, for plain and md labels', () => {
    for (const text of [
      { value: notes, align: 'start' as const, valign: 'top' as const },
      { value: notes },
      {
        value: `# Plan\n- Prepare the room.\n- **Exactly 1 trial run** first`,
        format: 'md' as const,
      },
      {
        value: `- Prepare the room.\n- **Exactly 1 trial run** first`,
        format: 'md' as const,
        align: 'start' as const,
      },
    ]) {
      const doc = board([notesNode({ text })]);
      doc.apply([{ op: 'add', item: { id: 'm', kind: 'mark', target: 'notes', match: 'trial' } }]);
      const target = doc.get('notes')!;
      const [rect] = markRects(doc.get('m')!, target, target);
      const svg = exportSVG(doc.toJSON(), doc.toJSON().pages[0].items);
      const row = exportedRows(svg, 'notes').find(([, , line]) => line.includes('trial'))!;
      // Baseline one font size below the row top, as textMarkup and richTextRows draw it.
      expect(rect.y + 18, JSON.stringify(text)).toBeCloseTo(row[1], 3);
      const before = row[2].slice(0, row[2].indexOf('trial'));
      // md rows use the line's average advance, wider for bold; plain rows use 0.53 em.
      if (text.align === 'start' && !text.format)
        expect(rect.x - before.length * 18 * 0.53).toBeCloseTo(row[0], 0);
      expect(rect.w).toBeGreaterThan(4 * 18 * 0.53);
    }
  });

  it('wraps across rows: highlight per row, circle and box around the union', () => {
    const doc = board([notesNode({ w: 200 })]);
    doc.apply([
      {
        op: 'add',
        item: {
          id: 'h',
          kind: 'mark',
          target: 'notes',
          match: 'Exactly 1 trial run before the class',
        },
      },
      {
        op: 'add',
        item: {
          id: 'c',
          kind: 'mark',
          target: 'notes',
          match: 'Exactly 1 trial run before the class',
          mark: 'circle',
        },
      },
    ]);
    const lookup = lookupOf(doc);
    const highlight = markGeometry(doc.get('h')!, lookup)!;
    expect(highlight.rects.length).toBeGreaterThan(1);
    expect(highlight.shapes).toHaveLength(highlight.rects.length);
    const circle = markGeometry(doc.get('c')!, lookup)!;
    expect(circle.shapes).toHaveLength(1);
    const loop = boundsOfId(doc, 'c'),
      rows = boundsOfId(doc, 'h');
    expect(loop.x).toBeLessThan(rows.x);
    expect(loop.x + loop.w).toBeGreaterThan(rows.x + rows.w);
    // Seeded by the id: the same loop on every call.
    expect(markGeometry(doc.get('c')!, lookup)!.shapes).toEqual(circle.shapes);
  });

  it('follows the target through moves, resizes that re-wrap, rotation, and text edits', () => {
    const doc = board([notesNode()]);
    doc.apply([
      { op: 'add', item: { id: 'm', kind: 'mark', target: 'notes', match: 'Exactly 1 trial run' } },
    ]);
    const start = boundsOfId(doc, 'm');
    doc.apply([{ op: 'set', id: 'notes', patch: { x: 400, y: 300 } }]);
    const moved = boundsOfId(doc, 'm');
    expect(moved.x - start.x).toBeCloseTo(300, 6);
    expect(moved.y - start.y).toBeCloseTo(220, 6);
    expect(moved.w).toBeCloseTo(start.w, 6);

    const before = markGeometry(doc.get('m')!, lookupOf(doc))!.rects;
    doc.apply([{ op: 'set', id: 'notes', patch: { w: 520 } }]);
    const wide = markGeometry(doc.get('m')!, lookupOf(doc))!.rects;
    expect(wide).toHaveLength(1);
    expect(JSON.stringify(wide)).not.toBe(JSON.stringify(before));
    const svg = exportSVG(doc.toJSON(), doc.toJSON().pages[0].items);
    const row = exportedRows(svg, 'notes').findIndex(([, , line]) => line.includes('Exactly'));
    expect(row).toBeGreaterThanOrEqual(0);

    doc.apply([{ op: 'set', id: 'notes', patch: { text: `A new first sentence. ${notes}` } }]);
    const edited = markGeometry(doc.get('m')!, lookupOf(doc))!.rects;
    expect(JSON.stringify(edited)).not.toBe(JSON.stringify(wide));
    const width = edited.reduce((sum, row) => sum + row.w, 0);
    expect(Math.abs(width - wide[0].w)).toBeLessThanOrEqual(18 * 0.53 + 1e-6);

    doc.apply([{ op: 'set', id: 'notes', patch: { rotation: 90 } }]);
    const turned = boundsOfId(doc, 'm');
    const flat = { ...doc.get('notes')!, rotation: 0 };
    const unturned = itemBounds(doc.get('m')!, new Map([...lookupOf(doc), ['notes', flat]]));
    expect(turned.w).toBeCloseTo(unturned.h, 6);
    expect(turned.h).toBeCloseTo(unturned.w, 6);
  });

  it('matches md against the visible text, not the source', () => {
    const doc = board([
      notesNode({ text: { value: '- First **Exactly 1 trial run** step', format: 'md' } }),
    ]);
    doc.apply([
      {
        op: 'add',
        item: { id: 'seen', kind: 'mark', target: 'notes', match: 'Exactly 1 trial run' },
      },
      { op: 'add', item: { id: 'source', kind: 'mark', target: 'notes', match: '**Exactly' } },
    ]);
    const target = doc.get('notes')!;
    expect(markRects(doc.get('seen')!, target, target)[0].w).toBeLessThan(target.w / 2 + 40);
    expect(markRects(doc.get('source')!, target, target)).toEqual([
      { x: 0, y: 0, w: target.w, h: target.h },
    ]);
  });

  it('covers the whole item without a phrase, and falls back to it when the phrase is gone', () => {
    const doc = board([notesNode()]);
    doc.apply([
      { op: 'add', item: { id: 'whole', kind: 'mark', target: 'notes', mark: 'box' } },
      { op: 'add', item: { id: 'm', kind: 'mark', target: 'notes', match: 'trial run' } },
    ]);
    const node = boundsOfId(doc, 'notes');
    expect(boundsOfId(doc, 'whole')).toMatchObject({ x: node.x - 4 - 1.25, w: node.w + 8 + 2.5 });
    expect(boundsOfId(doc, 'm').w).toBeLessThan(node.w);
    const result = doc.apply([{ op: 'set', id: 'notes', patch: { text: 'No phrase here' } }]);
    expect(result.ok).toBe(true);
    expect(doc.get('m')).toMatchObject({ match: 'trial run' });
    // A fallback highlight is a halo around the node: 6 px out, 8 px wide.
    expect(boundsOfId(doc, 'm')).toEqual({
      x: node.x - 10,
      y: node.y - 10,
      w: node.w + 20,
      h: node.h + 20,
    });
  });

  it('highlights a whole item with a halo around it, and whole text with a band', () => {
    const doc = board([
      notesNode({ style: { fill: 'teal', fillMode: 'tint' } }),
      { op: 'add', item: { id: 'oval', kind: 'ellipse', x: 400, y: 80, w: 200, h: 120 } },
      { op: 'add', item: { id: 'gem', kind: 'diamond', x: 700, y: 80, w: 160, h: 140 } },
      {
        op: 'add',
        item: { id: 'line', kind: 'text', x: 100, y: 320, w: 300, h: 25, text: 'A line' },
      },
    ]);
    doc.apply(
      ['notes', 'oval', 'gem', 'line'].map((target) => ({
        op: 'add' as const,
        item: { id: `h_${target}`, kind: 'mark', target },
      })),
    );
    const lookup = lookupOf(doc);
    const inside = (target: Item, p: { x: number; y: number }) => {
      const x = (p.x - target.w / 2) / (target.w / 2),
        y = (p.y - target.h / 2) / (target.h / 2);
      return target.kind === 'ellipse'
        ? x * x + y * y < 1
        : target.kind === 'diamond'
          ? Math.abs(x) + Math.abs(y) < 1
          : Math.abs(x) < 1 && Math.abs(y) < 1;
    };
    for (const id of ['notes', 'oval', 'gem']) {
      const target = doc.get(id)!,
        { shapes } = markGeometry(doc.get(`h_${id}`)!, lookup)!;
      expect(shapes, id).toHaveLength(1);
      expect(shapes[0]).toMatchObject({ fill: false, halo: true });
      // The band is closed and every point of its center line is outside the item.
      expect(shapes[0].points.at(-1)).toEqual(shapes[0].points[0]);
      for (const point of shapes[0].points) expect(inside(target, point), id).toBe(false);
      const box = boundsOfId(doc, `h_${id}`);
      expect(box.x).toBeLessThan(target.x - 9.9);
      expect(box.w).toBeGreaterThan(target.w + 19.9);
    }
    // Standalone text has no fill to protect: the marker band stays.
    expect(markGeometry(doc.get('h_line')!, lookup)!.shapes).toEqual([
      expect.objectContaining({ fill: true }),
    ]);
    expect(boundsOfId(doc, 'h_line')).toEqual(boundsOfId(doc, 'line'));
    // A phrase highlight inside a filled node stays a band over that text only.
    doc.apply([
      { op: 'add', item: { id: 'p', kind: 'mark', target: 'notes', match: 'trial run' } },
    ]);
    expect(markGeometry(doc.get('p')!, lookupOf(doc))!.shapes.every((shape) => shape.fill)).toBe(
      true,
    );
  });

  it('keeps ink readable on a highlighted node of every agent tint and mark color', () => {
    const tints = ['teal', 'sky', 'violet', 'amber', 'rose', 'coral', 'moss'];
    const marks = [...tints, 'ink', 'slate', '#d35400'];
    const channel = (value: number) =>
      value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    const rgb = (hex: string) =>
      [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];
    const luminance = ([r, g, b]: number[]) =>
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const contrast = (a: number[], b: number[]) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    for (const theme of ['light', 'dark'] as const)
      for (const tint of tints) {
        const doc = board([
          {
            op: 'add',
            item: {
              id: 'n',
              kind: 'rect',
              x: 0,
              y: 0,
              w: 200,
              h: 110,
              text: 'Step',
              style: { fill: tint, fillMode: 'tint' },
            },
          },
        ]);
        doc.apply(
          marks.map((stroke, index) => ({
            op: 'add' as const,
            item: { id: `m${index}`, kind: 'mark', target: 'n', style: { stroke } },
          })),
        );
        const svg = exportSVG(doc.toJSON(), doc.toJSON().pages[0].items, { theme });
        // Nothing a highlight draws is filled, so the node's own fill is what the label sits on.
        const drawn = [...svg.matchAll(/data-ad-kind="mark"[^>]*>(.*?)<\/g>/g)].map((m) => m[1]);
        expect(drawn).toHaveLength(marks.length);
        for (const markup of drawn) {
          expect(markup).toContain('fill="none"');
          expect(markup).not.toContain('fill-opacity');
        }
        // The tint is the fill at 22% over the paper; ink on it must keep 4.5:1.
        const node = /data-ad-id="n"[^>]*>.*?<path[^>]* fill="(#[0-9a-fA-F]{6})"/.exec(svg)![1];
        const ink = /data-ad-id="n".*?<text[^>]* fill="(#[0-9a-fA-F]{6})"/.exec(svg)![1];
        const paper = /<rect[^>]* fill="(#[0-9a-fA-F]{6})"/.exec(svg)![1];
        const fill = rgb(node).map((value, i) => value * 0.22 + rgb(paper)[i] * 0.78);
        expect(contrast(rgb(ink), fill), `${theme} ${tint}`).toBeGreaterThanOrEqual(4.5);
      }
  });
});

describe('mark lifecycle', () => {
  it('removing the target removes its marks; undo restores both and redo removes both', () => {
    const doc = board([
      notesNode(),
      { op: 'add', item: { id: 'other', kind: 'rect', x: 500, y: 80, text: 'Other' } },
    ]);
    doc.apply([
      {
        op: 'add',
        item: { id: 'm1', kind: 'mark', target: 'notes', match: 'trial run', mark: 'circle' },
      },
      { op: 'add', item: { id: 'keep', kind: 'mark', target: 'other', mark: 'underline' } },
      { op: 'add', item: { id: 'last', kind: 'rect', x: 900, y: 80 } },
      { op: 'add', item: { id: 'm2', kind: 'mark', target: 'notes', mark: 'box' } },
    ]);
    const before = doc.toJSON();
    const result = doc.apply([{ op: 'remove', id: 'notes' }], { origin: 'user' });
    expect(result.ok).toBe(true);
    expect(result.removed.sort()).toEqual(['m1', 'm2', 'notes']);
    expect(doc.get('m1')).toBeUndefined();
    expect(doc.get('m2')).toBeUndefined();
    expect(doc.get('keep')).toBeDefined();
    expect(doc.undo()).toBe(true);
    expect(doc.toJSON()).toEqual(before);
    expect(doc.redo()).toBe(true);
    expect(doc.query().map((item) => item.id)).toEqual(['other', 'keep', 'last']);
  });

  it('removing a group removes marks on its children, wherever the marks are', () => {
    const doc = board([
      {
        op: 'add',
        item: {
          id: 'g',
          kind: 'group',
          children: [{ id: 'inner', kind: 'rect', x: 0, y: 0, text: 'Inside' }],
        },
      },
      { op: 'add', item: { id: 'host', kind: 'group', children: [] } },
    ]);
    doc.apply([
      {
        op: 'add',
        parent: 'host',
        item: { id: 'm', kind: 'mark', target: 'inner', mark: 'underline' },
      },
      { op: 'add', item: { id: 'top', kind: 'mark', target: 'g', mark: 'box' } },
    ]);
    expect(boundsOfId(doc, 'top').w).toBeGreaterThan(0);
    const before = doc.toJSON();
    doc.apply([{ op: 'remove', id: 'g' }]);
    expect(doc.query().map((item) => item.id)).toEqual(['host']);
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
  });

  it('rejects a missing target, a mark target, and a connector target for new ops', () => {
    const doc = board([
      notesNode(),
      { op: 'add', item: { id: 'b', kind: 'rect', x: 500, y: 0 } },
      { op: 'add', item: { id: 'arrow', kind: 'arrow', from: 'notes', to: 'b' } },
      { op: 'add', item: { id: 'm', kind: 'mark', target: 'notes' } },
    ]);
    for (const target of ['nope', 'm', 'arrow']) {
      const result = doc.apply([{ op: 'add', item: { kind: 'mark', target } }], fellow);
      expect(result.ok, target).toBe(false);
      expect(result.errors[0].message).toMatch(/Mark/);
    }
    expect(doc.apply([{ op: 'set', id: 'm', patch: { target: 'nope' } }]).ok).toBe(false);
    expect(doc.apply([{ op: 'add', item: { kind: 'arrow', from: 'm', to: 'b' } }]).ok).toBe(false);
    expect(doc.apply([{ op: 'set', id: 'm', patch: { target: 'b' } }]).ok).toBe(true);
  });

  it('checks marks nested in a group, a new page, or replaced children', () => {
    const doc = board([
      notesNode(),
      { op: 'add', item: { id: 'b', kind: 'rect', x: 500, y: 0 } },
      { op: 'add', item: { id: 'arrow', kind: 'arrow', from: 'notes', to: 'b' } },
    ]);
    const group = (children: Item[]): Op => ({
      op: 'add',
      item: { id: 'g', kind: 'group', children },
    });
    const mark = (target: string) => ({ id: 'gm', kind: 'mark', target }) as Item;
    const inner = { id: 'in', kind: 'rect', x: 0, y: 300, w: 80, h: 60 } as Item;
    for (const target of ['nope', 'arrow', 'gm']) {
      const result = doc.apply([group([inner, mark(target)])], fellow);
      expect(result.ok, target).toBe(false);
      expect(result.errors[0].message).toMatch(/Mark gm/);
      const paged = doc.apply([{ op: 'page.add', page: { name: 'Two', items: [mark(target)] } }]);
      expect(paged.ok, `page ${target}`).toBe(false);
    }
    // A nested mark may target a sibling in the same tree, or an item already on the page.
    expect(doc.apply([group([inner, mark('in')])], fellow).errors).toEqual([]);
    expect(doc.get('gm')).toMatchObject({ target: 'in', x: 0, y: 0, w: 0, h: 0 });
    expect(doc.apply([{ op: 'set', id: 'gm', patch: { target: 'notes' } }]).ok).toBe(true);
    const second = [
      { ...inner, id: 'in2' },
      { ...mark('in2'), id: 'pm' },
    ];
    expect(doc.apply([{ op: 'page.add', page: { name: 'Two', items: second } }]).errors).toEqual(
      [],
    );
    // Replacing children: a mark the patch introduces is checked, one it resends is kept.
    const kept = doc.get('g')!.children!;
    const bad = { id: 'gm2', kind: 'mark', target: 'nope' } as Item;
    expect(doc.apply([{ op: 'set', id: 'g', patch: { children: [...kept, bad] } }]).ok).toBe(false);
    expect(doc.apply([{ op: 'set', id: 'g', patch: { children: kept } }]).errors).toEqual([]);
  });

  it('loads documents whose marks lost their target and keeps them', () => {
    const doc = board([notesNode()]);
    doc.apply([{ op: 'add', item: { id: 'm', kind: 'mark', target: 'notes', match: 'trial' } }]);
    const saved = doc.toJSON();
    saved.pages[0].items = saved.pages[0].items.filter((item) => item.id !== 'notes');
    const other = createDoc(saved);
    expect(other.get('m')).toMatchObject({ target: 'notes', match: 'trial' });
    expect(other.describe()).toContain('m: highlight on notes "trial" (target missing)');
    expect(other.toJSON()).toEqual(saved);
    const svg = exportSVG(other.toJSON(), other.toJSON().pages[0].items);
    expect(svg).not.toContain('data-ad-kind="mark"');
  });

  it('ignores x, y, w, h, and rotation on a mark; compact JSON omits them; JSON round-trips', () => {
    const doc = board([notesNode()]);
    doc.apply([
      {
        op: 'add',
        item: {
          id: 'm',
          kind: 'mark',
          target: 'notes',
          match: 'trial',
          x: 5,
          y: 6,
          w: 7,
          h: 8,
          rotation: 9,
        },
      },
    ]);
    expect(doc.get('m')).toMatchObject({ x: 0, y: 0, w: 0, h: 0 });
    expect(doc.get('m')!.rotation).toBeUndefined();
    const bounds = boundsOfId(doc, 'm');
    doc.apply([{ op: 'set', id: 'm', patch: { x: 50, y: 50, w: 10 } }]);
    expect(doc.get('m')).toMatchObject({ x: 0, y: 0, w: 0 });
    expect(boundsOfId(doc, 'm')).toEqual(bounds);
    doc.apply([{ op: 'set', id: 'm', patch: { mark: 'underline' } }]);
    const compact = doc.toJSON().pages[0].items.find((item) => item.id === 'm')!;
    expect(compact).toEqual({
      id: 'm',
      kind: 'mark',
      target: 'notes',
      match: 'trial',
      mark: 'underline',
    });
    const copy = createDoc(doc.toJSON());
    expect(copy.toJSON()).toEqual(doc.toJSON());
    expect(copy.get('m')).toEqual(doc.get('m'));
  });

  it('follows remapped ids in an agent batch and when copied with its target', () => {
    const doc = board([notesNode()]);
    const result = doc.apply(
      [
        {
          op: 'add',
          item: { id: 'notes', kind: 'note', x: 600, y: 0, text: 'Exactly 1 trial run' },
        },
        {
          op: 'add',
          item: { id: 'm', kind: 'mark', target: 'notes', match: 'trial', mark: 'circle' },
        },
      ],
      fellow,
    );
    expect(result.created).toEqual(['notes_1', 'm']);
    expect(doc.get('m')!.target).toBe('notes_1');
  });

  it('lists in describe with type, target, and phrase, and in the catalog since 4', () => {
    const doc = board([notesNode()]);
    doc.apply(
      [
        {
          op: 'add',
          item: {
            id: 'm1',
            kind: 'mark',
            target: 'notes',
            match: 'Exactly 1 trial run',
            mark: 'circle',
            style: { stroke: 'coral' },
          },
        },
        { op: 'add', item: { id: 'm2', kind: 'mark', target: 'notes', mark: 'highlight' } },
      ],
      fellow,
    );
    const text = doc.describe();
    expect(text).toMatch(/^Marks:$/m);
    expect(text).toMatch(
      /^ {2}m1: circle on notes "Exactly 1 trial run" at \([\d.-]+,[\d.-]+\) [\d.]+×[\d.]+, stroke coral, by agent$/m,
    );
    expect(text).toMatch(/^ {2}m2: highlight on notes at /m);
    expect(text).not.toMatch(/^m1 mark/m);
    expect(doc.describe({ detail: 'brief' })).toMatch(
      /^ {2}m1: circle on notes "Exactly 1 trial run"$/m,
    );
    const catalog = kindsSince(3);
    expect(catalog.version).toBe(4);
    expect(catalog.kinds.find((kind) => kind.kind === 'mark')).toMatchObject({ since: 4 });
    expect(doc.kindsSince(3).kinds.map((kind) => kind.kind)).toContain('mark');
  });

  it('the tool schema accepts both example ops', () => {
    const ops = [
      { op: 'add', item: { id: 'm1', kind: 'mark', target: 'step3', mark: 'highlight' } },
      {
        op: 'add',
        item: {
          id: 'm2',
          kind: 'mark',
          target: 'notes',
          match: 'Exactly 1 trial run',
          mark: 'circle',
          style: { stroke: 'coral' },
        },
      },
    ];
    expect(v.safeParse(toolSchemas.board_apply, { ops }).success).toBe(true);
    expect(
      v.safeParse(OpsSchema, [{ op: 'add', item: { kind: 'mark', target: 'a', mark: 'zigzag' } }])
        .success,
    ).toBe(false);
    const apply = toolDefs.find((tool) => tool.name === 'board_apply')!;
    expect(JSON.stringify(apply.inputSchema)).toContain('"underline"');
  });
});

describe('marks never take space', () => {
  const existing: Op[] = [
    {
      op: 'add',
      item: { id: 'a', kind: 'rect', x: 0, y: 0, w: 180, h: 110, text: 'Alpha has a label' },
    },
    {
      op: 'add',
      item: { id: 'b', kind: 'rect', x: 400, y: 0, w: 300, h: 110, text: 'Beta has a label' },
    },
    {
      op: 'add',
      item: {
        id: 'g',
        kind: 'group',
        children: [{ id: 'gc', kind: 'rect', x: 0, y: 400, text: 'Grouped' }],
      },
    },
  ];
  const marks: Op[] = [
    { op: 'add', item: { id: 'ma', kind: 'mark', target: 'a', mark: 'circle' } },
    { op: 'add', item: { id: 'mb', kind: 'mark', target: 'b', mark: 'circle' } },
    { op: 'add', item: { id: 'mb2', kind: 'mark', target: 'b', mark: 'box', match: 'label' } },
    { op: 'add', parent: 'g', item: { id: 'mg', kind: 'mark', target: 'gc', mark: 'circle' } },
  ];
  const batches: { ops: Op[]; origin: string }[] = [
    {
      ops: [
        {
          op: 'add',
          item: { id: 'c', kind: 'rect', text: 'Right of a' },
          place: { rightOf: 'a', gap: 8 },
        },
      ],
      origin: 'agent:fellow',
    },
    {
      ops: [{ op: 'add', item: { id: 'd', kind: 'rect', text: 'Unpositioned' } }],
      origin: 'agent:fellow',
    },
    {
      ops: [
        { op: 'add', item: { id: 'e', kind: 'rect', text: 'After b' } },
        { op: 'add', item: { id: 'be', kind: 'arrow', from: 'b', to: 'e' } },
      ],
      origin: 'agent:fellow',
    },
    {
      ops: [{ op: 'add', item: { id: 'f', kind: 'rect', text: 'Near b' }, place: { near: 'b' } }],
      origin: 'agent:fellow',
    },
    {
      ops: [
        {
          op: 'add',
          item: { id: 'h', kind: 'rect', w: 100, h: 60 },
          place: { below: 'gc', gap: 4 },
        },
      ],
      origin: 'api',
    },
    {
      ops: [
        { op: 'add', item: { id: 'i', kind: 'rect', text: 'Inserted' }, place: { rightOf: 'b' } },
        { op: 'add', item: { id: 'bi', kind: 'arrow', from: 'b', to: 'i' } },
        { op: 'add', item: { id: 'ie', kind: 'arrow', from: 'i', to: 'e' } },
      ],
      origin: 'agent:fellow',
    },
  ];
  const positions = (doc: ReturnType<typeof createDoc>) =>
    Object.fromEntries(
      doc
        .query()
        .filter((item) => item.kind !== 'mark')
        .map((item) => [
          item.id,
          [item.x, item.y, item.w, item.h, item.from, item.to, item.waypoints],
        ]),
    );

  it('gives every agent and API batch the same positions with or without marks', () => {
    const plain = board(existing),
      marked = board([...existing, ...marks]);
    // The slots really are covered, so excluding the marks matters.
    const slot: Box = { x: 188, y: 0, w: 180, h: 110 };
    const ma = boundsOfId(marked, 'ma'),
      mb = boundsOfId(marked, 'mb');
    expect(ma.x + ma.w).toBeGreaterThan(slot.x);
    expect(mb.x + mb.w).toBeGreaterThan(700 + 32);
    for (const { ops, origin } of batches) {
      const a = plain.apply(ops, { origin }),
        b = marked.apply(ops, { origin });
      expect(b.ok).toBe(true);
      expect(b.created).toEqual(a.created);
      expect(b.moved).toEqual(a.moved);
      expect(b.warnings).toEqual(a.warnings);
      expect(positions(marked)).toEqual(positions(plain));
    }
    expect(positions(plain).i).toBeDefined();
  });

  it('adds marks without overlap warnings or moving anything', () => {
    const doc = board(existing);
    const before = positions(doc);
    const result = doc.apply(marks, fellow);
    expect(result.warnings).toEqual([]);
    expect(result.moved).toBeUndefined();
    expect(positions(doc)).toEqual(before);
  });

  it('routes an unrelated connector the same with a mark in its path', () => {
    const ops: Op[] = [
      { op: 'add', item: { id: 'p', kind: 'rect', x: 0, y: 200, w: 120, h: 110 } },
      { op: 'add', item: { id: 'q', kind: 'rect', x: 600, y: 200, w: 120, h: 110 } },
      {
        op: 'add',
        item: { id: 't', kind: 'rect', x: 250, y: 130, w: 200, h: 110, text: 'Above the path' },
      },
      { op: 'add', item: { id: 'link', kind: 'arrow', from: 'p', to: 'q' } },
    ];
    const plain = board(ops),
      marked = board([
        ...ops,
        { op: 'add', item: { id: 'ring', kind: 'mark', target: 't', mark: 'circle' } },
      ]);
    const route = (doc: ReturnType<typeof createDoc>) =>
      routeConnector(doc.get('link')!, lookupOf(doc)).points;
    const ring = boundsOfId(marked, 'ring');
    expect(ring.y + ring.h).toBeGreaterThan(255);
    expect(route(marked)).toEqual(route(plain));
  });
});

describe('mark export', () => {
  it('draws each mark type at the exported phrase position', () => {
    const doc = board([notesNode({ text: { value: notes, align: 'start' } })]);
    for (const mark of ['highlight', 'underline', 'circle', 'box'] as const)
      doc.apply([
        {
          op: 'add',
          item: { id: mark, kind: 'mark', target: 'notes', match: 'Exactly 1 trial run', mark },
        },
      ]);
    const json: AnnieDoc = doc.toJSON();
    const svg = exportSVG(json, json.pages[0].items, { labels: true });
    const lookup = lookupOf(doc);
    const phrase = markGeometry(doc.get('highlight')!, lookup)!.rects;
    const union = (points: { x: number; y: number }[]) => ({
      x: Math.min(...points.map((p) => p.x)),
      y: Math.min(...points.map((p) => p.y)),
      r: Math.max(...points.map((p) => p.x)),
      b: Math.max(...points.map((p) => p.y)),
    });
    for (const mark of ['highlight', 'underline', 'circle', 'box']) {
      const out = exportedMark(svg, mark);
      expect(out.group, mark).toContain('data-ad-kind="mark"');
      expect([out.x, out.y]).toEqual([100, 80]);
      const box = union(out.points);
      const first = phrase[0];
      if (mark === 'highlight')
        for (const [key, value] of Object.entries({
          x: first.x,
          y: first.y,
          r: first.x + first.w,
          b: first.y + first.h,
        }))
          expect(box[key as keyof typeof box]).toBeCloseTo(value, 2);
      if (mark === 'underline') {
        expect(box.x).toBeCloseTo(first.x, 2);
        expect(box.r).toBeCloseTo(first.x + first.w, 2);
        expect(box.y).toBeGreaterThan(first.y + first.h * 0.8);
      }
      if (mark === 'box' || mark === 'circle') {
        const all = union(
          phrase.flatMap((r) => [
            { x: r.x, y: r.y },
            { x: r.x + r.w, y: r.y + r.h },
          ]),
        );
        expect(box.x).toBeLessThan(all.x);
        expect(box.y).toBeLessThan(all.y);
        expect(box.r).toBeGreaterThan(all.r);
        expect(box.b).toBeGreaterThan(all.b);
      }
    }
    expect(svg).toContain('mix-blend-mode:multiply');
    // The label sits on the phrase, not at the page origin.
    expect(svg).not.toMatch(/data-ad-kind="mark"[^]*?<rect x="0" y="-22"/);
  });
});
