import { batch, signal, type Signal, type ReadonlySignal } from '@preact/signals-core';
import type {
  AnnieDoc,
  ApplyIssue,
  ApplyResult,
  Box,
  ChangeEvent,
  ChangeSlice,
  DocModel,
  DocOptions,
  Item,
  Media,
  NewItem,
  Op,
  Page,
  Placement,
  Style,
} from './types';
import { kindsSince } from './catalog';
import {
  aliasStyle,
  clone,
  defaultDoc,
  kindDefaultsFrom,
  minimalItem,
  normalizeItem,
  storedEndpoint,
} from './defaults';
import type { ItemStamp } from '../agent/describe';
import { allItems, detachMissingEndpoints, remapAgentCreateIds } from './item';
import { DocumentSchema, LIMITS, OpSchema, schemaError } from './schema';
import { migrate } from './migrate';
import { pageId } from './ids';
import { flattenItems, itemBounds, overlaps } from '../geo/box';
import {
  flowPlacement,
  freeSpaceOrigin,
  isFlowNode,
  placeAgentItem,
  placeItem,
  type BatchEdge,
  type BatchLinks,
  type PlaceShift,
} from '../agent/place';
import { queryDoc } from '../agent/query';
import { describeDoc } from '../agent/describe';
import { MEDIA_DATA_URL, normalizeHref, parseVideo } from './links';
import { growAgentLabeledTree, LABEL_BOX_KINDS } from './textFit';
interface Location {
  item: Item;
  list: Item[];
  index: number;
  parent?: Item;
  page: Page;
}
/**
 * The parts of one document that an entry's inverse ops name. Selective undo compares these with
 * the current document; keeping whole documents here held a full copy, media included, per entry.
 * Values are references into committed states, which are never edited after commit.
 */
