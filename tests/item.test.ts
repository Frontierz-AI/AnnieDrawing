import { describe, expect, it } from 'vitest';
import {
  allItems,
  applyDraft,
  copyItems,
  defaultDoc,
  detachMissingEndpoints,
  translateItem,
} from '../src/core';
import type { Item } from '../src/core/types';

const rect = (id: string, extra: Partial<Item> = {}): Item => ({
  id,
  kind: 'rect',
  x: 0,
  y: 0,
  w: 100,
  h: 80,
  ...extra,
});

describe('item drafts and translation', () => {
  it('merges nested style instead of replacing it', () => {
    const item = rect('a', { style: { fill: 'moss', stroke: 'ink' }, text: { value: 'Hi' } });
    expect(applyDraft(item, { style: { fill: 'sky' }, text: { align: 'center' } })).toMatchObject({
      style: { fill: 'sky', stroke: 'ink' },
      text: { value: 'Hi', align: 'center' },
    });
  });
  it('moves unbound connector endpoints with the item', () => {
    const connector = rect('c', {
      kind: 'connector',
      from: { x: 10, y: 20 },
      to: { item: 'other' },
      waypoints: [[4, 5]],
    });
    expect(translateItem(connector, 3, 7)).toMatchObject({
      x: 3,
      y: 7,
      from: { x: 13, y: 27 },
      waypoints: [[7, 12]],
    });
    expect(translateItem(connector, 3, 7).to).toBeUndefined();
  });
});

describe('copy and detach', () => {
  it('assigns new ids and remaps bound connector ends', () => {
    let n = 0;
    const copies = copyItems(
      [
        rect('a'),
        rect('c', {
          kind: 'connector',
          from: { item: 'a' },
          to: { x: 10, y: 10 },
        }),
      ],
      8,
      () => `n${++n}`,
    );
    expect(copies.map((item) => item.id)).toEqual(['n1', 'n2']);
    expect(copies[0]).toMatchObject({ x: 8, y: 8 });
    expect(copies[1].from).toEqual({ item: 'n1' });
    expect(copies[1].to).toEqual({ x: 18, y: 18 });
  });
  it('detaches bound ends whose targets are missing from the copied set', () => {
    const a = rect('a');
    const items = [
      rect('c', {
        kind: 'connector',
        from: { item: 'a', side: 'right' },
        to: { x: 200, y: 40 },
      }),
    ];
    detachMissingEndpoints(items, new Map([['a', a]]));
    expect(items[0].from).toEqual({ x: 100, y: 40 });
    expect(items[0].to).toEqual({ x: 200, y: 40 });
  });
  it('lists every nested item on every page', () => {
    const doc = defaultDoc();
    doc.pages[0].items = [rect('a', { kind: 'group', children: [rect('child', { x: 20 })] })];
    expect(allItems(doc).map((item) => item.id)).toEqual(['a', 'child']);
  });
});
