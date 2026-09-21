import type {
  AnnieDoc,
  ApplyIssue,
  EndpointInput,
  Item,
  ItemText,
  NewItem,
  Op,
  Placement,
  Style,
} from './types';
import { clone } from './defaults';
import { itemId, uniqueItemId } from './ids';
import { flattenItems, type ItemLookup } from '../geo/box';
import { routeConnector, type OutlineResolver } from '../geo/router';

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

const PLACE_KEYS = ['rightOf', 'leftOf', 'above', 'below', 'inside', 'near'] as const;

/**
 * Agent creates keep colliding ids by storing `id_1`, `id_2`, … and rewriting
 * same-batch place, parent, and endpoint refs. Mutates a clone of `ops`.
 */
export function remapAgentCreateIds(
  doc: AnnieDoc,
  ops: Op[],
): { ops: Op[]; warnings: ApplyIssue[] } {
  const batch = clone(ops);
  const taken = new Set(allItems(doc).map((item) => item.id));
  const alias = new Map<string, string>();
  const warnings: ApplyIssue[] = [];
  const claim = (requested: string, index: number) => {
    const id = uniqueItemId(requested, taken);
    taken.add(id);
    if (!alias.has(requested)) alias.set(requested, id);
    if (id !== requested)
      warnings.push({
        index,
        code: 'ID_REMAPPED',
        message: `Item id ${requested} was already in use; stored as ${id}.`,
      });
    return id;
  };
  const assignTree = (item: NewItem | Item | undefined, index: number) => {
    if (!item || typeof item !== 'object') return;
    if (typeof item.id === 'string' && item.id) item.id = claim(item.id, index);
    item.children?.forEach((child) => assignTree(child, index));
  };
  for (let index = 0; index < batch.length; index++) {
    const op = batch[index];
    if (!op || typeof op !== 'object') continue;
    if (op.op === 'add') assignTree(op.item, index);
    else if (op.op === 'page.add') op.page.items?.forEach((item) => assignTree(item, index));
    else if (op.op === 'set' && Array.isArray(op.patch?.children))
      op.patch.children.forEach((child) => assignTree(child, index));
  }
  const rewriteId = (id: string | undefined | null) => (id && alias.has(id) ? alias.get(id)! : id);
  const rewriteEndpoint = (value: EndpointInput | undefined) => {
    if (typeof value === 'string') return rewriteId(value) ?? value;
    if (value && 'item' in value) return { ...value, item: rewriteId(value.item) ?? value.item };
    return value;
  };
  const rewriteTree = (item: NewItem | Item | undefined) => {
    if (!item || typeof item !== 'object') return;
    if ('from' in item && item.from !== undefined)
      (item as NewItem).from = rewriteEndpoint(item.from as EndpointInput);
    if ('to' in item && item.to !== undefined)
      (item as NewItem).to = rewriteEndpoint(item.to as EndpointInput);
    item.children?.forEach(rewriteTree);
  };
  for (const op of batch) {
    if (!op || typeof op !== 'object') continue;
    if (op.op === 'add') {
      rewriteTree(op.item);
      if (op.parent) op.parent = rewriteId(op.parent)!;
      if (op.place)
        for (const key of PLACE_KEYS) {
          const target = op.place[key];
          if (target) op.place[key] = rewriteId(target) as Placement[typeof key];
        }
    } else if (op.op === 'page.add') op.page.items?.forEach(rewriteTree);
    else if (op.op === 'set') {
      op.id = rewriteId(op.id)!;
      if (op.patch.from !== undefined) op.patch.from = rewriteEndpoint(op.patch.from);
      if (op.patch.to !== undefined) op.patch.to = rewriteEndpoint(op.patch.to);
      if (Array.isArray(op.patch.children)) op.patch.children.forEach(rewriteTree);
    } else if (op.op === 'remove' || op.op === 'order') op.id = rewriteId(op.id)!;
    else if (op.op === 'reparent') {
      op.id = rewriteId(op.id)!;
      if (op.parent) op.parent = rewriteId(op.parent)!;
    }
  }
  return { ops: batch, warnings };
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
  const detached: { item: Item; patch: Partial<Item> }[] = [];
  for (const item of list) {
    const missing = (['from', 'to'] as const).filter((key) => {
      const endpoint = item[key];
      return endpoint && 'item' in endpoint && !ids.has(endpoint.item);
    });
    if (!missing.length) continue;
    const points = routeConnector(item, lookup, outline).points;
    const restore: Partial<Item> = {},
      patch: Partial<Item> = {};
    for (const key of missing) {
      restore[key] = clone(item[key]);
      patch[key] = clone(key === 'from' ? points[0] : points.at(-1)!);
    }
    inverse.push({ op: 'set', id: item.id, patch: restore });
    detached.push({ item, patch });
  }
  // Resolve every old route first; an earlier detach would change shared lanes.
  for (const { item, patch } of detached) Object.assign(item, patch);
  return inverse;
}
