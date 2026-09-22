import type { Box, Item, Placement } from '../core/types';
import {
  contains,
  flattenItems,
  intersects,
  itemBounds,
  lookupItem,
  type ItemLookup,
} from '../geo/box';

const RELATIONS = ['rightOf', 'leftOf', 'above', 'below', 'inside', 'near'] as const;
type Relation = (typeof RELATIONS)[number];
type Direction = 'rightOf' | 'leftOf' | 'above' | 'below';
type Axis = 'x' | 'y';
/** Tolerance for "at or beyond" comparisons on stored coordinates. */
const EPSILON = 0.5;
const MAX_SLIDES = 64;

/** Connector directions from one batch: source id to the ids it points at. */
export type BatchLinks = ReadonlyMap<string, ReadonlySet<string>>;

/** One existing item to move so an inserted node fits. */
export interface PlaceShift {
  id: string;
  dx: number;
  dy: number;
}

export interface AgentPlacement {
  item: Item;
  /** Top-most items to move; a listed connector moves its waypoints and free endpoints. */
  shifts: PlaceShift[];
}

function blocksPlace(item: Item): boolean {
  return !item.hidden && item.kind !== 'connector' && item.kind !== 'line' && item.kind !== 'path';
}

function singleRelation(place: Placement): Relation {
  const keys = RELATIONS.filter((key) => place[key]);
  if (keys.length !== 1)
    throw new Error(
      'Placement requires exactly one of rightOf, leftOf, above, below, inside, or near.',
    );
  return keys[0];
}

function reference(place: Placement, key: Relation, lookup: ItemLookup): Item {
  const ref = lookupItem(lookup, place[key]!);
  if (!ref) throw new Error(`Placement reference ${place[key]} does not exist.`);
  return ref;
}

function slotBeside(key: Direction, ref: Box, item: Item, gap: number, align: string): Box {
  const offset = (available: number, size: number) =>
    align === 'start' ? 0 : align === 'end' ? available - size : (available - size) / 2;
  const { w, h } = item;
  if (key === 'rightOf') return { x: ref.x + ref.w + gap, y: ref.y + offset(ref.h, h), w, h };
  if (key === 'leftOf') return { x: ref.x - w - gap, y: ref.y + offset(ref.h, h), w, h };
  if (key === 'above') return { x: ref.x + offset(ref.w, w), y: ref.y - h - gap, w, h };
  return { x: ref.x + offset(ref.w, w), y: ref.y + ref.h + gap, w, h };
}

function occupant(box: Box, items: Item[], lookup: ItemLookup, skip: Set<string>) {
  return items.find(
    (other) =>
      !skip.has(other.id) && blocksPlace(other) && intersects(box, itemBounds(other, lookup)),
  );
}

/** The slot just past `hit` along the axis. */
function pastOccupant(box: Box, hit: Box, axis: Axis, dir: 1 | -1, gap: number): Box {
  const next = { ...box };
  if (axis === 'x') next.x = dir > 0 ? hit.x + hit.w + gap : hit.x - next.w - gap;
  else next.y = dir > 0 ? hit.y + hit.h + gap : hit.y - next.h - gap;
  return next;
}

/** Slide further along the placement axis when the first slot is occupied. */
function nextFree(
  box: Box,
  axis: Axis,
  dir: 1 | -1,
  gap: number,
  items: Item[],
  lookup: ItemLookup,
  skip = new Set<string>(),
): Box {
  let next = { ...box };
  for (let step = 0; step < MAX_SLIDES; step++) {
    const hit = occupant(next, items, lookup, skip);
    if (!hit) return next;
    next = pastOccupant(next, itemBounds(hit, lookup), axis, dir, gap);
  }
  return next;
}

function insideGroup(ref: Item, item: Item, gap: number, lookup: ItemLookup) {
  if (ref.kind !== 'group') throw new Error('Inside placement requires a group.');
  const b = { x: ref.x, y: ref.y, w: ref.w, h: ref.h },
    children = ref.children ?? [];
  for (let row = 0; row < 100; row++)
    for (let col = 0; col < 100; col++) {
      const candidate = {
        x: b.x + gap + col * (item.w + gap),
        y: b.y + gap + row * (item.h + gap),
        w: item.w,
        h: item.h,
      };
      if (
        contains(b, candidate) &&
        !children.some((other) => intersects(candidate, itemBounds(other, lookup)))
      )
        return { x: candidate.x, y: candidate.y };
    }
  throw new Error(`No free slot inside ${ref.id}; enlarge the group or use a smaller item.`);
}

