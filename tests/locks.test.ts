import { describe, expect, it } from 'vitest';
import { lockedItems } from '../src/core/locks';
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

describe('lock inheritance', () => {
  it('protects ancestors of a locked child and descendants of a locked group', () => {
    const tree = [
      rect('open'),
      rect('group', {
        kind: 'group',
        children: [rect('locked-child', { locked: true, x: 20 }), rect('sibling', { x: 140 })],
      }),
      rect('locked-group', {
        kind: 'group',
        locked: true,
        x: 300,
        children: [rect('nested', { x: 320 })],
      }),
    ];
    const locked = lockedItems(tree);
    expect(locked.has('open')).toBe(false);
    expect(locked.has('sibling')).toBe(false);
    expect(locked.has('locked-child')).toBe(true);
    expect(locked.has('group')).toBe(true);
    expect(locked.has('locked-group')).toBe(true);
    expect(locked.has('nested')).toBe(true);
  });
});
