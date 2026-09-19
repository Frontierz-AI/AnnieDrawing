import { batch, signal, type Signal, type ReadonlySignal } from '@preact/signals-core';
import type {
  AnnieDoc,
  ApplyOptions,
  ApplyResult,
  ChangeEvent,
  DocModel,
  DocOptions,
  Item,
  Op,
  Page,
} from './types';
import { clone, defaultDoc, minimalItem, normalizeItem } from './defaults';
import { DocumentSchema, LIMITS, OpSchema, schemaError } from './schema';
import { migrate } from './migrate';
import { pageId } from './ids';
import { flattenItems, intersects, itemBounds } from '../geo/box';
import { resolveEndpoint } from '../geo/router';
import { placeItem } from '../agent/place';
import { queryDoc } from '../agent/query';
import { describeDoc } from '../agent/describe';
import { normalizeHref, parseVideo } from './links';
interface Location {
  item: Item;
  list: Item[];
  index: number;
  parent?: Item;
  page: Page;
}
interface Entry {
  ops: Op[];
  inverse: Op[];
  before: AnnieDoc;
  after: AnnieDoc;
  origin: string;
  label?: string;
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function locate(doc: AnnieDoc, id: string): Location | undefined {
  for (const page of doc.pages) {
    const walk = (list: Item[], parent?: Item): Location | undefined => {
      for (let index = 0; index < list.length; index++) {
        const item = list[index];
        if (item.id === id) return { item, list, index, parent, page };
        if (item.children) {
          const found = walk(item.children, item);
          if (found) return found;
        }
      }
    };
    const result = walk(page.items);
    if (result) return result;
  }
}
function requireItem(doc: AnnieDoc, id: string): Location {
  const result = locate(doc, id);
  if (!result) {
    const candidates = flattenItems(doc.pages.flatMap((s) => s.items))
      .map((i) => i.id)
      .slice(0, 5);
    throw new Error(
      `Item ${id} does not exist.${candidates.length ? ` Closest ids: ${candidates.join(', ')}.` : ''}`,
    );
  }
  return result;
}
function mergePatch<T extends object>(target: T, patch: Partial<T>, nested: string[] = []): T {
  const next = { ...target } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete next[key];
      continue;
    }
    if (nested.includes(key) && value && typeof value === 'object' && !Array.isArray(value)) {
      const old = next[key];
      next[key] = mergePatch(old && typeof old === 'object' ? (old as object) : {}, value);
    } else next[key] = clone(value);
  }
  return next as T;
}
function inversePatch(
  target: object,
  patch: object,
  nested: string[] = [],
): Record<string, unknown> {
  const before = target as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    const value = (patch as Record<string, unknown>)[key];
    result[key] =
      nested.includes(key) &&
      value &&
      typeof value === 'object' &&
      before[key] &&
      typeof before[key] === 'object'
        ? inversePatch(before[key] as object, value as object)
        : clone(before[key]);
  }
  return result;
}
function assertSafeJSON(value: unknown, depth = 0, seen = new Set<unknown>()): void {
  if (depth > LIMITS.maxDepth * 3 + 8)
    throw new Error(`Document data exceeds maximum nesting depth ${LIMITS.maxDepth}.`);
  if (
    value === undefined ||
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  )
    return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('All numbers must be finite.');
    return;
  }
  if (typeof value !== 'object') throw new Error('Document values must be plain JSON data.');
  if (seen.has(value)) throw new Error('Circular document data is not supported.');
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null)
    throw new Error('Document values must be plain JSON objects.');
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key))
      throw new Error(`Unsafe property ${key}.`);
    assertSafeJSON(child, depth + 1, seen);
  }
  seen.delete(value);
}
function validateDoc(
  doc: AnnieDoc,
  options: DocOptions = {},
  origin = 'user',
  restrictedMedia?: Set<string>,
): void {
  assertSafeJSON(doc);
  const error = schemaError(DocumentSchema, doc);
  if (error) throw new Error(error);
  const ids = new Set<string>(),
    pageIds = new Set<string>();
  let count = 0;
  for (const page of doc.pages) {
    if (pageIds.has(page.id)) throw new Error(`Duplicate page id ${page.id}.`);
    pageIds.add(page.id);
    const walk = (list: Item[], depth: number) => {
      if (depth > LIMITS.maxDepth) throw new Error('Item nesting is too deep.');
      for (const item of list) {
        count++;
        if (typeof item.id !== 'string' || !item.id)
          throw new Error('Every item must have a stable string id.');
        for (const field of ['x', 'y', 'w', 'h'] as const)
          if (typeof item[field] !== 'number' || !Number.isFinite(item[field]))
            throw new Error(`Item ${item.id} requires finite ${field}.`);
        if (ids.has(item.id)) throw new Error(`Duplicate item id ${item.id}.`);
        ids.add(item.id);
        if (item.children && item.kind !== 'group')
          throw new Error(`Only groups may contain children (${item.id}).`);
        if (item.kind === 'connector' && (!item.from || !item.to))
          throw new Error(`Connector ${item.id} needs both from and to endpoints.`);
        if (item.kind === 'image' && (!item.media || !doc.media[item.media]))
          throw new Error(`Image ${item.id} references missing media ${item.media ?? '(unset)'}.`);
        if (item.kind === 'video' || item.kind === 'link' || item.href !== undefined) {
          if (!normalizeHref(item.href)) throw new Error(`Bad href (${item.id}).`);
          if (item.kind === 'video' && !parseVideo(item.href))
            throw new Error(`Bad video (${item.id}).`);
        }
        const customSchema = options.kinds?.find((kind) => kind.kind === item.kind)?.schema;
        if (customSchema) {
          const customError = schemaError(customSchema as Parameters<typeof schemaError>[0], item);
          if (customError) throw new Error(`${item.kind} ${item.id}: ${customError}`);
        }
        if (item.children) walk(item.children, depth + 1);
      }
    };
    walk(page.items, 0);
  }
  if (count > LIMITS.maxItems)
    throw new Error(`A document may contain at most ${LIMITS.maxItems} items.`);
  for (const page of doc.pages) {
    const local = flattenItems(page.items),
      localIds = new Map(local.map((i) => [i.id, i]));
    for (const item of local)
      for (const endpoint of [item.from, item.to])
        if (endpoint && 'item' in endpoint) {
          const target = localIds.get(endpoint.item);
          if (!target)
            throw new Error(`Endpoint ${endpoint.item} does not exist on page ${page.id}.`);
          if (target.kind === 'connector' || target.id === item.id)
            throw new Error(
              `Connector endpoints must attach to a non-connector item (${endpoint.item}).`,
            );
        }
  }
  for (const [mediaId, media] of Object.entries(doc.media)) {
    const data = /^data:image\/(png|jpeg|gif|webp|avif|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(
      media.src,
    );
    let url: URL | undefined;
    try {
      url = new URL(media.src);
    } catch {
      /* Validation below reports a useful error. */
    }
    if (!data && (!url || !['http:', 'https:'].includes(url.protocol)))
      throw new Error('Images must use an image data URL or an HTTP(S) URL.');
    if (
      origin !== 'user' &&
      (!restrictedMedia || restrictedMedia.has(mediaId)) &&
      !data &&
      url &&
      !options.allowedImageOrigins?.includes(url.origin)
    )
      throw new Error(
        `Image origin ${url.origin} is not allowed. Pass allowedImageOrigins when creating the board.`,
      );
  }
}
function cleanHref(item: Item): void {
  if (item.href === undefined) return;
  const href = normalizeHref(item.href);
  if (!href) throw new Error(`Bad href (${item.id}).`);
  item.href = href;
  item.children?.forEach(cleanHref);
}
function sanitizeAgentItems(item: Item, sanitizeHTML?: DocOptions['sanitizeHTML']): void {
  if (item.html !== undefined)
    item.html = sanitizeHTML
      ? sanitizeHTML(item.html)
      : item.html
          .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/gi, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
  if (item.mount) delete item.mount;
  item.children?.forEach((child) => sanitizeAgentItems(child, sanitizeHTML));
}
function perform(
  doc: AnnieDoc,
  raw: Op,
  origin: string,
  options: DocOptions = {},
): {
  op: Op;
  inverse: Op[];
  created: string[];
} {
  const op = clone(raw),
    kindDefaults = Object.fromEntries(
      (options.kinds ?? [])
        .filter((kind) => kind.defaults)
        .map((kind) => [kind.kind, kind.defaults!]),
    );
  const outline = (item: Item) =>
    options.kinds?.find((kind) => kind.kind === item.kind)?.outline?.(item);
  let inverse: Op[] = [],
    created: string[] = [];
  if (op.op === 'add') {
    let item = normalizeItem(op.item, kindDefaults);
    if (origin !== 'user') sanitizeAgentItems(item, options.sanitizeHTML);
    cleanHref(item);
    const parentId = op.parent ?? op.place?.inside,
      parent = parentId ? requireItem(doc, parentId) : undefined;
    if (parent && parent.item.kind !== 'group')
      throw new Error(`Parent ${parentId} must be a group.`);
    const page = parent?.page ?? doc.pages.find((s) => (op.page ? s.id === op.page : true));
    if (!page) throw new Error(`Page ${op.page ?? '(first)'} does not exist.`);
    if (parent && op.page && op.page !== parent.page.id)
      throw new Error('Parent and page must refer to the same page.');
    if (op.place) item = placeItem(item, op.place, flattenItems(page.items));
    const list = parent ? (parent.item.children ??= []) : page.items;
    if (op.index !== undefined && op.index > list.length)
      throw new Error('Insert index is outside the target list.');
    list.splice(op.index ?? list.length, 0, item);
    inverse = [{ op: 'remove', id: item.id }];
    created = flattenItems([item]).map((i) => i.id);
    return {
      op: {
        op: 'add',
        item: clone(item),
        page: page.id,
        ...(parent ? { parent: parent.item.id } : {}),
        ...(op.index !== undefined ? { index: op.index } : {}),
      },
      inverse,
      created,
    };
  }
  if (op.op === 'set') {
    const at = requireItem(doc, op.id);
    const oldLookup = Object.hasOwn(op.patch, 'children')
      ? new Map(
          flattenItems(doc.pages.flatMap((page) => page.items)).map((item) => [item.id, item]),
        )
      : undefined;
    const oldDescendants = new Set(flattenItems(at.item.children ?? []).map((item) => item.id));
    if (Object.hasOwn(op.patch, 'id') && op.patch.id !== op.id)
      throw new Error('Item ids cannot be changed.');
    inverse = [
      { op: 'set', id: op.id, patch: inversePatch(at.item, op.patch, ['style', 'text', 'data']) },
    ];
    const patch = clone(op.patch);
    for (const field of ['kind', 'x', 'y', 'w', 'h'] as const)
      if (Object.hasOwn(patch, field) && patch[field] === undefined)
        throw new Error(`Required field ${field} cannot be deleted.`);
    if (patch.children)
      patch.children = patch.children.map((child) => normalizeItem(child, kindDefaults));
    if (typeof patch.href === 'string') {
      const href = normalizeHref(patch.href);
      if (!href) throw new Error(`Bad href (${op.id}).`);
      patch.href = href;
    }
    if (origin !== 'user') {
      if (typeof patch.html === 'string')
        patch.html = options.sanitizeHTML
          ? options.sanitizeHTML(patch.html)
          : patch.html
              .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/gi, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
      if (Object.hasOwn(patch, 'mount')) delete patch.mount;
      if (patch.children)
        patch.children.forEach((child) => sanitizeAgentItems(child, options.sanitizeHTML));
    }
    at.list[at.index] = mergePatch(at.item, patch, ['style', 'text', 'data']);
    if (oldLookup) {
      const newDescendants = new Set(
        flattenItems(at.list[at.index].children ?? []).map((item) => item.id),
      );
      const removedIds = new Set([...oldDescendants].filter((id) => !newDescendants.has(id)));
      created = [...newDescendants].filter((id) => !oldLookup.has(id));
      for (const item of flattenItems(doc.pages.flatMap((page) => page.items))) {
        const restore: Partial<Item> = {};
        for (const key of ['from', 'to'] as const) {
          const endpoint = item[key];
          if (endpoint && 'item' in endpoint && removedIds.has(endpoint.item)) {
            restore[key] = clone(endpoint);
            item[key] = resolveEndpoint(
              endpoint,
              key === 'from' ? item.to : item.from,
              oldLookup,
              outline,
            );
          }
        }
        if (Object.keys(restore).length) inverse.push({ op: 'set', id: item.id, patch: restore });
      }
    }
    return { op: { ...op, patch }, inverse, created };
  }
  if (op.op === 'remove') {
    const at = requireItem(doc, op.id),
      removedIds = new Set(flattenItems([at.item]).map((i) => i.id)),
      lookup = new Map(flattenItems(doc.pages.flatMap((s) => s.items)).map((i) => [i.id, i]));
    inverse = [
      {
        op: 'add',
        item: clone(at.item),
        page: at.page.id,
        ...(at.parent ? { parent: at.parent.id } : {}),
        index: at.index,
      },
    ];
    for (const item of lookup.values()) {
      if (removedIds.has(item.id)) continue;
      const patch: Partial<Item> = {},
        restore: Partial<Item> = {};
      for (const key of ['from', 'to'] as const) {
        const endpoint = item[key];
        if (endpoint && 'item' in endpoint && removedIds.has(endpoint.item)) {
          restore[key] = clone(endpoint);
          patch[key] = resolveEndpoint(
            endpoint,
            key === 'from' ? item.to : item.from,
            lookup,
            outline,
          );
        }
      }
      if (Object.keys(patch).length) {
        Object.assign(item, patch);
        inverse.push({ op: 'set', id: item.id, patch: restore });
      }
    }
    at.list.splice(at.index, 1);
  }
  if (op.op === 'order') {
    const at = requireItem(doc, op.id),
      to =
        typeof op.to === 'number'
          ? op.to
          : op.to === 'front'
            ? at.list.length - 1
            : op.to === 'back'
              ? 0
              : op.to === 'forward'
                ? Math.min(at.list.length - 1, at.index + 1)
                : Math.max(0, at.index - 1);
    if (to >= at.list.length) throw new Error('Order index is outside the item list.');
    at.list.splice(at.index, 1);
    at.list.splice(to, 0, at.item);
    inverse = [{ op: 'order', id: op.id, to: at.index }];
  }
  if (op.op === 'reparent') {
    const at = requireItem(doc, op.id),
      parent = op.parent ? requireItem(doc, op.parent) : undefined;
    if (parent && parent.item.kind !== 'group') throw new Error('New parent must be a group.');
    if (parent && flattenItems([at.item]).some((i) => i.id === parent.item.id))
      throw new Error('An item cannot be placed inside itself or a descendant.');
    if (parent && parent.page.id !== at.page.id)
      throw new Error('Reparenting across pages is not supported.');
    inverse = [{ op: 'reparent', id: op.id, parent: at.parent?.id ?? null, index: at.index }];
    at.list.splice(at.index, 1);
    const list = parent ? (parent.item.children ??= []) : at.page.items;
    if (op.index !== undefined && op.index > list.length)
      throw new Error('Reparent index is outside the target list.');
    list.splice(op.index ?? list.length, 0, at.item);
  }
  if (op.op === 'page.add') {
    const page: Page = {
      ...op.page,
      id: op.page.id ?? pageId(),
      items: (op.page.items ?? []).map((item) => normalizeItem(item, kindDefaults)),
    };
    if (origin !== 'user')
      page.items.forEach((item) => sanitizeAgentItems(item, options.sanitizeHTML));
    if (op.index !== undefined && op.index > doc.pages.length)
      throw new Error('Page insert index is outside the page list.');
    doc.pages.splice(op.index ?? doc.pages.length, 0, page);
    inverse = [{ op: 'page.remove', id: page.id }];
    created = flattenItems(page.items).map((i) => i.id);
    return {
      op: {
        op: 'page.add',
        page: clone(page),
        ...(op.index !== undefined ? { index: op.index } : {}),
      },
      inverse,
      created,
    };
  }
  if (op.op === 'page.set') {
    if (Object.keys(op.patch).some((key) => key !== 'name' && key !== 'background'))
      throw new Error(
        'page.set may only update name and background. Use item operations to change page content.',
      );
    const page = doc.pages.find((s) => s.id === op.id);
    if (!page) throw new Error(`Page ${op.id} does not exist.`);
    inverse = [{ op: 'page.set', id: op.id, patch: inversePatch(page, op.patch) }];
    Object.assign(page, mergePatch(page, op.patch));
    for (const key of Object.keys(op.patch))
      if ((op.patch as Record<string, unknown>)[key] === undefined)
        delete (page as unknown as Record<string, unknown>)[key];
  }
  if (op.op === 'page.remove') {
    const index = doc.pages.findIndex((s) => s.id === op.id);
    if (index < 0) throw new Error(`Page ${op.id} does not exist.`);
    const [page] = doc.pages.splice(index, 1);
    inverse = [{ op: 'page.add', page: clone(page), index }];
  }
  if (op.op === 'meta.set') {
    inverse = [{ op: 'meta.set', patch: inversePatch(doc.meta, op.patch) }];
    doc.meta = mergePatch(doc.meta, op.patch);
  }
  if (op.op === 'media.set') {
    inverse = doc.media[op.id]
      ? [{ op: 'media.set', id: op.id, media: clone(doc.media[op.id]) }]
      : [{ op: 'media.remove', id: op.id }];
    doc.media[op.id] = clone(op.media);
  }
  if (op.op === 'media.remove') {
    if (!doc.media[op.id]) throw new Error(`Media ${op.id} does not exist.`);
    inverse = [{ op: 'media.set', id: op.id, media: clone(doc.media[op.id]) }];
    delete doc.media[op.id];
  }
  return { op, inverse, created };
}
function revertedPatch(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  current: Record<string, unknown>,
  nested: string[] = [],
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (equal(before[key], after[key])) continue;
    if (
      nested.includes(key) &&
      current[key] &&
      typeof current[key] === 'object' &&
      (before[key] === undefined || typeof before[key] === 'object') &&
      (after[key] === undefined || typeof after[key] === 'object')
    ) {
      const sub = revertedPatch(
        (before[key] ?? {}) as Record<string, unknown>,
        (after[key] ?? {}) as Record<string, unknown>,
        current[key] as Record<string, unknown>,
      );
      if (Object.keys(sub).length) patch[key] = sub;
    } else if (equal(current[key], after[key])) patch[key] = clone(before[key]);
  }
  return patch;
}
function selectiveInverse(entry: Entry, current: AnnieDoc): Op[] {
  return entry.inverse.flatMap<Op>((op) => {
    if (op.op === 'set') {
      const before = locate(entry.before, op.id)?.item,
        after = locate(entry.after, op.id)?.item,
        now = locate(current, op.id)?.item;
      if (!before || !after || !now) return [];
      const patch = revertedPatch(before, after, now, ['style', 'text', 'data']);
      return Object.keys(patch).length ? [{ ...op, patch }] : [];
    }
    if (op.op === 'meta.set') {
      const patch = revertedPatch(entry.before.meta, entry.after.meta, current.meta);
      return Object.keys(patch).length ? [{ ...op, patch }] : [];
    }
    if (op.op === 'remove') return locate(current, op.id) ? [op] : [];
    if (op.op === 'add') return locate(current, String(op.item.id)) ? [] : [op];
    if (op.op === 'order' || op.op === 'reparent') {
      const now = locate(current, op.id),
        after = locate(entry.after, op.id);
      if (!now || !after || now.parent?.id !== after.parent?.id || now.page.id !== after.page.id)
        return [];
      return [op];
    }
    if (op.op === 'media.set' || op.op === 'media.remove')
      return equal(current.media[op.id], entry.after.media[op.id]) ? [op] : [];
    if (op.op === 'page.set') {
      if (Object.keys(op.patch).some((key) => key !== 'name' && key !== 'background'))
        throw new Error(
          'page.set may only update name and background. Use item operations to change page content.',
        );
      const before = entry.before.pages.find((s) => s.id === op.id),
        after = entry.after.pages.find((s) => s.id === op.id),
        now = current.pages.find((s) => s.id === op.id);
      if (!before || !after || !now) return [];
      const patch = revertedPatch(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>,
        now as unknown as Record<string, unknown>,
      );
      delete patch.items;
      return Object.keys(patch).length ? [{ ...op, patch }] : [];
    }
    return [op];
  });
}
export function createDoc(initial?: AnnieDoc, options: DocOptions = {}): DocModel {
  const loadInitial = (doc: AnnieDoc) => {
    const defaults = Object.fromEntries(
      (options.kinds ?? [])
        .filter((kind) => kind.defaults)
        .map((kind) => [kind.kind, kind.defaults!]),
    );
    return migrate(doc, defaults);
  };
  let state = initial ? loadInitial(initial) : defaultDoc();
  validateDoc(state, options);
  let index = new Map(
    flattenItems(state.pages.flatMap((page) => page.items)).map((item) => [item.id, item]),
  );
  const observedItems = new Map<string, Signal<Item | undefined>>(),
    observedFields = new Map<string, Map<keyof Item, Signal<unknown>>>(),
    observedChildren = new Map<string, Signal<readonly string[]>>();
  const frozenCopy = <T>(value: T): T => {
    const result = clone(value);
    const freeze = (node: unknown) => {
      if (node && typeof node === 'object') {
        Object.values(node).forEach(freeze);
        Object.freeze(node);
      }
    };
    freeze(result);
    return result;
  };
  const childIds = (id: string) =>
    (index.get(id)?.children ?? state.pages.find((page) => page.id === id)?.items ?? []).map(
      (item) => item.id,
    );
  const reindex = () => {
    index = new Map(
      flattenItems(state.pages.flatMap((page) => page.items)).map((item) => [item.id, item]),
    );
    batch(() => {
      for (const [id, observed] of observedItems) {
        const next = index.get(id);
        if (!equal(observed.peek(), next)) observed.value = frozenCopy(next);
      }
      for (const [id, fields] of observedFields)
        for (const [key, observed] of fields) {
          const next = index.get(id)?.[key];
          if (!equal(observed.peek(), next)) observed.value = frozenCopy(next);
        }
      for (const [id, observed] of observedChildren) {
        const next = childIds(id);
        if (!equal(observed.peek(), next)) observed.value = Object.freeze(next);
      }
    });
  };
  const listeners = new Set<(event: ChangeEvent) => void>(),
    history: Entry[] = [],
    future: Entry[] = [];
  const emit = (entry: Pick<Entry, 'ops' | 'inverse' | 'origin' | 'label'>) => {
    for (const callback of listeners) {
      try {
        callback(
          clone({
            ops: entry.ops,
            inverse: entry.inverse,
            origin: entry.origin,
            label: entry.label,
          }),
        );
      } catch {
        /* A subscriber cannot roll back a committed transaction. */
      }
    }
  };
  const model: DocModel = {
    itemSignal(id) {
      let observed = observedItems.get(id);
      if (!observed) {
        observed = signal(frozenCopy(index.get(id)));
        observedItems.set(id, observed);
      }
      return observed;
    },
    fieldSignal(id, key) {
      let fields = observedFields.get(id);
      if (!fields) {
        fields = new Map();
        observedFields.set(id, fields);
      }
      let observed = fields.get(key);
      if (!observed) {
        observed = signal<unknown>(frozenCopy(index.get(id)?.[key]));
        fields.set(key, observed);
      }
      return observed as ReadonlySignal<Item[typeof key] | undefined>;
    },
    childrenSignal(id) {
      let observed = observedChildren.get(id);
      if (!observed) {
        observed = signal<readonly string[]>(Object.freeze(childIds(id)));
        observedChildren.set(id, observed);
      }
      return observed;
    },
    apply(ops, applyOptions = {}) {
      const result: ApplyResult = { ok: false, created: [], errors: [], warnings: [] },
        origin = applyOptions.origin ?? 'api';
      if (options.readonly) {
        result.errors.push({ index: 0, code: 'READONLY', message: 'This document is read-only.' });
        return result;
      }
      const batchLimit = origin === 'user' ? LIMITS.maxItems : LIMITS.maxBatch;
      if (!Array.isArray(ops) || ops.length > batchLimit) {
        result.errors.push({
          index: 0,
          code: 'BATCH_LIMIT',
          message: `A batch must be an array of at most ${batchLimit} operations for origin ${origin}.`,
        });
        return result;
      }
      let draft: AnnieDoc;
      try {
        assertSafeJSON(ops);
        draft = clone(state);
      } catch (error) {
        result.errors.push({
          index: 0,
          code: 'INVALID_DATA',
          message: String(error instanceof Error ? error.message : error),
        });
        return result;
      }
      const concrete: Op[] = [],
        inverse: Op[] = [];
      const creationOps = new Map<string, number>();
      for (let index = 0; index < ops.length; index++) {
        try {
          const error = schemaError(OpSchema, ops[index]);
          if (error) throw new Error(error);
          const change = perform(draft, ops[index], origin, options);
          concrete.push(change.op);
          inverse.unshift(...change.inverse);
          result.created.push(...change.created);
          change.created.forEach((id) => creationOps.set(id, index));
          if (origin !== 'user' && result.created.length > LIMITS.maxBatch)
            throw new Error(
              `An agent batch may create at most ${LIMITS.maxBatch} items, including nested children.`,
            );
        } catch (error) {
          result.errors.push({
            index,
            code: 'INVALID_OP',
            message: `${ops[index]?.op ?? 'operation'} #${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
      if (!result.errors.length) {
        try {
          validateDoc(
            draft,
            options,
            origin,
            new Set(concrete.filter((op) => op.op === 'media.set').map((op) => op.id)),
          );
        } catch (error) {
          result.errors.push({
            index: Math.max(0, ops.length - 1),
            code: 'INVALID_DOCUMENT',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (result.errors.length) {
        result.created = [];
        return result;
      }
      const all = flattenItems(draft.pages.flatMap((s) => s.items)),
        lookup = new Map(all.map((i) => [i.id, i]));
      for (const id of result.created) {
        const item = lookup.get(id);
        if (!item) continue;
        if (
          item.kind !== 'connector' &&
          all.some(
            (other) =>
              other.id !== id &&
              !other.children?.length &&
              other.kind !== 'connector' &&
              intersects(itemBounds(item, lookup), itemBounds(other, lookup)),
          )
        )
          result.warnings.push({
            index: creationOps.get(id) ?? 0,
            code: 'OVERLAPS_EXISTING',
            message: `Item ${id} overlaps another item.`,
          });
      }
      result.ok = true;
      if (applyOptions.dryRun || !ops.length) return result;
      const entry: Entry = {
        ops: concrete,
        inverse,
        before: state,
        after: draft,
        origin,
        label: applyOptions.label,
      };
      state = draft;
      reindex();
      const previous = history.at(-1);
      if (
        applyOptions.merge &&
        previous &&
        previous.origin === origin &&
        previous.label === entry.label
      ) {
        previous.ops.push(...entry.ops);
        previous.inverse.unshift(...entry.inverse);
        previous.after = state;
      } else {
        history.push(entry);
        if (history.length > 100) history.shift();
      }
      future.length = 0;
      emit(entry);
      return result;
    },
    get(id) {
      return clone(index.get(id));
    },
    query(selector) {
      return queryDoc(state, selector);
    },
    describe(describeOptions) {
      return describeDoc(state, describeOptions);
    },
    toJSON(saveOptions) {
      const json = clone(state);
      if (saveOptions?.compact === false) return json;
      for (const page of json.pages)
        page.items = page.items.map((item) =>
          minimalItem(
            item,
            Object.fromEntries(
              (options.kinds ?? [])
                .filter((kind) => kind.defaults)
                .map((kind) => [kind.kind, kind.defaults!]),
            ),
          ),
        );
      return json;
    },
    undo(undoOptions) {
      if (options.readonly) return false;
      let index = history.length - 1;
      if (undoOptions?.origin)
        while (index >= 0 && history[index].origin !== undoOptions.origin) index--;
      if (index < 0) return false;
      const entry = history[index],
        selective = index !== history.length - 1,
        ops = selective ? selectiveInverse(entry, state) : entry.inverse,
        draft = clone(state),
        actual: Op[] = [],
        redo: Op[] = [];
      try {
        for (const op of ops) {
          const result = perform(draft, op, 'user', options);
          actual.push(result.op);
          redo.unshift(...result.inverse);
        }
        validateDoc(draft, options);
      } catch {
        return false;
      }
      const reverse: Entry = {
        ops: actual,
        inverse: redo,
        before: state,
        after: draft,
        origin: entry.origin,
        label: entry.label,
      };
      state = draft;
      reindex();
      history.splice(index, 1);
      future.push(reverse);
      emit({
        ops: actual,
        inverse: redo,
        origin: entry.origin,
        label: `Undo ${entry.label ?? 'change'}`,
      });
      return true;
    },
    redo() {
      if (options.readonly) return false;
      const reverse = future.at(-1);
      if (!reverse) return false;
      const draft = clone(state),
        ops: Op[] = [],
        inverse: Op[] = [];
      try {
        for (const op of reverse.inverse) {
          const change = perform(draft, op, 'user', options);
          ops.push(change.op);
          inverse.unshift(...change.inverse);
        }
        validateDoc(draft, options);
      } catch {
        return false;
      }
      const entry: Entry = {
        ops,
        inverse,
        before: state,
        after: draft,
        origin: reverse.origin,
        label: reverse.label,
      };
      state = draft;
      reindex();
      future.pop();
      history.push(entry);
      emit({ ops, inverse, origin: entry.origin, label: `Redo ${entry.label ?? 'change'}` });
      return true;
    },
    load(doc) {
      if (options.readonly) throw new Error('This document is read-only.');
      const next = loadInitial(doc);
      validateDoc(next, options);
      state = next;
      reindex();
      history.length = 0;
      future.length = 0;
      emit({ ops: [], inverse: [], origin: 'api', label: 'Load document' });
    },
    on(_type, callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    get canUndo() {
      return history.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
  };
  return model;
}