function nearReference(b: Box, item: Item, gap: number, items: Item[], lookup: ItemLookup) {
  for (let ring = 1; ring <= 100; ring++) {
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
      )
        return candidate;
  }
  throw new Error('No free space found near the requested item.');
}

/** Exactly one of rightOf, leftOf, above, below, inside, or near. A taken directional slot slides. */
export function placeItem(
  item: Item,
  place: Placement,
  items: Item[],
  lookup: ItemLookup = items,
): Item {
  const key = singleRelation(place),
    ref = reference(place, key, lookup),
    gap = place.gap ?? 32,
    align = place.align ?? 'middle';
  if (key === 'inside') return { ...item, ...insideGroup(ref, item, gap, lookup) };
  const b = itemBounds(ref, lookup);
  if (key === 'near') return { ...item, ...nearReference(b, item, gap, items, lookup) };
  const axis: Axis = key === 'above' || key === 'below' ? 'y' : 'x',
    dir = key === 'leftOf' || key === 'above' ? -1 : 1;
  const free = nextFree(slotBeside(key, b, item, gap, align), axis, dir, gap, items, lookup);
  return { ...item, x: free.x, y: free.y };
}

/**
 * Agent placement reads the batch's arrows when the slot beside the reference is taken.
 * A node that flows between the reference and the occupant is inserted there, and the
 * occupant with everything downstream of it moves over by the node's size plus the gap.
 * A node that follows the occupant goes beyond it. An unconnected node stacks beside it.
 */
export function placeAgentItem(
  item: Item,
  place: Placement,
  items: Item[],
  lookup: ItemLookup = items,
  links?: BatchLinks,
): AgentPlacement {
  const key = singleRelation(place);
  if (key === 'inside' || key === 'near')
    return { item: placeItem(item, place, items, lookup), shifts: [] };
  const ref = reference(place, key, lookup),
    gap = place.gap ?? 32,
    align = place.align ?? 'middle',
    axis: Axis = key === 'above' || key === 'below' ? 'y' : 'x',
    dir = key === 'leftOf' || key === 'above' ? -1 : 1,
    skip = new Set([ref.id, item.id]);
  const linked = new Set<string>(links?.get(item.id) ?? []);
  for (const [from, targets] of links ?? []) if (targets.has(item.id)) linked.add(from);
  let slot = slotBeside(key, itemBounds(ref, lookup), item, gap, align);
  for (let step = 0; step < MAX_SLIDES; step++) {
    const hit = occupant(slot, items, lookup, skip);
    if (!hit) break;
    const hitBounds = itemBounds(hit, lookup);
    const into = links?.get(item.id)?.has(hit.id) ?? false,
      outOf = links?.get(hit.id)?.has(item.id) ?? false,
      forward = dir > 0;
    if (forward ? into : outOf)
      return {
        item: { ...item, x: slot.x, y: slot.y },
        shifts: makeRoom(slot, hit, hitBounds, ref.id, axis, dir, gap, items, lookup),
      };
    // Keep sliding past a node the new one follows, or when its own neighbor sits further down this lane.
    const laneAhead = (other: Item) =>
      linked.has(other.id) &&
      other.id !== hit.id &&
      inLaneBeyond(itemBounds(other, lookup), slot, hitBounds, axis, dir);
    if ((forward ? outOf : into) || items.some(laneAhead)) {
      slot = pastOccupant(slot, hitBounds, axis, dir, gap);
      continue;
    }
    const beside = stackBeside(slot, hitBounds, axis, gap, items, lookup, skip);
    return { item: { ...item, x: beside.x, y: beside.y }, shifts: [] };
  }
  return { item: { ...item, x: slot.x, y: slot.y }, shifts: [] };
}

