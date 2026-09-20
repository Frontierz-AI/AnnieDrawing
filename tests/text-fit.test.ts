import { describe, expect, it } from 'vitest';
import { createDoc } from '../src/core';
import { labeledBoxSize } from '../src/core/textFit';

const long =
  'Lectura:\nColumnas = etapas aproximadas.\nFilas = dimensiones (tiempo, tecnología, organización, cultura).\nEs un esquema simplificado, no una línea exacta.';

describe('agent labeled-box fit', () => {
  it('keeps short labels at the size the agent sent', () => {
    const doc = createDoc();
    expect(
      doc.apply(
        [
          {
            op: 'add',
            item: { id: 'i_api', kind: 'rect', x: 0, y: 0, w: 160, h: 100, text: { value: 'API' } },
          },
        ],
        { origin: 'agent:planner' },
      ).ok,
    ).toBe(true);
    expect(doc.get('i_api')).toMatchObject({ w: 160, h: 100 });
  });

  it('grows a default rectangle so a paragraph fits, and uses that size for place', () => {
    const doc = createDoc();
    const result = doc.apply(
      [
        { op: 'add', item: { id: 'i_card', kind: 'rect', x: 0, y: 0, text: { value: long } } },
        {
          op: 'add',
          item: { id: 'i_next', kind: 'rect', w: 160, h: 100, text: { value: 'Next' } },
          place: { rightOf: 'i_card', gap: 32 },
        },
      ],
      { origin: 'agent:planner' },
    );
    expect(result.ok).toBe(true);
    const card = doc.get('i_card')!;
    const needed = labeledBoxSize('rect', { value: long }, 180, 110);
    expect(card.w).toBe(Math.ceil(needed.w));
    expect(card.h).toBe(Math.ceil(needed.h));
    expect(card.w).toBeGreaterThan(180);
    expect(card.h).toBeGreaterThan(110);
    expect(doc.get('i_next')!.x).toBe(card.w + 32);
  });

  it('keeps a larger explicit size and leaves user or api creates alone', () => {
    const doc = createDoc();
    doc.apply(
      [{ op: 'add', item: { id: 'i_wide', kind: 'rect', w: 480, h: 260, text: { value: long } } }],
      { origin: 'agent:planner' },
    );
    expect(doc.get('i_wide')).toMatchObject({ w: 480, h: 260 });
    doc.apply([
      { op: 'add', item: { id: 'i_api', kind: 'rect', w: 180, h: 110, text: { value: long } } },
    ]);
    doc.apply(
      [{ op: 'add', item: { id: 'i_user', kind: 'rect', w: 180, h: 110, text: { value: long } } }],
      { origin: 'user' },
    );
    expect(doc.get('i_api')).toMatchObject({ w: 180, h: 110 });
    expect(doc.get('i_user')).toMatchObject({ w: 180, h: 110 });
  });

  it('grows on an agent text patch and restores size on undo', () => {
    const doc = createDoc();
    doc.apply(
      [
        {
          op: 'add',
          item: { id: 'i_box', kind: 'rect', x: 0, y: 0, w: 180, h: 110, text: { value: 'Hi' } },
        },
      ],
      { origin: 'agent:planner' },
    );
    expect(
      doc.apply([{ op: 'set', id: 'i_box', patch: { text: { value: long } } }], {
        origin: 'agent:planner',
      }).ok,
    ).toBe(true);
    const grown = doc.get('i_box')!;
    expect(grown.w).toBeGreaterThan(180);
    expect(grown.h).toBeGreaterThan(110);
    expect(doc.undo({ origin: 'agent:planner' })).toBe(true);
    expect(doc.get('i_box')).toMatchObject({ w: 180, h: 110, text: { value: 'Hi' } });
  });

  it('gives standalone text a 600 default and grows a graph title past the old 200 cap', () => {
    const doc = createDoc();
    const title = 'Evolución humana — vista por pisos y filas';
    expect(
      doc.apply([{ op: 'add', item: { id: 'i_short', kind: 'text', x: 0, y: 0 } }], {
        origin: 'agent:planner',
      }).ok,
    ).toBe(true);
    expect(doc.get('i_short')).toMatchObject({ w: 600, h: 48 });
    expect(
      doc.apply(
        [
          {
            op: 'add',
            item: {
              id: 'i_title',
              kind: 'text',
              x: 0,
              y: 80,
              w: 200,
              h: 48,
              text: { value: title },
            },
          },
        ],
        { origin: 'agent:planner' },
      ).ok,
    ).toBe(true);
    const item = doc.get('i_title')!;
    expect(item.w).toBeGreaterThan(200);
    expect(item.w).toBeGreaterThanOrEqual(
      Math.ceil(labeledBoxSize('text', { value: title }, 200, 48).w),
    );
    expect(item.h).toBeLessThanOrEqual(48);
  });

  it('grows labeled children created inside a group add', () => {
    const doc = createDoc();
    expect(
      doc.apply(
        [
          {
            op: 'add',
            item: {
              id: 'i_group',
              kind: 'group',
              x: 0,
              y: 0,
              w: 800,
              h: 600,
              children: [{ id: 'i_child', kind: 'rect', x: 20, y: 20, text: { value: long } }],
            },
          },
        ],
        { origin: 'agent:planner' },
      ).ok,
    ).toBe(true);
    const child = doc.get('i_child')!;
    expect(child.w).toBeGreaterThan(180);
    expect(child.h).toBeGreaterThan(110);
  });
});