interface Trace {
  items: Map<string, { item: Item; parent?: string; page: string }>;
  pages: Map<string, Omit<Page, 'items'>>;
  media: Map<string, Media | undefined>;
  meta?: AnnieDoc['meta'];
}
interface Entry {
  ops: Op[];
  inverse: Op[];
  before: Trace;
  after: Trace;
  origin: string;
  label?: string;
}
/** Media values are replaced, never edited in place, so document copies share them. */
function cloneDoc(doc: AnnieDoc): AnnieDoc {
  const { media, ...rest } = doc;
  return { ...clone(rest), media: { ...media } };
}
function trace(doc: AnnieDoc, inverse: Op[]): Trace {
  const result: Trace = { items: new Map(), pages: new Map(), media: new Map() };
  const items = new Set<string>();
  for (const op of inverse) {
    if (op.op === 'set' || op.op === 'order' || op.op === 'reparent') items.add(op.id);
    else if (op.op === 'meta.set') result.meta = doc.meta;
    else if (op.op === 'media.set' || op.op === 'media.remove')
      result.media.set(op.id, doc.media[op.id]);
    else if (op.op === 'page.set') {
      const page = doc.pages.find((page) => page.id === op.id);
      if (page) {
        const { items: _items, ...rest } = page;
        result.pages.set(op.id, rest);
      }
    }
  }
  if (!items.size) return result;
  const walk = (list: Item[], page: string, parent?: string) => {
    for (const item of list) {
      if (items.has(item.id)) result.items.set(item.id, { item, parent, page });
      if (item.children) walk(item.children, page, item.id);
    }
  };
  for (const page of doc.pages) walk(page.items, page.id);
  return result;
}
/** The state before a merged entry: the earlier trace wins wherever both named a value. */
function traceBefore(earlier: Trace, later: Trace): Trace {
  return {
    items: new Map([...later.items, ...earlier.items]),
    pages: new Map([...later.pages, ...earlier.pages]),
    media: new Map([...later.media, ...earlier.media]),
    meta: earlier.meta ?? later.meta,
  };
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function escapeHtml(html: string, sanitize?: DocOptions['sanitizeHTML']): string {
  return sanitize
    ? sanitize(html)
    : html
        .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/gi, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
const SANITIZER_PROBE = '<img src="x" onerror="alert(1)"><script>alert(1)</script>';
function assertEffectiveSanitizer(sanitize: (html: string) => string): void {
  let out: string;
  try {
    out = sanitize(SANITIZER_PROBE);
  } catch (error) {
    throw new Error(
      `sanitizeHTML failed on a safety probe (${error instanceof Error ? error.message : error}).`,
    );
  }
  if (typeof out !== 'string') throw new Error('sanitizeHTML must return a string.');
  const lower = out.toLowerCase();
  if (lower.includes('onerror') || /<script\b/.test(lower))
    throw new Error(
      'sanitizeHTML must strip active HTML. Do not pass an identity function or a no-op.',
    );
}
function assertPagePatch(patch: object): void {
  if (Object.keys(patch).some((key) => key !== 'name' && key !== 'background'))
    throw new Error(
      'page.set may only update name and background. Use item operations to change page content.',
    );
}
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
    const candidates = allItems(doc)
      .map((i) => i.id)
      .slice(0, 5);
    throw new Error(
      `Item ${id} does not exist.${candidates.length ? ` Known ids: ${candidates.join(', ')}.` : ''}`,
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
  if (depth > LIMITS.maxJsonDepth)
    throw new Error(`Document data exceeds maximum nesting depth ${LIMITS.maxJsonDepth}.`);
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
/** Data-URL media already scanned; their checks do not depend on origin. */
const checkedDataMedia = new WeakSet<Media>();
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
    if (checkedDataMedia.has(media)) continue;
    const data = MEDIA_DATA_URL.test(media.src);
    // Stored media is shared between states and never edited, so one scan of a data URL is enough.
    if (data) {
      checkedDataMedia.add(media);
      continue;
    }
    let url: URL | undefined;
    try {
      url = new URL(media.src);
    } catch {
      /* Validation below reports a useful error. */
    }
    if (!url || !['http:', 'https:'].includes(url.protocol))
      throw new Error('Images must use an image data URL or an HTTP(S) URL.');
    if (url && (url.username || url.password))
      throw new Error('Image URLs must not include credentials.');
    if (
      origin !== 'user' &&
      (!restrictedMedia || restrictedMedia.has(mediaId)) &&
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
  if (item.html !== undefined) item.html = escapeHtml(item.html, sanitizeHTML);
  if (item.mount) delete item.mount;
  item.children?.forEach((child) => sanitizeAgentItems(child, sanitizeHTML));
}
const AGENT_NODE_KINDS = new Set(['rect', 'ellipse', 'diamond', 'note']);
const AGENT_FILLS = ['teal', 'sky', 'violet', 'amber', 'rose', 'coral', 'moss'];

const PLACE_RELATIONS = ['rightOf', 'leftOf', 'above', 'below', 'inside', 'near'] as const;

/** One relation on `item.place` becomes `op.place` and is not stored. Valid `gap` and `align` stay. */
function takeItemPlace(item: Item): Placement | undefined {
  const raw = item.place;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const source = raw as Record<string, unknown>;
  const relations = PLACE_RELATIONS.filter((key) => {
    const value = source[key];
    return typeof value === 'string' && value.length > 0;
  });
  if (relations.length !== 1) return;
  delete item.place;
  const key = relations[0];
  const place: Placement = { [key]: source[key] as string };
  const gap = source.gap;
  if (typeof gap === 'number' && Number.isFinite(gap) && gap >= 0 && gap <= LIMITS.maxCoordinate)
    place.gap = gap;
  if (source.align === 'start' || source.align === 'middle' || source.align === 'end')
    place.align = source.align;
  return place;
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function sameLabelSlot(a: Box, b: Box): boolean {
  const smaller = Math.min(a.w * a.h, b.w * b.h);
  const larger = Math.max(a.w * a.h, b.w * b.h);
  // 2/5 is 40%. Multiply so the boundary stays exact for integer sizes.
  if (!(smaller > 0) || smaller * 5 < larger * 2) return false;
  return overlapArea(a, b) * 2 >= smaller;
}

function labeledBox(item: Item): Box | undefined {
  const value = item.text?.value;
  if (!LABEL_BOX_KINDS.has(item.kind) || typeof value !== 'string' || !value.trim()) return;
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

/** Last labeled node on the page that shares this grown box. */
function labelStackAnchor(item: Item, existing: Item[]): string | undefined {
  const box = labeledBox(item);
  if (!box) return;
  let anchor: string | undefined;
  for (const other of existing) {
    if (other.id === item.id) continue;
    const otherBox = labeledBox(other);
    if (otherBox && sameLabelSlot(box, otherBox)) anchor = other.id;
  }
  return anchor;
}

/** Persist omitted agent fills and elbow routes so export, undo, and later edits keep them. */
function agentDefaults(item: Item, nextColor: () => string): void {
  if (AGENT_NODE_KINDS.has(item.kind)) {
    // Advance for every node so later omitted fills stay stable around explicit colors.
    const fill = nextColor();
    if (item.style?.fill === undefined) item.style = { fill, fillMode: 'tint', ...item.style };
  }
  if (item.kind === 'connector' && item.route === undefined) item.route = 'elbow';
  item.children?.forEach((child) => agentDefaults(child, nextColor));
}
/** Same-batch connector directions, in arrow order, so placement can tell an inserted step from a sibling. */
function batchLinks(ops: Op[]): { links: BatchLinks; edges: BatchEdge[] } {
  const links = new Map<string, Set<string>>();
  const edges: BatchEdge[] = [];
  const visit = (item: NewItem | Item | undefined) => {
    if (!item || typeof item !== 'object') return;
    // Arrows usually arrive without ids; the edge only needs its endpoints.
    if ((item.kind === 'connector' || item.kind === 'arrow') && item.from && item.to) {
      const from =
          typeof item.from === 'string'
            ? item.from
            : 'item' in item.from
              ? item.from.item
              : undefined,
        to = typeof item.to === 'string' ? item.to : 'item' in item.to ? item.to.item : undefined;
      if (from && to) {
        if (!links.has(from)) links.set(from, new Set());
        links.get(from)!.add(to);
        edges.push([from, to]);
      }
    }
    item.children?.forEach(visit);
  };
  for (const op of ops) if (op && typeof op === 'object' && op.op === 'add') visit(op.item);
  return { links, edges };
}

/** Move an existing item (and its children) to make room; connectors move stored points only. */
function shiftItem(item: Item, shift: PlaceShift, moved: Op[], inverse: Op[]): void {
  const { dx, dy } = shift;
  if (item.kind === 'connector') {
    const before: Partial<Item> = {},
      patch: Partial<Item> = {};
    if (item.waypoints?.length) {
      before.waypoints = clone(item.waypoints);
      item.waypoints = item.waypoints.map(([x, y]) => [x + dx, y + dy]);
      patch.waypoints = clone(item.waypoints);
    }
    for (const end of ['from', 'to'] as const) {
      const point = item[end];
      if (point && !('item' in point)) {
        before[end] = { ...point };
        item[end] = { x: point.x + dx, y: point.y + dy };
        patch[end] = { ...item[end] };
      }
    }
    if (!Object.keys(patch).length) return;
    moved.push({ op: 'set', id: item.id, patch });
    inverse.push({ op: 'set', id: item.id, patch: before });
    return;
  }
  const before = { x: item.x, y: item.y };
  item.x += dx;
  item.y += dy;
  moved.push({ op: 'set', id: item.id, patch: { x: item.x, y: item.y } });
  inverse.push({ op: 'set', id: item.id, patch: before });
  item.children?.forEach((child) => shiftItem(child, shift, moved, inverse));
}

function perform(
  doc: AnnieDoc,
  raw: Op,
  origin: string,
  options: DocOptions = {},
  links?: BatchLinks,
  edges?: readonly BatchEdge[],
): {
  op: Op;
  /** Follow-up `set` operations for items moved to make room. */
  moved: Op[];
  inverse: Op[];
  created: string[];
} {
  const op = clone(raw),
    kindDefaults = kindDefaultsFrom(options.kinds);
  // `text: 'Label'` patches the value and keeps the rest of the label style.
  if (op.op === 'set' && typeof op.patch?.text === 'string')
    op.patch.text = { value: op.patch.text };
  const outline = (item: Item) =>
    options.kinds?.find((kind) => kind.kind === item.kind)?.outline?.(item);
  let inverse: Op[] = [],
    created: string[] = [];
  const moved: Op[] = [];
  if (op.op === 'add') {
    let item = normalizeItem(op.item, kindDefaults);
    if (origin !== 'user') sanitizeAgentItems(item, options.sanitizeHTML);
    cleanHref(item);
    if (origin.startsWith('agent:')) {
      // Grow before the parent is chosen so nested `inside` selects the group and later steps see the real size.
      growAgentLabeledTree(item);
      if (!op.place) {
        const lifted = takeItemPlace(item);
        if (lifted) op.place = lifted;
      }
    }
    const parentId = op.parent ?? op.place?.inside,
      parent = parentId ? requireItem(doc, parentId) : undefined;
    if (parent && parent.item.kind !== 'group')
      throw new Error(`Parent ${parentId} must be a group.`);
    const page = parent?.page ?? doc.pages.find((page) => (op.page ? page.id === op.page : true));
    if (!page) throw new Error(`Page ${op.page ?? '(first)'} does not exist.`);
    if (parent && op.page && op.page !== parent.page.id)
      throw new Error('Parent and page must refer to the same page.');
    if (origin.startsWith('agent:')) {
      const pageItems = flattenItems(page.items);
      // normalizeItem stores omitted coordinates as 0; only a node sent without both is placed for the agent.
      const unpositioned =
        !parent && op.item.x === undefined && op.item.y === undefined && isFlowNode(item);
      if (!op.place && unpositioned) op.place = flowPlacement(item.id, edges, pageItems);
      if (!op.place) {
        const anchor = labelStackAnchor(item, pageItems);
        if (anchor) op.place = { rightOf: anchor };
      }
      if (!op.place && unpositioned) {
        const free = freeSpaceOrigin(item, pageItems, options.agentPlaceGap ?? 32);
        if (free) item = { ...item, ...free };
      }
      let colorIndex = flattenItems(page.items).filter((entry) =>
        AGENT_NODE_KINDS.has(entry.kind),
      ).length;
      agentDefaults(item, () => AGENT_FILLS[colorIndex++ % AGENT_FILLS.length]);
    }
    if (op.place) {
      const gap =
        op.place.gap ?? (origin.startsWith('agent:') ? (options.agentPlaceGap ?? 32) : 32);
      const pageItems = flattenItems(page.items);
      if (origin.startsWith('agent:')) {
        const placed = placeAgentItem(item, { ...op.place, gap }, pageItems, pageItems, links);
        item = placed.item;
        const byId = new Map(pageItems.map((entry) => [entry.id, entry]));
        for (const shift of placed.shifts) shiftItem(byId.get(shift.id)!, shift, moved, inverse);
      } else item = placeItem(item, { ...op.place, gap }, pageItems);
    }
    const list = parent ? (parent.item.children ??= []) : page.items;
    if (op.index !== undefined && op.index > list.length)
      throw new Error('Insert index is outside the target list.');
    list.splice(op.index ?? list.length, 0, item);
    inverse = [{ op: 'remove', id: item.id }, ...inverse];
    created = flattenItems([item]).map((i) => i.id);
    return {
      op: {
        op: 'add',
        item: clone(item),
        page: page.id,
        ...(parent ? { parent: parent.item.id } : {}),
        ...(op.index !== undefined ? { index: op.index } : {}),
      },
      moved,
      inverse,
      created,
    };
  }
  if (op.op === 'set') {
    const at = requireItem(doc, op.id);
    const oldLookup = Object.hasOwn(op.patch, 'children')
      ? new Map(flattenItems(at.page.items).map((item) => [item.id, item]))
      : undefined;
    if (Object.hasOwn(op.patch, 'id') && op.patch.id !== op.id)
      throw new Error('Item ids cannot be changed.');
    inverse = [
      { op: 'set', id: op.id, patch: inversePatch(at.item, op.patch, ['style', 'text', 'data']) },
    ];
    const incoming = clone(op.patch);
    const { from, to, style, children, ...rest } = incoming;
    const patch: Partial<Item> = { ...(rest as Partial<Item>) };
    if (Object.hasOwn(incoming, 'style')) patch.style = aliasStyle(style as Style | undefined);
    if (Object.hasOwn(incoming, 'from')) patch.from = storedEndpoint(from);
    if (Object.hasOwn(incoming, 'to')) patch.to = storedEndpoint(to);
    if (Object.hasOwn(incoming, 'children'))
      patch.children = children
        ? (children as NewItem[]).map((child) => normalizeItem(child, kindDefaults))
        : undefined;
    for (const field of ['kind', 'x', 'y', 'w', 'h'] as const)
      if (Object.hasOwn(patch, field) && patch[field] === undefined)
        throw new Error(`Required field ${field} cannot be deleted.`);
    if (typeof patch.href === 'string') {
      const href = normalizeHref(patch.href);
      if (!href) throw new Error(`Bad href (${op.id}).`);
      patch.href = href;
    }
    if (origin !== 'user') {
      if (typeof patch.html === 'string') patch.html = escapeHtml(patch.html, options.sanitizeHTML);
      if (Object.hasOwn(patch, 'mount')) delete patch.mount;
      if (patch.children)
        patch.children.forEach((child) => sanitizeAgentItems(child, options.sanitizeHTML));
    }
    const previous = at.item;
    at.list[at.index] = mergePatch(previous, patch, ['style', 'text', 'data']);
    if (
      origin.startsWith('agent:') &&
      (Object.hasOwn(incoming, 'text') || Object.hasOwn(incoming, 'children'))
    ) {
      growAgentLabeledTree(at.list[at.index]);
      const next = at.list[at.index];
      const undo = inverse[0];
      if (next.w !== previous.w) {
        patch.w = next.w;
        if (undo.op === 'set') undo.patch = { ...undo.patch, w: previous.w };
      }
      if (next.h !== previous.h) {
        patch.h = next.h;
        if (undo.op === 'set') undo.patch = { ...undo.patch, h: previous.h };
      }
      if (Object.hasOwn(incoming, 'children')) patch.children = next.children;
    }
    if (oldLookup) {
      const newDescendants = new Set(
        flattenItems(at.list[at.index].children ?? []).map((item) => item.id),
      );
      created = [...newDescendants].filter((id) => !oldLookup.has(id));
      inverse.push(...detachMissingEndpoints(at.page.items, oldLookup, outline));
    }
    return { op: { ...op, patch }, moved, inverse, created };
  }
  if (op.op === 'remove') {
    const at = requireItem(doc, op.id),
      lookup = new Map(flattenItems(at.page.items).map((i) => [i.id, i]));
    inverse = [
      {
        op: 'add',
        item: clone(at.item),
        page: at.page.id,
        ...(at.parent ? { parent: at.parent.id } : {}),
        index: at.index,
      },
    ];
    at.list.splice(at.index, 1);
    inverse.push(...detachMissingEndpoints(at.page.items, lookup, outline));
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
      moved,
      inverse,
      created,
    };
  }
  if (op.op === 'page.set') {
    assertPagePatch(op.patch);
    const page = doc.pages.find((page) => page.id === op.id);
    if (!page) throw new Error(`Page ${op.id} does not exist.`);
    inverse = [{ op: 'page.set', id: op.id, patch: inversePatch(page, op.patch) }];
    Object.assign(page, mergePatch(page, op.patch));
    for (const key of Object.keys(op.patch))
      if ((op.patch as Record<string, unknown>)[key] === undefined)
        delete (page as unknown as Record<string, unknown>)[key];
  }
  if (op.op === 'page.remove') {
    const index = doc.pages.findIndex((page) => page.id === op.id);
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
      ? [{ op: 'media.set', id: op.id, media: doc.media[op.id] }]
      : [{ op: 'media.remove', id: op.id }];
    doc.media[op.id] = clone(op.media);
  }
  if (op.op === 'media.remove') {
    if (!doc.media[op.id]) throw new Error(`Media ${op.id} does not exist.`);
    inverse = [{ op: 'media.set', id: op.id, media: doc.media[op.id] }];
    delete doc.media[op.id];
  }
  return { op, moved, inverse, created };
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
      const before = entry.before.items.get(op.id)?.item,
        after = entry.after.items.get(op.id)?.item,
        now = locate(current, op.id)?.item;
      if (!before || !after || !now) return [];
      const patch = revertedPatch(before, after, now, ['style', 'text', 'data']);
      return Object.keys(patch).length ? [{ ...op, patch }] : [];
    }
    if (op.op === 'meta.set') {
      if (!entry.before.meta || !entry.after.meta) return [];
      const patch = revertedPatch(entry.before.meta, entry.after.meta, current.meta);
      return Object.keys(patch).length ? [{ ...op, patch }] : [];
    }
    if (op.op === 'remove') return locate(current, op.id) ? [op] : [];
    if (op.op === 'add') return locate(current, String(op.item.id)) ? [] : [op];
    if (op.op === 'order' || op.op === 'reparent') {
      const now = locate(current, op.id),
        after = entry.after.items.get(op.id);
      if (!now || !after || now.parent?.id !== after.parent || now.page.id !== after.page)
        return [];
      return [op];
    }
    if (op.op === 'media.set' || op.op === 'media.remove') {
      const now = current.media[op.id],
        after = entry.after.media.get(op.id);
      return now === after || equal(now, after) ? [op] : [];
    }
    if (op.op === 'page.set') {
      assertPagePatch(op.patch);
      const before = entry.before.pages.get(op.id),
        after = entry.after.pages.get(op.id),
        now = current.pages.find((page) => page.id === op.id);
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
/**
 * Fit an older entry's op to the draft it replays onto. Later edits may have shortened a list or
 * removed a parent group; clamp the index, fall back to the page root, or skip what no longer exists.
 */
function fitToDoc(op: Op, doc: AnnieDoc): Op | undefined {
  if (op.op === 'add') {
    const page = doc.pages.find((page) => page.id === (op.page ?? doc.pages[0]?.id));
    if (!page) return undefined;
    const parent = op.parent ? locate(doc, op.parent) : undefined;
    const next = { ...op };
    if (op.parent && (!parent || parent.page.id !== page.id)) delete next.parent;
    const list = next.parent ? (parent!.item.children ?? []) : page.items;
    if (next.index !== undefined) next.index = Math.min(next.index, list.length);
    return next;
  }
  if (op.op === 'set' || op.op === 'remove') return locate(doc, op.id) ? op : undefined;
  if (op.op === 'order') {
    const at = locate(doc, op.id);
    if (!at) return undefined;
    return typeof op.to === 'number' ? { ...op, to: Math.min(op.to, at.list.length - 1) } : op;
  }
  if (op.op === 'reparent') {
    const at = locate(doc, op.id),
      parent = op.parent ? locate(doc, op.parent) : undefined;
    if (!at || (op.parent && !parent)) return undefined;
    if (op.index === undefined) return op;
    const list = parent ? (parent.item.children ?? []) : at.page.items;
    return { ...op, index: Math.min(op.index, list.length - (list === at.list ? 1 : 0)) };
  }
  return op;
}
export function createDoc(initial?: AnnieDoc, options: DocOptions = {}): DocModel {
  if (options.sanitizeHTML) assertEffectiveSanitizer(options.sanitizeHTML);
  const loadInitial = (doc: AnnieDoc) => {
    return migrate(doc, kindDefaultsFrom(options.kinds));
  };
  let state = initial ? loadInitial(initial) : defaultDoc();
  validateDoc(state, options);
  let index = new Map(allItems(state).map((item) => [item.id, item]));
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
    index = new Map(allItems(state).map((item) => [item.id, item]));
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
  let revision = 0;
  const sessionLog: ChangeSlice[] = [];
  const written = new Map<string, ItemStamp>(),
    removed = new Map<string, ItemStamp>();
  const hideAgent = () => options.agentHistory === 'hidden';
  const agentOrigin = (origin: string) => origin.startsWith('agent:');
  const walkBack = (stack: { origin: string }[], keep: (origin: string) => boolean) => {
    let index = stack.length - 1;
    while (index >= 0 && !keep(stack[index].origin)) index--;
    return index;
  };
  const pageOf = (doc: AnnieDoc) => {
    const map = new Map<string, string>();
    for (const page of doc.pages)
      for (const item of flattenItems(page.items)) map.set(item.id, page.id);
    return map;
  };
  const stampTransition = (before: AnnieDoc, after: AnnieDoc, rev: number, origin: string) => {
    const beforeItems = new Map(allItems(before).map((item) => [item.id, item])),
      afterItems = new Map(allItems(after).map((item) => [item.id, item])),
      beforePages = pageOf(before),
      afterPages = pageOf(after);
    for (const [id, item] of afterItems) {
      const prev = beforeItems.get(id);
      if (!prev || !equal(prev, item)) {
        written.set(id, { revision: rev, origin, kind: item.kind, page: afterPages.get(id)! });
        removed.delete(id);
      }
    }
    for (const [id, item] of beforeItems) {
      if (!afterItems.has(id)) {
        written.delete(id);
        removed.set(id, { revision: rev, origin, kind: item.kind, page: beforePages.get(id)! });
      }
    }
  };
  const resetSession = () => {
    revision = 0;
    sessionLog.length = 0;
    written.clear();
    removed.clear();
  };
  const commitSession = (
    slice: Omit<ChangeSlice, 'revision'>,
    before: AnnieDoc,
    after: AnnieDoc,
  ) => {
    revision += 1;
    stampTransition(before, after, revision, slice.origin);
    sessionLog.push({ ...slice, revision, ops: clone(slice.ops) });
    if (sessionLog.length > LIMITS.maxSessionLog) sessionLog.shift();
    return revision;
  };
  const emit = (
    entry: Pick<Entry, 'ops' | 'inverse' | 'origin' | 'label'> & { revision: number },
  ) => {
    for (const callback of listeners) {
      try {
        callback(
          clone({
            ops: entry.ops,
            inverse: entry.inverse,
            origin: entry.origin,
            label: entry.label,
            revision: entry.revision,
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
        origin = applyOptions.origin ?? 'api',
        lenient = !!applyOptions.lenient;
      if (options.readonly) {
        result.errors.push({ index: 0, code: 'READONLY', message: 'This document is read-only.' });
        return result;
      }
      if (
        applyOptions.expectedRevision !== undefined &&
        (!Number.isSafeInteger(applyOptions.expectedRevision) ||
          applyOptions.expectedRevision !== revision)
      ) {
        result.errors.push({
          index: 0,
          code: 'STALE_REVISION',
          message: `Read the board again before editing. Expected revision ${applyOptions.expectedRevision}; current revision is ${revision}.`,
        });
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
        draft = cloneDoc(state);
      } catch (error) {
        result.errors.push({
          index: 0,
          code: 'INVALID_DATA',
          message: String(error instanceof Error ? error.message : error),
        });
        return result;
      }
      const remapped = origin.startsWith('agent:')
        ? remapAgentCreateIds(draft, ops)
        : { ops, warnings: [] as ApplyIssue[] };
      result.warnings.push(...remapped.warnings);
      const concrete: Op[] = [],
        inverse: Op[] = [],
        failures: ApplyIssue[] = [];
      const creationOps = new Map<string, number>();
      const mediaIds = () =>
        new Set(concrete.filter((op) => op.op === 'media.set').map((op) => op.id));
      const batch = remapped.ops;
      const graph = origin.startsWith('agent:') ? batchLinks(batch) : undefined;
      /** Items moved to make room, with the op that moved them. */
      const moved = new Map<string, number>();
      for (let index = 0; index < batch.length; index++) {
        const snapshot = lenient ? cloneDoc(draft) : undefined;
        try {
          const error = schemaError(OpSchema, batch[index]);
          if (error) throw new Error(error);
          const change = perform(draft, batch[index], origin, options, graph?.links, graph?.edges);
          if (origin !== 'user' && result.created.length + change.created.length > LIMITS.maxBatch)
            throw new Error(
              `An agent batch may create at most ${LIMITS.maxBatch} items, including nested children.`,
            );
          if (lenient)
            validateDoc(
              draft,
              options,
              origin,
              new Set([...mediaIds(), ...(change.op.op === 'media.set' ? [change.op.id] : [])]),
            );
          concrete.push(change.op, ...change.moved);
          inverse.unshift(...change.inverse);
          result.created.push(...change.created);
          change.created.forEach((id) => creationOps.set(id, index));
          for (const op of change.moved)
            if (op.op === 'set' && !moved.has(op.id)) moved.set(op.id, index);
        } catch (error) {
          if (snapshot) draft = snapshot;
          failures.push({
            index,
            code: 'INVALID_OP',
            message: `${batch[index]?.op ?? 'operation'} #${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
      if (!lenient && !failures.length) {
        try {
          validateDoc(draft, options, origin, mediaIds());
        } catch (error) {
          failures.push({
            index: Math.max(0, ops.length - 1),
            code: 'INVALID_DOCUMENT',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (!lenient && failures.length) {
        result.errors = failures;
        result.created = [];
        result.warnings = [];
        return result;
      }
      if (lenient && !concrete.length) {
        result.skipped = failures;
        result.created = [];
        return result;
      }
      if (lenient && failures.length) result.skipped = failures;
      // Created items and items moved to make room, compared with shapes on their own page.
      const lookup = new Map<string, Item>(),
        pageOfItem = new Map<string, Item[]>();
      for (const page of draft.pages) {
        const list = flattenItems(page.items);
        for (const item of list) {
          lookup.set(item.id, item);
          pageOfItem.set(item.id, list);
        }
      }
      const placed: [string, number, boolean][] = [
        ...result.created.map((id): [string, number, boolean] => [
          id,
          creationOps.get(id) ?? 0,
          false,
        ]),
        ...[...moved].map(([id, index]): [string, number, boolean] => [id, index, true]),
      ];
      for (const [id, index, shifted] of placed) {
        const item = lookup.get(id);
        if (!item || item.kind === 'connector' || item.children?.length) continue;
        const box = itemBounds(item, lookup);
        const other = pageOfItem
          .get(id)!
          .find(
            (other) =>
              other.id !== id &&
              !other.children?.length &&
              other.kind !== 'connector' &&
              overlaps(box, itemBounds(other, lookup)),
          );
        if (other)
          result.warnings.push({
            index,
            code: 'OVERLAPS_EXISTING',
            message: shifted
              ? `Item ${id}, moved to make room, overlaps ${other.id}.`
              : `Item ${id} overlaps another item.`,
          });
      }
      result.ok = true;
      if (moved.size) result.moved = [...moved.keys()];
      if (applyOptions.dryRun || !concrete.length) return result;
      const entry: Entry = {
        ops: concrete,
        inverse,
        before: trace(state, inverse),
        after: trace(draft, inverse),
        origin,
        label: applyOptions.label,
      };
      const committed = state;
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
        previous.before = traceBefore(previous.before, entry.before);
        previous.after = trace(state, previous.inverse);
      } else {
        history.push(entry);
        if (history.length > LIMITS.maxHistory) history.shift();
      }
      future.length = 0;
      emit({
        ...entry,
        revision: commitSession(
          { origin, label: applyOptions.label, ops: concrete },
          committed,
          state,
        ),
      });
      return result;
    },
    get(id) {
      return clone(index.get(id));
    },
    query(selector) {
      return queryDoc(state, selector);
    },
    describe(describeOptions) {
      return describeDoc(state, describeOptions, { written, removed });
    },
    changesSince(since, changeOptions) {
      const cursor = revision;
      if (!Number.isFinite(since) || since >= cursor) return { cursor, since, changes: [] };
      const oldest = sessionLog[0];
      if (oldest && since + 1 < oldest.revision)
        return { cursor, since, changes: [], truncated: true };
      let changes = sessionLog.filter((slice) => slice.revision > since);
      const origin = changeOptions?.origin;
      if (origin === 'agent') changes = changes.filter((slice) => agentOrigin(slice.origin));
      else if (origin !== undefined) changes = changes.filter((slice) => slice.origin === origin);
      return { cursor, since, changes: clone(changes) };
    },
    kindsSince(since) {
      return kindsSince(since);
    },
    toJSON(saveOptions) {
      const json = clone(state);
      if (saveOptions?.compact === false) return json;
      for (const page of json.pages)
        page.items = page.items.map((item) => minimalItem(item, kindDefaultsFrom(options.kinds)));
      return json;
    },
    undo(undoOptions) {
      if (options.readonly) return false;
      const index = undoOptions?.origin
        ? walkBack(history, (origin) => origin === undoOptions.origin)
        : hideAgent()
          ? walkBack(history, (origin) => !agentOrigin(origin))
          : history.length - 1;
      if (index < 0) return false;
      const entry = history[index],
        selective = index !== history.length - 1,
        ops = selective ? selectiveInverse(entry, state) : entry.inverse,
        draft = cloneDoc(state),
        actual: Op[] = [],
        redo: Op[] = [];
      try {
        for (const raw of ops) {
          const op = selective ? fitToDoc(raw, draft) : raw;
          if (!op) continue;
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
        before: trace(state, redo),
        after: trace(draft, redo),
        origin: entry.origin,
        label: entry.label,
      };
      const before = state;
      state = draft;
      reindex();
      history.splice(index, 1);
      future.push(reverse);
      const label = `Undo ${entry.label ?? 'change'}`;
      emit({
        ops: actual,
        inverse: redo,
        origin: entry.origin,
        label,
        revision: commitSession({ origin: entry.origin, label, ops: actual }, before, state),
      });
      return true;
    },
    redo() {
      if (options.readonly) return false;
      const index = hideAgent()
        ? walkBack(future, (origin) => !agentOrigin(origin))
        : future.length - 1;
      if (index < 0) return false;
      const reverse = future[index],
        selective = index !== future.length - 1;
      const draft = cloneDoc(state),
        ops: Op[] = [],
        inverse: Op[] = [];
      try {
        for (const raw of reverse.inverse) {
          const op = selective ? fitToDoc(raw, draft) : raw;
          if (!op) continue;
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
        before: trace(state, inverse),
        after: trace(draft, inverse),
        origin: reverse.origin,
        label: reverse.label,
      };
      const before = state;
      state = draft;
      reindex();
      future.splice(index, 1);
      history.push(entry);
      const label = `Redo ${entry.label ?? 'change'}`;
      emit({
        ops,
        inverse,
        origin: entry.origin,
        label,
        revision: commitSession({ origin: entry.origin, label, ops }, before, state),
      });
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
      resetSession();
      emit({ ops: [], inverse: [], origin: 'api', label: 'Load document', revision: 0 });
    },
    clear() {
      if (options.readonly) throw new Error('This document is read-only.');
      state = defaultDoc();
      reindex();
      history.length = 0;
      future.length = 0;
      resetSession();
      emit({ ops: [], inverse: [], origin: 'api', label: 'Clear document', revision: 0 });
    },
    on(_type, callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    get revision() {
      return revision;
    },
    get canUndo() {
      return hideAgent() ? history.some((entry) => !agentOrigin(entry.origin)) : history.length > 0;
    },
    get canRedo() {
      return hideAgent() ? future.some((entry) => !agentOrigin(entry.origin)) : future.length > 0;
    },
  };
  return model;
}
