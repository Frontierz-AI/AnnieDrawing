import type { AnnieDoc, Item, ItemText, Op, Style } from './types';
import { clone } from './defaults';
import { itemId } from './ids';
import { flattenItems, type ItemLookup } from '../geo/box';
import { resolveEndpoint, type OutlineResolver } from '../geo/router';

export function pageRoots(doc: AnnieDoc): Item[] {
  return doc.pages.flatMap((page) => page.items);
}
export function allItems(doc: AnnieDoc): Item[] {
  return flattenItems(pageRoots(doc));
}

export type ItemPatch = Omit<Partial<Item>, 'style' | 'text' | 'data'> & {
  style?: Partial<Style>;
  text?: Partial<ItemText>;
  data?: Record<string, unknown>;
};

/** Nested style, text, and data patches merge; other fields replace. */
export function applyDraft(item: Item, patch?: ItemPatch): Item {
  if (!patch) return item;
  return {
    ...item,
    ...patch,
    style: patch.style ? { ...item.style, ...patch.style } : item.style,
    text: patch.text ? ({ ...item.text, ...patch.text } as ItemText) : item.text,
    data: patch.data ? { ...item.data, ...patch.data } : item.data,
  };
}

export function translateItem(item: Item, dx: number, dy: number): Partial<Item> {
  const patch: Partial<Item> = { x: (item.x ?? 0) + dx, y: (item.y ?? 0) + dy };
  if (item.kind === 'connector') {
    for (const key of ['from', 'to'] as const) {
      const endpoint = item[key];
      if (endpoint && !('item' in endpoint))
        patch[key] = { x: endpoint.x + dx, y: endpoint.y + dy };
    }
    if (item.waypoints) patch.waypoints = item.waypoints.map(([x, y]) => [x + dx, y + dy]);
  }
  return patch;
}

export function copyItems(items: Item[], offset: number, nextId = itemId): Item[] {
  const ids = new Map(flattenItems(items).map((item) => [item.id, nextId()]));
  const copy = (item: Item): Item => {
    const next = {
      ...clone(item),
      id: ids.get(item.id)!,
      x: (item.x ?? 0) + offset,
      y: (item.y ?? 0) + offset,
    };
    if (item.children) next.children = item.children.map(copy);
    if (item.waypoints) next.waypoints = item.waypoints.map(([x, y]) => [x + offset, y + offset]);
    for (const key of ['from', 'to'] as const) {
      const endpoint = item[key];
      if (!endpoint) continue;
      next[key] =
        'item' in endpoint
          ? { ...endpoint, item: ids.get(endpoint.item) ?? endpoint.item }
          : { x: endpoint.x + offset, y: endpoint.y + offset };
    }
    return next;
  };
  return items.map(copy);
}

/** Bound ends whose targets are missing become page points. Mutates `items`. */
export function detachMissingEndpoints(
  items: Iterable<Item>,
  lookup: ItemLookup,
  outline?: OutlineResolver,
): Op[] {
  const list = flattenItems([...items]);
  const ids = new Set(list.map((item) => item.id));
  const inverse: Op[] = [];
  for (const item of list) {
    const restore: Partial<Item> = {};
    for (const key of ['from', 'to'] as const) {
      const endpoint = item[key];
      if (endpoint && 'item' in endpoint && !ids.has(endpoint.item)) {
        restore[key] = clone(endpoint);
        item[key] = resolveEndpoint(
          endpoint,
          item[key === 'from' ? 'to' : 'from'],
          lookup,
          outline,
        );
      }
    }
    if (Object.keys(restore).length) inverse.push({ op: 'set', id: item.id, patch: restore });
  }
  return inverse;
}
