import type { Box, Item, Placement } from '../core/types';
import { contains, intersects, itemBounds, lookupItem, type ItemLookup } from '../geo/box';

function blocksPlace(item: Item): boolean {
  return !item.hidden && item.kind !== 'connector' && item.kind !== 'line' && item.kind !== 'path';
}

/** Slide further along the placement axis when the first slot is occupied. */
function nextFree(
  box: Box,
  axis: 'x' | 'y',
  dir: 1 | -1,
  gap: number,
  items: Item[],
  lookup: ItemLookup,
): Box {
  const next = { ...box };
  for (let step = 0; step < 64; step++) {
    const hit = items.find(
      (other) => blocksPlace(other) && intersects(next, itemBounds(other, lookup)),
    );
    if (!hit) return next;
    const b = itemBounds(hit, lookup);
    if (axis === 'x') next.x = dir > 0 ? b.x + b.w + gap : b.x - next.w - gap;
    else next.y = dir > 0 ? b.y + b.h + gap : b.y - next.h - gap;
  }
  return next;
}

/** Exactly one of rightOf, leftOf, above, below, inside, or near. */
export function placeItem(
  item: Item,
  place: Placement,
  items: Item[],
  lookup: ItemLookup = items,
): Item {
  const keys = (['rightOf', 'leftOf', 'above', 'below', 'inside', 'near'] as const).filter(
    (key) => place[key],
  );
  if (keys.length !== 1)
    throw new Error(
      'Placement requires exactly one of rightOf, leftOf, above, below, inside, or near.',
    );
  const key = keys[0],
    ref = lookupItem(lookup, place[key]!);
  if (!ref) throw new Error(`Placement reference ${place[key]} does not exist.`);
  const b = key === 'inside' ? { x: ref.x, y: ref.y, w: ref.w, h: ref.h } : itemBounds(ref, lookup),
    gap = place.gap ?? 32,
    align = place.align ?? 'middle',
    offset = (available: number, size: number) =>
      align === 'start' ? 0 : align === 'end' ? available - size : (available - size) / 2;
  let x = b.x,
    y = b.y;
  if (key === 'rightOf') {
    x = b.x + b.w + gap;
    y = b.y + offset(b.h, item.h);
  }
  if (key === 'leftOf') {
    x = b.x - item.w - gap;
    y = b.y + offset(b.h, item.h);
  }
  if (key === 'above') {
    x = b.x + offset(b.w, item.w);
    y = b.y - item.h - gap;
  }
  if (key === 'below') {
    x = b.x + offset(b.w, item.w);
    y = b.y + b.h + gap;
  }
  if (key === 'inside') {
    if (ref.kind !== 'group') throw new Error('Inside placement requires a group.');
    const children = ref.children ?? [];
    let found = false;
    for (let row = 0; row < 100 && !found; row++)
      for (let col = 0; col < 100 && !found; col++) {
        const candidate = {
          x: b.x + gap + col * (item.w + gap),
          y: b.y + gap + row * (item.h + gap),
          w: item.w,
          h: item.h,
        };
        if (
          contains(b, candidate) &&
          !children.some((other) => intersects(candidate, itemBounds(other, lookup)))
        ) {
          x = candidate.x;
          y = candidate.y;
          found = true;
        }
      }
    if (!found)
      throw new Error(`No free slot inside ${ref.id}; enlarge the group or use a smaller item.`);
  }
  if (key === 'rightOf' || key === 'leftOf' || key === 'above' || key === 'below') {
    const free = nextFree(
      { x, y, w: item.w, h: item.h },
      key === 'above' || key === 'below' ? 'y' : 'x',
      key === 'leftOf' || key === 'above' ? -1 : 1,
      gap,
      items,
      lookup,
    );
    x = free.x;
    y = free.y;
  }
  if (key === 'near') {
    let found = false;
    for (let ring = 1; ring <= 100 && !found; ring++) {
      const candidates = [
        { x: b.x + b.w + gap * ring, y: b.y },
        { x: b.x, y: b.y + b.h + gap * ring },
        { x: b.x - item.w - gap * ring, y: b.y },
        { x: b.x, y: b.y - item.h - gap * ring },
      ];
      for (const candidate of candidates)
        if (
          !items.some((other) =>
            intersects({ ...candidate, w: item.w, h: item.h }, itemBounds(other, lookup)),
          )
        ) {
          x = candidate.x;
          y = candidate.y;
          found = true;
          break;
        }
    }
    if (!found) throw new Error('No free space found near the requested item.');
  }
  return { ...item, x, y };
}
