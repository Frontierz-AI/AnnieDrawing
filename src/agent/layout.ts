import type { AgentLayout, Box, Endpoint, Item, ItemText, Page } from '../core/types';
import { lockedItems } from '../core/locks';
import { textFontSize } from '../core/textFit';
import { flattenItems, itemBounds } from '../geo/box';
import { isFlowNode, makeRoom, type PlaceShift } from './place';

// Whole-batch layout for `agent:` adds sent without `x`, `y`, or `place`. The batch's nodes and
// every connector between nodes on the page form a graph. Each connected group of new nodes is laid
// out at once: rings, hubs, lanes, and otherwise ranked layers. A group without existing neighbors
// goes below or right of the page content; a group that links to existing nodes is placed around
// them and may push their downstream side forward, but only items an agent placed and nobody moved.

type LayoutHint = Exclude<AgentLayout, 'auto' | 'none'>;
type Direction = 'right' | 'down';
type Edge = { a: string; b: string; text?: ItemText };

/** New nodes the batch layout arranges after the ops run, and items placed beside them. */
export interface PendingLayout {
  pending: Set<string>;
  /** Item id to the id of the node it was placed beside. */
  attached: Map<string, string>;
}

/**
 * Arrange the pending nodes on every page, then move each item placed beside one of them by the
 * same amount. Existing items move only through `shift`, and only when `placed` says an agent put
 * them there; locked items and items in locked groups never move.
 */
export function layoutPages(
  pages: Page[],
  { pending, attached }: PendingLayout,
  options: {
    placed: (id: string) => boolean;
    shift: (item: Item, shift: PlaceShift) => void;
    gap: number;
    viewport?: { w: number; h: number };
    hint?: AgentLayout;
  },
): void {
  const view = options.viewport;
  const viewport =
    view && view.w > 0 && view.h > 0 && Number.isFinite(view.w + view.h)
      ? view
      : { w: 1280, h: 760 };
  for (const page of pages) {
    const items = flattenItems(page.items),
      byId = new Map(items.map((item) => [item.id, item]));
    const nodes = [...pending].filter((id) => byId.has(id));
    if (!nodes.length) continue;
    const start = new Map(
      [...nodes, ...attached.keys()]
        .filter((id) => byId.has(id))
        .map((id) => [id, { x: byId.get(id)!.x, y: byId.get(id)!.y }]),
    );
    const locked = lockedItems(page.items);
    layoutBatch({
      items,
      nodes,
      free: new Set(attached.keys()),
      movable: (item) => !locked.has(item.id) && options.placed(item.id),
      shift: (shift) => options.shift(byId.get(shift.id)!, shift),
      gap: options.gap,
      viewport,
      hint: typeof options.hint === 'object' ? options.hint : undefined,
    });
    const translate = (item: Item, dx: number, dy: number) => {
      item.x += dx;
      item.y += dy;
      item.children?.forEach((child) => translate(child, dx, dy));
    };
    for (const [id, ref] of attached) {
      const item = byId.get(id),
        target = byId.get(ref),
        from = start.get(ref);
      if (item && target && from) translate(item, target.x - from.x, target.y - from.y);
    }
  }
}

interface BatchLayout {
  /** Flattened page items after the batch ops. New nodes are moved in place. */
  items: Item[];
  /** New, unpositioned node ids in batch order. */
  nodes: string[];
  /** Items that follow a new node and are neither obstacles nor neighbors. */
  free: ReadonlySet<string>;
  /** Whether an existing item may be pushed along the flow. */
  movable: (item: Item) => boolean;
  /** Move an existing item; the caller records the change. */
  shift: (shift: PlaceShift) => void;
  gap: number;
  viewport: { w: number; h: number };
  hint?: LayoutHint;
}

/** What the layout arranges or keeps clear of. Connectors, strokes, groups, and derived kinds are neither. */
export function isLayoutNode(item: Item): boolean {
  return !item.hidden && isFlowNode(item);
}

/** The zoom the camera's fit picks for a box: 96 px padding per side, capped at 1.5. */
function fitZoom(box: Box, viewport: { w: number; h: number }): number {
  const w = Math.max(120, viewport.w - Math.min(192, viewport.w * 0.3)),
    h = Math.max(120, viewport.h - Math.min(192, viewport.h * 0.35));
  return Math.max(0.05, Math.min(1.5, w / Math.max(1, box.w), h / Math.max(1, box.h)));
}

