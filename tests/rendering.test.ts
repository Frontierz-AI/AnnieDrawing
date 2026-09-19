import { describe, expect, it } from 'vitest';
import type { AnnieDoc, Item } from '../src/core/types';
import { Lens } from '../src/stage/lens';
import { createKindRegistry, defineKind, getKind, registerKind } from '../src/kinds/registry';
import { exportSVG } from '../src/porter/svg';
import { freehandPath, labelColor } from '../src/stage/paint';

const rectangle = (patch: Partial<Item> = {}): Item => ({
  id: 'i_box',
  kind: 'rect',
  x: 30,
  y: 40,
  w: 200,
  h: 100,
  ...patch,
});
const documentWith = (items: Item[]): AnnieDoc => ({
  format: 'anniedrawing',
  version: 2,
  meta: { title: 'A <joyful> drawing' },
  pages: [{ id: 's_main', name: 'Main', items }],
  media: {},
});

describe('camera', () => {
  it('round trips page coordinates and clamps zoom', () => {
    const lens = new Lens({ clientWidth: 1200, clientHeight: 800 } as HTMLElement);
    lens.set({ x: 230, y: -70, zoom: 2.4 });
    const point = { x: -500, y: 234.5 };
    const page = lens.toPage(lens.toScreen(point));
    expect(page.x).toBeCloseTo(point.x);
    expect(page.y).toBeCloseTo(point.y);
    lens.set({ zoom: 0 });
    expect(lens.zoom).toBe(0.05);
    lens.set({ zoom: 100 });
    expect(lens.zoom).toBe(8);
    lens.destroy();
  });
  it('fits content to the viewport and emits only valid changes', () => {
    const lens = new Lens({ clientWidth: 1000, clientHeight: 600 } as HTMLElement);
    let notifications = 0;
    const stop = lens.onChange(() => notifications++);
    lens.fit({ x: 100, y: 100, w: 800, h: 200 });
    expect(lens.center).toEqual({ x: 500, y: 200 });
    expect(lens.zoom).toBeLessThanOrEqual(1.01);
    const state = lens.state;
    lens.set({ x: Infinity });
    expect(lens.state).toEqual(state);
    expect(notifications).toBe(1);
    stop();
    lens.set({ x: 4 });
    expect(notifications).toBe(1);
    lens.destroy();
  });
});

describe('portable SVG export', () => {
  it('escapes labels, preserves geometry, and omits hidden content', () => {
    const items = [
      rectangle({ text: { value: '<script>alert("x")</script>' } }),
      rectangle({ id: 'i_hidden', hidden: true }),
    ];
    const svg = exportSVG(documentWith(items), items, { labels: true, padding: 10 });
    expect(svg).toContain('A &lt;joyful&gt; drawing');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('data-ad-id="i_box"');
    expect(svg).not.toContain('i_hidden');
    expect(svg).toContain('translate(30 40)');
    expect(svg).toContain('Comic Sans MS');
    expect(svg).not.toContain('foreignObject');
  });
  it('resolves attached connectors against the complete document', () => {
    const a = rectangle({ id: 'i_a', x: 0, y: 0, w: 100, h: 100 });
    const b = rectangle({ id: 'i_b', x: 300, y: 0, w: 100, h: 100 });
    const arrow = rectangle({
      id: 'i_arrow',
      kind: 'connector',
      from: { item: 'i_a', side: 'right' },
      to: { item: 'i_b', side: 'left' },
      route: 'straight',
      text: { value: 'flows' },
    });
    const svg = exportSVG(documentWith([a, b, arrow]), [arrow]);
    expect(svg).toContain('M 100 50 L 300 50');
    expect(svg).toContain('flows');
    expect(svg).not.toContain('data-ad-id="i_a"');
  });
  it('exports grouped children once and omits children of hidden groups', () => {
    const child = rectangle();
    const group = rectangle({ id: 'i_group', kind: 'group', children: [child] });
    const svg = exportSVG(documentWith([group]), [group, child]);
    expect(svg.match(/data-ad-id="i_box"/g)).toHaveLength(1);
    group.hidden = true;
    expect(exportSVG(documentWith([group]), [child])).not.toContain('i_box');
  });
  it('exports hatch fills, transparent background, and embedded cropped images', () => {
    const image = rectangle({
      id: 'i_image',
      kind: 'image',
      media: 'm_1',
      crop: { x: 10, y: 20, w: 50, h: 60 },
    });
    const box = rectangle({ style: { fill: 'teal', fillMode: 'hatch' } });
    const doc = documentWith([box, image]);
    doc.media.m_1 = { mime: 'image/png', src: 'data:image/png;base64,AAAA', w: 100, h: 100 };
    const svg = exportSVG(doc, [box, image], { background: false });
    expect(svg).toContain('<pattern');
    expect(svg).toContain('viewBox="10 20 50 60"');
    expect(svg).toContain('data:image/png;base64,AAAA');
    expect(svg).not.toContain('fill="#FFFFFF"');
  });
  it('supports caller-supplied SVG exporters', () => {
    const item = rectangle({ kind: 'badge' });
    const custom = defineKind({ kind: 'badge', toSVG: () => '<circle cx="10" cy="10" r="8"/>' });
    const svg = exportSVG(documentWith([item]), [item], { kinds: [custom] });
    expect(svg).toContain('<circle cx="10" cy="10" r="8"/>');
  });
});