/** Whether a box lies past the occupant along the axis while overlapping the slot's lane. */
function inLaneBeyond(b: Box, slot: Box, hit: Box, axis: Axis, dir: 1 | -1): boolean {
  if (axis === 'x') {
    const lane = b.y < slot.y + slot.h && b.y + b.h > slot.y;
    return lane && (dir > 0 ? b.x >= hit.x - EPSILON : b.x + b.w <= hit.x + hit.w + EPSILON);
  }
  const lane = b.x < slot.x + slot.w && b.x + b.w > slot.x;
  return lane && (dir > 0 ? b.y >= hit.y - EPSILON : b.y + b.h <= hit.y + hit.h + EPSILON);
}

/** Center the node beside the occupant across the axis, then slide past further neighbors. */
function stackBeside(
  slot: Box,
  hit: Box,
  axis: Axis,
  gap: number,
  items: Item[],
  lookup: ItemLookup,
  skip: Set<string>,
): Box {
  const beside =
    axis === 'x'
      ? { ...slot, x: hit.x + (hit.w - slot.w) / 2, y: hit.y + hit.h + gap }
      : { ...slot, x: hit.x + hit.w + gap, y: hit.y + (hit.h - slot.h) / 2 };
  return nextFree(beside, axis === 'x' ? 'y' : 'x', 1, gap, items, lookup, skip);
}

/** Move the occupant and its side of the flow so the slot holds the new node with the normal gap. */
function makeRoom(
  slot: Box,
  hit: Item,
  hitBounds: Box,
  refId: string,
  axis: Axis,
  dir: 1 | -1,
  gap: number,
  items: Item[],
  lookup: ItemLookup,
): PlaceShift[] {
  const delta =
    axis === 'x'
      ? dir > 0
        ? slot.x + slot.w + gap - hitBounds.x
        : slot.x - gap - (hitBounds.x + hitBounds.w)
      : dir > 0
        ? slot.y + slot.h + gap - hitBounds.y
        : slot.y - gap - (hitBounds.y + hitBounds.h);
  const beyond = (b: Box) =>
    axis === 'x'
      ? dir > 0
        ? b.x >= hitBounds.x - EPSILON
        : b.x + b.w <= hitBounds.x + hitBounds.w + EPSILON
      : dir > 0
        ? b.y >= hitBounds.y - EPSILON
        : b.y + b.h <= hitBounds.y + hitBounds.h + EPSILON;
  const byId = new Map(items.map((entry) => [entry.id, entry]));
  const parents = new Map<string, string>();
  for (const entry of items)
    for (const child of entry.children ?? []) parents.set(child.id, entry.id);
  const connectors = items.filter((entry) => entry.kind === 'connector');
  const downstream = new Map<string, Set<string>>();
  for (const connector of connectors) {
    const from = connector.from && 'item' in connector.from ? connector.from.item : undefined,
      to = connector.to && 'item' in connector.to ? connector.to.item : undefined;
    if (!from || !to) continue;
    if (!downstream.has(from)) downstream.set(from, new Set());
    downstream.get(from)!.add(to);
  }
  // The occupant and what follows it, without passing through the reference.
  const component = new Set([hit.id]);
  const queue = [hit.id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of downstream.get(current) ?? [])
      if (next !== refId && !component.has(next) && byId.has(next)) {
        component.add(next);
        queue.push(next);
      }
  }
  const moving = new Set<string>();
  for (const id of component) {
    const entry = byId.get(id)!;
    if (entry.kind === 'connector' || entry.locked) continue;
    if (id === hit.id || beyond(itemBounds(entry, lookup))) moving.add(id);
  }
  const ancestorMoving = (id: string): boolean => {
    for (let parent = parents.get(id); parent; parent = parents.get(parent))
      if (moving.has(parent)) return true;
    return false;
  };
  const dx = axis === 'x' ? delta : 0,
    dy = axis === 'y' ? delta : 0;
  const shifts: PlaceShift[] = [];
  for (const id of moving) if (!ancestorMoving(id)) shifts.push({ id, dx, dy });
  const covered = (id: string) => moving.has(id) || ancestorMoving(id);
  for (const connector of connectors) {
    const ends = [connector.from, connector.to];
    const bound = ends.flatMap((end) => (end && 'item' in end ? [end.item] : []));
    const free = ends.some((end) => end && !('item' in end));
    if ((connector.waypoints?.length || free) && bound.length && bound.every(covered))
      shifts.push({ id: connector.id, dx, dy });
  }
  return shifts;
}