/** Room a connector label needs, as the stage draws it: at most 240 px wide plus padding. */
function labelSpan(text: ItemText | undefined, right: boolean): number {
  const value = text?.value.trim();
  if (!value) return 0;
  const size = textFontSize(text),
    width = value.length * size * 0.62;
  return 32 + (right ? Math.min(240, width) + 16 : Math.ceil(width / 240) * size * 1.25 + 6);
}

/** Weight that keeps trunk nodes on one line: everything else yields to them. */
const LINE = 1e6;
const end = (point?: Endpoint) => (point && 'item' in point ? point.item : undefined);
const union = (boxes: Box[]): Box | undefined => {
  if (!boxes.length) return;
  let [x, y, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    x = Math.min(x, b.x);
    y = Math.min(y, b.y);
    right = Math.max(right, b.x + b.w);
    bottom = Math.max(bottom, b.y + b.h);
  }
  return { x, y, w: right - x, h: bottom - y };
};
/** Clear space between two boxes along their best axis; negative when they overlap. */
const apart = (a: Box, b: Box) =>
  Math.max(b.x - a.x - a.w, a.x - b.x - b.w, b.y - a.y - a.h, a.y - b.y - b.h);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** Weighted isotonic regression (pool adjacent violators). */
function pool(values: number[], weights: number[]): number[] {
  const blocks: [value: number, weight: number, count: number][] = [];
  values.forEach((value, index) => {
    let block: [number, number, number] = [value, weights[index], 1];
    while (blocks.length && blocks[blocks.length - 1][0] > block[0]) {
      const [v, w, n] = blocks.pop()!;
      block = [(v * w + block[0] * block[1]) / (w + block[1]), w + block[1], n + block[2]];
    }
    blocks.push(block);
  });
  return blocks.flatMap(([value, , count]) => Array<number>(count).fill(value));
}

interface Vert {
  id: string;
  /** Size along the rank axis and across it. */
  su: number;
  sv: number;
  rank: number;
  /** Center across the rank axis. */
  v: number;
  /** A center that never changes: an existing node, or a lane between two of them. */
  fix?: number;
  pin?: Item;
  dummy?: boolean;
  weight: number;
  key: number;
  up: [Vert, number][];
  down: [Vert, number][];
  /** First predecessor; siblings of different parents keep a wider gap. */
  family?: string;
}