describe('kind registry and pressure strokes', () => {
  it('keeps board-scoped registrations isolated', () => {
    const custom = defineKind({ kind: 'my_shape', defaults: { w: 42 } });
    expect(createKindRegistry([custom]).get('my_shape')).toBe(custom);
    expect(getKind('my_shape')).toBeUndefined();
    const unregister = registerKind(custom);
    expect(getKind('my_shape')).toBe(custom);
    unregister();
    expect(getKind('my_shape')).toBeUndefined();
    expect(() => defineKind({ kind: '<script>' })).toThrow();
  });
  it('renders a single-point stroke and a closed shape without non-finite geometry', () => {
    const single = freehandPath(rectangle({ kind: 'path', points: [[0, 0, 0.5]] }));
    expect(single).toMatch(/^M.+ Z$/);
    expect(single).not.toMatch(/NaN|Infinity/);
    const closed = freehandPath(
      rectangle({
        kind: 'path',
        closed: true,
        points: [
          [0, 0],
          [30, 0],
          [0, 30],
        ],
      }),
    );
    expect(closed).toBe('M0,0 L30,0 L0,30 Z');
  });
});

describe('label contrast', () => {
  it('uses dark ink on bright solid fills in dark mode in both live and SVG rendering', () => {
    for (const fill of ['moss', 'teal', '#fff', 'rgb(255, 255, 255)']) {
      const note = rectangle({
        kind: 'note',
        style: { fill },
        text: { value: 'Readable thought' },
      });
      expect(labelColor(note, 'dark')).toBe('#103639');
      expect(exportSVG(documentWith([note]), [note], { theme: 'dark' })).toContain(
        'fill="#103639"><tspan',
      );
    }
  });
  it('preserves standalone text colors and light text over dark or transparent fills', () => {
    expect(labelColor(rectangle({ kind: 'text', style: { stroke: 'violet' } }), 'dark')).toBe(
      '#8F93F9',
    );
    expect(labelColor(rectangle({ style: { fill: 'paper' } }), 'dark')).toBe('#E9F7F3');
    expect(labelColor(rectangle({ style: { fill: 'transparent' } }), 'dark')).toBe('#E9F7F3');
    expect(labelColor(rectangle({ style: { fill: 'teal', fillMode: 'tint' } }), 'dark')).toBe(
      '#E9F7F3',
    );
  });
});