function layoutBatch(input: BatchLayout): void {
  const { items, gap: G, viewport, hint = {} } = input;
  const S = Math.max(Math.min(G, 32), G * 0.4);
  const byId = new Map(items.map((item) => [item.id, item]));
  const fresh = input.nodes.filter((id) => byId.has(id));
  const isFresh = new Set(fresh);
  const node = (id?: string) => {
    const item = id ? byId.get(id) : undefined;
    return item && isLayoutNode(item) && !input.free.has(item.id) ? item : undefined;
  };
  const edges: Edge[] = [];
  for (const item of items) {
    const a = end(item.from),
      b = end(item.to);
    if (item.kind === 'connector' && !item.hidden && a !== b && node(a) && node(b))
      edges.push({ a: a!, b: b!, text: item.text });
  }
  const linked = new Set(edges.flatMap((edge) => [edge.a, edge.b]));
  const first = byId.get(fresh[0]);
  // A first text without arrows titles the batch's diagram, when there is one.
  const caption =
    first?.kind === 'text' && !linked.has(first.id) && fresh.some((id) => linked.has(id))
      ? first.id
      : undefined;

  // Groups of new nodes joined by arrows, with the existing nodes they touch.
  const up = new Map<string, string>();
  const find = (id: string): string => {
    const parent = up.get(id);
    if (!parent || parent === id) return id;
    const root = find(parent);
    up.set(id, root);
    return root;
  };
  for (const edge of edges)
    if (isFresh.has(edge.a) || isFresh.has(edge.b)) up.set(find(edge.a), find(edge.b));
  const units: string[][] = [];
  const unitOf = new Map<string, string[]>();
  let grid: string[] | undefined;
  for (const id of fresh) {
    if (id === caption) continue;
    if (!linked.has(id)) {
      if (!grid) units.push((grid = []));
      grid.push(id);
      continue;
    }
    let unit = unitOf.get(find(id));
    if (!unit) units.push((unit = []));
    unitOf.set(find(id), unit);
    unit.push(id);
  }
  const pinsOf = new Map<string[], Item[]>();
  for (const item of items) {
    const unit = !isFresh.has(item.id) && linked.has(item.id) && unitOf.get(find(item.id));
    if (unit && node(item.id)) pinsOf.set(unit, [...(pinsOf.get(unit) ?? []), item]);
  }

  const done = new Set<string>();
  const solid = () =>
    items
      .filter(
        (item) =>
          isLayoutNode(item) &&
          (!isFresh.has(item.id) || done.has(item.id)) &&
          !input.free.has(item.id),
      )
      .map((item) => itemBounds(item));
  const move = (id: string, box: Box) => {
    const item = byId.get(id)!;
    item.x = Math.round(box.x);
    item.y = Math.round(box.y);
    done.add(id);
  };
  /** Slide a box across the flow to the nearest spot at least half a sibling gap from the blockers. */
  const clear = (box: Box, blockers: Box[], vertical: boolean): Box => {
    const hit = (candidate: Box) => blockers.some((other) => apart(candidate, other) < S / 2);
    if (!hit(box)) return box;
    const at = vertical ? box.y : box.x;
    const spots = blockers
      .flatMap((other) =>
        vertical
          ? [other.y - box.h - S, other.y + other.h + S]
          : [other.x - box.w - S, other.x + other.w + S],
      )
      .sort((a, b) => Math.abs(a - at) - Math.abs(b - at));
    for (const spot of spots) {
      const candidate = vertical ? { ...box, y: spot } : { ...box, x: spot };
      if (!hit(candidate)) return candidate;
    }
    return box;
  };
  const edgesOf = (ids: Set<string>) => edges.filter((edge) => ids.has(edge.a) && ids.has(edge.b));

  /** Ranked layers. Existing nodes keep their place across the flow and may be pushed along it. */
  function layered(ids: string[], dir: Direction, pins: Item[] = []) {
    const right = dir === 'right';
    const verts = new Map<string, Vert>();
    const make = (item: Item, pin?: boolean): Vert => ({
      id: item.id,
      su: right ? item.w : item.h,
      sv: right ? item.h : item.w,
      rank: 0,
      v: 0,
      weight: 1,
      key: 0,
      up: [],
      down: [],
      ...(pin ? { pin: item, fix: right ? item.y + item.h / 2 : item.x + item.w / 2 } : {}),
    });
    for (const item of pins) verts.set(item.id, make(item, true));
    for (const id of ids) verts.set(id, make(byId.get(id)!));
    const list = [...verts.values()];
    const graph = edgesOf(new Set(verts.keys()));
    const out = new Map<string, Edge[]>();
    const into = new Map<string, number>();
    for (const edge of graph) {
      out.set(edge.a, [...(out.get(edge.a) ?? []), edge]);
      into.set(edge.b, (into.get(edge.b) ?? 0) + 1);
    }
    // Depth-first from the sources: an arrow back to the current path is a feedback edge.
    const state = new Map<string, number>(),
      back = new Set<Edge>();
    let key = 0;
    const visit = (vert: Vert) => {
      state.set(vert.id, 1);
      vert.key = key++;
      for (const edge of out.get(vert.id) ?? []) {
        const next = verts.get(edge.b)!;
        if (state.get(next.id) === 1) back.add(edge);
        else if (!state.has(next.id)) visit(next);
      }
      state.set(vert.id, 2);
    };
    for (const vert of list) if (!into.get(vert.id) && !state.has(vert.id)) visit(vert);
    for (const vert of list) if (!state.has(vert.id)) visit(vert);
    const forward = graph.filter((edge) => !back.has(edge));
    // Longest path from the sources; a source then moves up to just before its first target.
    const order = [...list].sort((a, b) => a.key - b.key);
    for (let pass = 0; pass < list.length; pass++) {
      let changed = false;
      for (const edge of forward) {
        const a = verts.get(edge.a)!,
          b = verts.get(edge.b)!;
        if (b.rank < a.rank + 1) {
          b.rank = a.rank + 1;
          changed = true;
        }
      }
      if (!changed) break;
    }
    for (const vert of order) {
      const targets = forward.filter((edge) => edge.a === vert.id).map((e) => verts.get(e.b)!.rank);
      if (targets.length && !forward.some((edge) => edge.b === vert.id))
        vert.rank = Math.min(...targets) - 1;
    }
    const used = [...new Set(list.map((vert) => vert.rank))].sort((a, b) => a - b);
    for (const vert of list) vert.rank = used.indexOf(vert.rank);
    // A node on every longest path, alone in its rank, is the trunk and holds the line.
    const tail = new Map<string, number>();
    for (const vert of [...list].sort((a, b) => b.rank - a.rank))
      tail.set(
        vert.id,
        Math.max(
          0,
          ...forward
            .filter((edge) => edge.a === vert.id)
            .map((edge) => tail.get(edge.b)! + verts.get(edge.b)!.rank - vert.rank),
        ),
      );
    const longest = Math.max(...list.map((vert) => vert.rank + tail.get(vert.id)!));
    const critical = list.filter((vert) => vert.rank + tail.get(vert.id)! === longest);
    const trunk = new Set(
      critical.filter((vert) => critical.filter((other) => other.rank === vert.rank).length === 1),
    );
    for (const vert of trunk) vert.weight = LINE;
    // Long arrows pass through thin placeholders, one per rank they cross.
    const layers: Vert[][] = [];
    const add = (vert: Vert) => (layers[vert.rank] ??= []).push(vert);
    list.forEach(add);
    const link = (a: Vert, b: Vert, weight: number) => {
      a.down.push([b, weight]);
      b.up.push([a, weight]);
      b.family ??= a.dummy ? undefined : a.id;
    };
    const labels: number[] = [];
    for (const edge of forward) {
      const a = verts.get(edge.a)!,
        b = verts.get(edge.b)!;
      const weight = trunk.has(a) && trunk.has(b) ? LINE : 1;
      if (b.rank === a.rank + 1) {
        link(a, b, weight);
        labels[a.rank] = Math.max(labels[a.rank] ?? 0, labelSpan(edge.text, right));
        continue;
      }
      let previous = a;
      for (let rank = a.rank + 1; rank < b.rank; rank++) {
        const dummy: Vert = {
          id: '',
          su: 0,
          sv: 0,
          rank,
          v: 0,
          dummy: true,
          weight: 2,
          key: (a.key + b.key) / 2,
          up: [],
          down: [],
        };
        if (a.pin && b.pin)
          dummy.fix = a.fix! + ((b.fix! - a.fix!) * (rank - a.rank)) / (b.rank - a.rank);
        add(dummy);
        link(previous, dummy, 2);
        previous = dummy;
      }
      link(previous, b, 2);
    }
    // Across the flow: sweep the ranks, ordering each by its neighbors and packing it in order.
    const separation = (a: Vert, b: Vert) =>
      (a.sv + b.sv) / 2 +
      (a.dummy || b.dummy
        ? S / 2
        : S + (a.family && b.family && a.family !== b.family ? S / 2 : 0));
    const place = (layer: Vert[], target: Map<Vert, number>) => {
      const offset = [0];
      for (let index = 1; index < layer.length; index++)
        offset[index] = offset[index - 1] + separation(layer[index - 1], layer[index]);
      let start = 0,
        low = -Infinity;
      while (start <= layer.length) {
        let stop = start;
        while (stop < layer.length && layer[stop].fix === undefined) stop++;
        const high = stop < layer.length ? layer[stop].fix! - offset[stop] : Infinity;
        const segment = layer.slice(start, stop);
        const z = pool(
          segment.map((vert, index) => target.get(vert)! - offset[start + index]),
          segment.map((vert) => vert.weight),
        );
        segment.forEach((vert, index) => {
          vert.v = Math.max(low, Math.min(high, z[index])) + offset[start + index];
        });
        if (stop < layer.length) {
          layer[stop].v = layer[stop].fix!;
          low = high;
        }
        start = stop + 1;
      }
    };
    const sweep = (layer: Vert[], downward: boolean, reorder: boolean) => {
      const target = new Map<Vert, number>();
      for (const vert of layer) {
        let total = 0,
          weight = 0;
        for (const [other, w] of downward ? vert.up : vert.down) {
          total += other.v * w;
          weight += w;
        }
        target.set(vert, vert.fix ?? (weight ? total / weight : vert.v));
      }
      if (reorder) layer.sort((a, b) => target.get(a)! - target.get(b)! || fixedLast(a, b));
      place(layer, target);
    };
    // On a tie, new nodes go before (above or left of) what is already there.
    const fixedLast = (a: Vert, b: Vert) => +(a.fix !== undefined) - +(b.fix !== undefined);
    // Start beside the existing neighbors, if any, in depth-first order.
    const start = (vert: Vert) => {
      const fixed = [...vert.up, ...vert.down].filter(([other]) => other.fix !== undefined);
      return (
        vert.fix ?? (fixed.length ? sum(fixed.map(([other]) => other.fix!)) / fixed.length : 0)
      );
    };
    for (const layer of layers) {
      layer.sort((a, b) => start(a) - start(b) || fixedLast(a, b) || a.key - b.key);
      place(layer, new Map(layer.map((vert) => [vert, start(vert)])));
    }
    const crossings = () => {
      let count = 0;
      for (const layer of layers) {
        const pairs = layer.flatMap((vert, index) =>
          vert.down.map(([other]) => [index, layers[other.rank].indexOf(other)]),
        );
        for (let i = 0; i < pairs.length; i++)
          for (let j = i + 1; j < pairs.length; j++)
            if ((pairs[i][0] - pairs[j][0]) * (pairs[i][1] - pairs[j][1]) < 0) count++;
      }
      return count;
    };
    const passes = (reorder: boolean) => {
      for (let rank = 1; rank < layers.length; rank++) sweep(layers[rank], true, reorder);
      for (let rank = layers.length - 2; rank >= 0; rank--) sweep(layers[rank], false, reorder);
    };
    const snapshot = () => layers.map((layer) => layer.map((vert) => [vert, vert.v] as const));
    let best = snapshot(),
      fewest = crossings();
    for (let round = 0; round < 4 && fewest; round++) {
      passes(true);
      const count = crossings();
      if (count < fewest) {
        fewest = count;
        best = snapshot();
      }
    }
    best.forEach((layer, rank) => {
      layers[rank] = layer.map(([vert, v]) => ((vert.v = v), vert));
    });
    for (let round = 0; round < 3; round++) passes(false);

    // Along the flow: columns as wide as their widest node, a gap that fits edge labels.
    const width = layers.map((layer) =>
      Math.max(0, ...layer.filter((v) => !v.dummy).map((v) => v.su)),
    );
    const gapAfter = (rank: number) => Math.max(G, labels[rank] ?? 0);
    const center: number[] = [];
    const lead = (vert: Vert) => (right ? vert.pin!.x : vert.pin!.y);
    const pinned = layers.map((layer) => layer.find((vert) => vert.pin));
    const anchor = pinned.findIndex(Boolean);
    if (anchor < 0) {
      center[0] = width[0] / 2;
    } else {
      center[anchor] = lead(pinned[anchor]!) + pinned[anchor]!.su / 2;
      for (let rank = anchor - 1; rank >= 0; rank--)
        center[rank] = center[rank + 1] - width[rank + 1] / 2 - gapAfter(rank) - width[rank] / 2;
    }
    let lastPinned = Math.max(anchor, 0);
    for (let rank = lastPinned + 1; rank < layers.length; rank++) {
      const required =
        center[rank - 1] + width[rank - 1] / 2 + gapAfter(rank - 1) + width[rank] / 2;
      const pin = pinned[rank];
      if (!pin) {
        center[rank] = required;
        continue;
      }
      let at = lead(pin) + pin.su / 2;
      const between = layers
        .slice(lastPinned + 1, rank)
        .some((layer) => layer.some((vert) => !vert.dummy && !vert.pin));
      if (at < required && at >= center[lastPinned] && between && input.movable(pin.pin!)) {
        const hit = pin.pin!,
          hitBounds = itemBounds(hit),
          leading = required - pin.su / 2;
        const stop = new Set([
          ...fresh,
          ...layers
            .slice(0, rank)
            .flat()
            .map((vert) => vert.id),
        ]);
        const slot = right
          ? { x: leading - G, y: hit.y, w: 0, h: hit.h }
          : { x: hit.x, y: leading - G, w: hit.w, h: 0 };
        for (const shift of makeRoom(
          slot,
          hit,
          hitBounds,
          stop,
          right ? 'x' : 'y',
          1,
          G,
          items,
          items,
          input.movable,
        ))
          input.shift(shift);
        at = lead(pin) + pin.su / 2;
      }
      // A pin that stays behind keeps its place; new nodes in later ranks still clear this one.
      center[rank] = Math.max(at, required);
      lastPinned = rank;
    }
    const boxes = new Map<string, Box>();
    for (const vert of list) {
      if (vert.pin) continue;
      const u = center[vert.rank] - vert.su / 2,
        v = vert.v - vert.sv / 2;
      const item = byId.get(vert.id)!;
      boxes.set(vert.id, { x: right ? u : v, y: right ? v : u, w: item.w, h: item.h });
    }
    return { boxes, rank: new Map(list.map((vert) => [vert.id, vert.rank])) };
  }

  /** Rows of consecutive ranks, for a long flow that is too wide. */
  function wrapped(result: ReturnType<typeof layered>, per: number) {
    const groups: string[][] = [];
    for (const [id, rank] of result.rank)
      if (result.boxes.has(id)) (groups[Math.floor(rank / per)] ??= []).push(id);
    const boxes = new Map<string, Box>();
    let top = 0;
    for (const ids of groups) {
      const area = union(ids.map((id) => result.boxes.get(id)!))!;
      for (const id of ids) {
        const box = result.boxes.get(id)!;
        boxes.set(id, { ...box, x: box.x - area.x, y: box.y - area.y + top });
      }
      top += area.h + G;
    }
    return boxes;
  }

  const zoomOf = (boxes: Map<string, Box>) => fitZoom(union([...boxes.values()])!, viewport);

  function flow(ids: string[]): Map<string, Box> {
    const dirs: Direction[] = hint.direction
      ? [hint.direction]
      : hint.shape === 'tree'
        ? ['down']
        : hint.shape === 'flow'
          ? ['right']
          : ['right', 'down'];
    const options = dirs.map((dir) => layered(ids, dir));
    const zooms = options.map((option) => zoomOf(option.boxes));
    const pick = zooms[1] > zooms[0] * 1.2 ? 1 : 0;
    let boxes = options[pick].boxes,
      zoom = zooms[pick];
    if (dirs.length > 1 && zoom < 0.6)
      // Rows of `per` ranks each, longest rows first.
      for (let per = Math.max(...options[0].rank.values()); per > 0; per--) {
        const candidate = wrapped(options[0], per);
        const next = zoomOf(candidate);
        if (next > zoom) {
          boxes = candidate;
          zoom = next;
        }
      }
    return boxes;
  }

  /** Nodes in clockwise order on an ellipse around a center, spread until nothing touches. */
  function around(ids: string[], start: number, spaced: (boxes: Box[]) => boolean) {
    const sizes = ids.map((id) => byId.get(id)!);
    const n = ids.length;
    let rx = (Math.max(...sizes.map((s) => s.w)) + G) / 2,
      ry = (Math.max(...sizes.map((s) => s.h)) + G) / 2,
      boxes: Box[] = [];
    for (let step = 0; step < 80; step++) {
      boxes = sizes.map((size, index) => {
        const angle = start + (2 * Math.PI * index) / n;
        return {
          x: rx * Math.cos(angle) - size.w / 2,
          y: ry * Math.sin(angle) - size.h / 2,
          w: size.w,
          h: size.h,
        };
      });
      if (spaced(boxes)) break;
      rx *= 1.06;
      ry *= 1.06;
    }
    return boxes;
  }

  function ring(ids: string[], graph: Edge[]): Map<string, Box> {
    const next = new Map(graph.map((edge) => [edge.a, edge.b]));
    const order = [ids[0]];
    while (order.length < ids.length) {
      const following = next.get(order[order.length - 1]);
      if (!following || order.includes(following)) break;
      order.push(following);
    }
    for (const id of ids) if (!order.includes(id)) order.push(id);
    const n = order.length;
    const boxes = around(order, -Math.PI / 2 - Math.PI / n, (boxes) =>
      boxes.every((a, i) =>
        boxes.every(
          (b, j) => j <= i || apart(a, b) >= (j === i + 1 || (i === 0 && j === n - 1) ? G : S),
        ),
      ),
    );
    return new Map(order.map((id, index) => [id, boxes[index]]));
  }

  function radial(hub: string, spokes: string[]): Map<string, Box> {
    const center = byId.get(hub)!;
    const hubBox = { x: -center.w / 2, y: -center.h / 2, w: center.w, h: center.h };
    const near = G * 0.75;
    let boxes = around(spokes, -Math.PI / 2, (boxes) =>
      boxes.every(
        (a, i) => apart(a, hubBox) >= near && boxes.every((b, j) => j <= i || apart(a, b) >= S),
      ),
    );
    const usable = viewport.h - Math.min(192, viewport.h * 0.35);
    if (union([hubBox, ...boxes])!.h > usable / 0.6) {
      // Too tall to read: two columns beside the hub, clockwise from the top right.
      const half = Math.ceil(spokes.length / 2);
      const column = (list: number[], side: 1 | -1) => {
        let y = -(sum(list.map((i) => byId.get(spokes[i])!.h)) + S * (list.length - 1)) / 2;
        for (const i of list) {
          const { w, h } = byId.get(spokes[i])!;
          boxes[i] = { x: side > 0 ? hubBox.w / 2 + G : -hubBox.w / 2 - G - w, y, w, h };
          y += h + S;
        }
      };
      boxes = [];
      column(
        spokes.slice(0, half).map((_, i) => i),
        1,
      );
      column(
        spokes
          .map((_, i) => i)
          .slice(half)
          .reverse(),
        -1,
      );
    }
    return new Map([[hub, hubBox], ...spokes.map((id, i): [string, Box] => [id, boxes[i]])]);
  }

  /** Chains linked by rungs between their middles stay on their own rows. */
  function lanes(ids: string[], graph: Edge[]): string[][] | undefined {
    const next = new Map<string, string>(),
      prev = new Map<string, string>();
    for (const edge of graph) {
      if (next.has(edge.a) || prev.has(edge.b)) continue;
      let head = edge.a;
      while (prev.has(head)) head = prev.get(head)!;
      if (head === edge.b) continue;
      next.set(edge.a, edge.b);
      prev.set(edge.b, edge.a);
    }
    const chains = ids
      .filter((id) => !prev.has(id))
      .map((id) => {
        const chain = [id];
        while (next.has(chain[chain.length - 1])) chain.push(next.get(chain[chain.length - 1])!);
        return chain;
      });
    const rung = graph.some(
      (edge) => next.get(edge.a) !== edge.b && next.has(edge.a) && prev.has(edge.b),
    );
    if (
      rung &&
      chains.every((chain) => chain.length > 1) &&
      chains.filter((chain) => chain.length > 2).length > 1
    )
      return chains;
  }

  function rows(chains: string[][], graph: Edge[]): Map<string, Box> {
    const col = new Map<string, number>(),
      lane = new Map<string, number>();
    let columns = 0;
    chains.forEach((chain, index) => {
      let shift = 0,
        cheapest = Infinity;
      for (let step = 0; index && step <= 2 * (columns + chain.length); step++) {
        const offset = step % 2 ? (step + 1) / 2 : -step / 2;
        let cost = 0;
        for (const edge of graph) {
          const from = chain.indexOf(edge.a),
            to = chain.indexOf(edge.b);
          if (from < 0 === to < 0 || !col.has(from < 0 ? edge.a : edge.b)) continue;
          const span = to < 0 ? col.get(edge.b)! - from - offset : to + offset - col.get(edge.a)!;
          cost += span < 0 ? 1000 - span : span;
        }
        if (cost < cheapest) {
          cheapest = cost;
          shift = offset;
        }
      }
      chain.forEach((id, i) => {
        col.set(id, i + shift);
        lane.set(id, index);
      });
      columns = Math.max(columns, chain.length + shift);
    });
    const low = Math.min(...col.values());
    const colW: number[] = [],
      rowH: number[] = [],
      gaps: number[] = [];
    for (const id of col.keys()) {
      const { w, h } = byId.get(id)!,
        c = col.get(id)! - low;
      colW[c] = Math.max(colW[c] ?? 0, w);
      rowH[lane.get(id)!] = Math.max(rowH[lane.get(id)!] ?? 0, h);
    }
    for (const edge of graph)
      if (col.get(edge.b)! === col.get(edge.a)! + 1)
        gaps[col.get(edge.a)! - low] = Math.max(
          gaps[col.get(edge.a)! - low] ?? 0,
          labelSpan(edge.text, true),
        );
    const colX = [0],
      rowY = [0];
    for (let c = 1; c < colW.length; c++)
      colX[c] = colX[c - 1] + (colW[c - 1] ?? 0) + Math.max(G, gaps[c - 1] ?? 0);
    for (let r = 1; r < rowH.length; r++) rowY[r] = rowY[r - 1] + rowH[r - 1] + G;
    return new Map(
      [...col].map(([id, c]): [string, Box] => {
        const { w, h } = byId.get(id)!,
          r = lane.get(id)!;
        return [
          id,
          { x: colX[c - low] + (colW[c - low] - w) / 2, y: rowY[r] + (rowH[r] - h) / 2, w, h },
        ];
      }),
    );
  }

  /** Unconnected nodes in the grid whose shape best fits the viewport. */
  function packed(ids: string[]): Map<string, Box> {
    let best: Map<string, Box> = new Map(),
      bestZoom = -1;
    for (let cols = ids.length; cols >= 1; cols--) {
      const colW = Array<number>(cols).fill(0),
        rowH = Array<number>(Math.ceil(ids.length / cols)).fill(0);
      ids.forEach((id, i) => {
        const { w, h } = byId.get(id)!;
        colW[i % cols] = Math.max(colW[i % cols], w);
        rowH[Math.floor(i / cols)] = Math.max(rowH[Math.floor(i / cols)], h);
      });
      const zoom = fitZoom(
        { x: 0, y: 0, w: sum(colW) + G * (cols - 1), h: sum(rowH) + G * (rowH.length - 1) },
        viewport,
      );
      if (zoom <= bestZoom) continue;
      bestZoom = zoom;
      best = new Map(
        ids.map((id, i): [string, Box] => {
          const { w, h } = byId.get(id)!,
            c = i % cols,
            r = Math.floor(i / cols);
          return [
            id,
            {
              x: sum(colW.slice(0, c)) + G * c + (colW[c] - w) / 2,
              y: sum(rowH.slice(0, r)) + G * r + (rowH[r] - h) / 2,
              w,
              h,
            },
          ];
        }),
      );
    }
    return best;
  }

  function arrange(ids: string[], isGrid: boolean): Map<string, Box> {
    if (isGrid) return packed(ids);
    const graph = edgesOf(new Set(ids));
    const degree = (id: string) => graph.filter((edge) => edge.a === id || edge.b === id).length;
    const n = ids.length;
    const cycle =
      n > 2 &&
      n <= 16 &&
      graph.length === n &&
      ids.every(
        (id) =>
          graph.filter((edge) => edge.a === id).length === 1 &&
          graph.filter((edge) => edge.b === id).length === 1,
      );
    if (hint.shape === 'ring' || (!hint.shape && cycle)) return ring(ids, graph);
    const hub = ids.reduce((top, id) => (degree(id) > degree(top) ? id : top), ids[0]);
    const star =
      n > 4 &&
      n <= 41 &&
      degree(hub) === n - 1 &&
      graph.length === n - 1 &&
      (graph.every((edge) => edge.a === hub) || graph.every((edge) => edge.b === hub));
    if (hint.shape === 'radial' || (!hint.shape && star))
      return radial(
        hub,
        ids.filter((id) => id !== hub),
      );
    const chains = hint.shape ? undefined : lanes(ids, graph);
    return chains ? rows(chains, graph) : flow(ids);
  }

  const titled = units.find((unit) => unit !== grid);
  units.forEach((ids) => {
    const title = ids === titled ? caption : undefined;
    const pins = pinsOf.get(ids);
    if (pins) {
      let dx = 0,
        dy = 0;
      const pinIds = new Set(pins.map((pin) => pin.id));
      for (const edge of edges)
        if (
          (pinIds.has(edge.a) || pinIds.has(edge.b)) &&
          !isFresh.has(edge.a) &&
          !isFresh.has(edge.b)
        ) {
          const a = byId.get(edge.a)!,
            b = byId.get(edge.b)!;
          dx += Math.abs(b.x + b.w / 2 - a.x - a.w / 2);
          dy += Math.abs(b.y + b.h / 2 - a.y - a.h / 2);
        }
      const dir = hint.direction ?? (dy > dx ? 'down' : 'right');
      const { boxes } = layered(ids, dir, pins);
      const blockers = solid(),
        placed: Box[] = [];
      for (const id of ids) {
        const box = clear(boxes.get(id)!, [...blockers, ...placed], dir === 'right');
        placed.push(box);
        move(id, box);
      }
      if (title) {
        const area = union(placed)!,
          item = byId.get(title)!;
        move(
          title,
          clear(
            { x: area.x, y: area.y - S / 2 - item.h, w: item.w, h: item.h },
            [...blockers, ...placed],
            true,
          ),
        );
      }
      return;
    }
    const boxes = arrange(ids, ids === grid);
    if (title) {
      const area = union([...boxes.values()])!,
        item = byId.get(title)!;
      for (const box of boxes.values()) box.y += item.h + S / 2;
      boxes.set(title, { x: area.x, y: area.y, w: item.w, h: item.h });
    }
    const area = union([...boxes.values()])!;
    const content = union(solid());
    let dx = -area.x,
      dy = -area.y;
    if (content) {
      const space = G * 1.5;
      const right = { x: content.x + content.w + space, y: content.y },
        below = { x: content.x, y: content.y + content.h + space };
      const zoom = (at: { x: number; y: number }) =>
        fitZoom(union([content, { ...area, ...at }])!, viewport);
      const at = zoom(below) > zoom(right) + 1e-3 ? below : right;
      dx = at.x - area.x;
      dy = at.y - area.y;
    }
    for (const [id, box] of boxes) move(id, { ...box, x: box.x + dx, y: box.y + dy });
  });
}
