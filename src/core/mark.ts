import type { Box, Item, Op, Page, Point } from './types';
import { clone } from './defaults';
import { textFontSize } from './textFit';
import {
  layoutRichText,
  parseRichText,
  richLineWidth,
  visibleText,
  type TextLine,
} from './richText';
import { rotatePoint, segmentDistance } from '../geo/vec';

export const MARK_TYPES = ['highlight', 'underline', 'circle', 'box'] as const;
export type MarkType = (typeof MARK_TYPES)[number];

/**
 * Drawn over another item and never takes space: placement, layout, routing obstacles,
 * overlap warnings, and fit bounds skip it. Today that is the `mark` kind.
 */
export function isOverlay(item: Pick<Item, 'kind'>): boolean {
  return item.kind === 'mark';
}

/** The box a mark is drawn in: its target's box and rotation. Groups, lines, and paths use their bounds. */
export interface MarkFrame extends Box {
  rotation: number;
}
export function markFrame(target: Item, bounds: Box): MarkFrame {
  return ['group', 'line', 'path'].includes(target.kind)
    ? { ...bounds, rotation: 0 }
    : { x: target.x, y: target.y, w: target.w, h: target.h, rotation: target.rotation ?? 0 };
}

/** One stroke or fill of a mark, in frame coordinates. */
export interface MarkShape {
  fill: boolean;
  points: Point[];
}

/** Glyph advance the SVG exporter wraps with (`textMarkup` in `src/porter/svg.ts`). */
const ADVANCE = 0.53;
const blank = (char?: string) => !!char && /\s/.test(char);

/** Row and column of each source character in rows from `wrapPlainText`; collapsed whitespace has none. */
function placeChars(source: string, rows: string[]): ([number, number] | undefined)[] {
  const out: ([number, number] | undefined)[] = [];
  let s = 0;
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] === ' ' && blank(source[s])) {
        out[s++] = [r, c];
        while (blank(source[s])) s++;
        continue;
      }
      while (blank(source[s])) s++;
      out[s++] = [r, c];
    }
  });
  return out;
}

/**
 * Where the phrase sits in the target's label, in frame coordinates: one box per wrapped row,
 * laid out with the exporter's wrapping. `match` is read against the visible text, so `md`
 * markers and emphasis do not count. Without a phrase in the text, the whole frame.
 */
export function markRects(mark: Item, target: Item, frame: Box): Box[] {
  const whole = [{ x: 0, y: 0, w: frame.w, h: frame.h }];
  const text = target.text;
  const start =
    typeof mark.match === 'string' && mark.match && typeof text?.value === 'string'
      ? visibleText(text).indexOf(mark.match)
      : -1;
  if (!text || start < 0 || ['group', 'line', 'path', 'connector'].includes(target.kind))
    return whole;
  const kind = target.kind,
    size = textFontSize(text),
    pad = kind === 'text' ? 0 : kind === 'note' ? 20 : 12,
    width = target.w * (kind === 'diamond' ? 0.6 : kind === 'ellipse' ? 0.75 : 1) - pad * 2,
    align = text.align ?? (kind === 'text' ? 'start' : 'center'),
    anchor = align === 'start' ? pad : align === 'end' ? target.w - pad : target.w / 2,
    left = (w: number) => anchor - (align === 'start' ? 0 : align === 'end' ? w : w / 2),
    md = text.format === 'md',
    lineHeight = md && kind === 'note' ? 1.5 : 1.35;
  const rows: { top: number; h: number }[] = [];
  const chars: { r: number; x: number; w: number }[] = [];
  // Plain text wraps line by line exactly as `wrapPlainText` wraps the whole value.
  const parsed = md
      ? parseRichText(text.value)
      : text.value.split('\n').map((line): TextLine => ({ kind: 'p', runs: [{ text: line }] })),
    laid = layoutRichText(parsed, width, size, ADVANCE);
  let offset = 0,
    next = 0;
  for (const line of parsed) {
    const prefix = line.marker ? line.marker.length + 1 : 0,
      source = line.runs.map((run) => run.text).join(''),
      first = next,
      texts: string[] = [];
    for (; laid[next]?.line === line; next++) {
      rows.push({ top: 0, h: laid[next].size * lineHeight });
      texts.push(laid[next].runs.map((run) => run.text).join(''));
    }
    const indent = laid[first]?.indent ?? 0,
      glyph = source.length
        ? (richLineWidth(line, size, ADVANCE) - indent) / source.length
        : size * ADVANCE,
      // Centered and end-aligned rows lead with "marker "; start-aligned ones hang the marker.
      lead = align !== 'start' ? prefix : 0,
      starts = texts.map((row, k) =>
        align === 'start'
          ? anchor + laid[first + k].indent
          : left((row.length + (k ? 0 : lead)) * glyph) + (k ? 0 : lead) * glyph,
      );
    for (let c = 0; c + 1 < prefix && texts.length; c++)
      chars[offset + c] = {
        r: first,
        x: align === 'start' ? anchor + c * glyph : starts[0] - (lead - c) * glyph,
        w: glyph,
      };
    placeChars(source, texts).forEach((at, j) => {
      if (at)
        chars[offset + prefix + j] = {
          r: first + at[0],
          x: starts[at[0]] + at[1] * glyph,
          w: glyph,
        };
    });
    offset += prefix + source.length + 1;
  }
  const total = rows.reduce((sum, row) => sum + row.h, 0);
  let top =
    text.valign === 'top'
      ? pad
      : text.valign === 'bottom'
        ? target.h - pad - total
        : (target.h - total) / 2;
  for (const row of rows) {
    row.top = top;
    top += row.h;
  }
  const boxes = new Map<number, Box>();
  for (let i = start; i < start + mark.match!.length; i++) {
    const at = chars[i];
    if (!at) continue;
    const box = boxes.get(at.r);
    if (!box) boxes.set(at.r, { x: at.x, y: rows[at.r].top, w: at.w, h: rows[at.r].h });
    else {
      const right = Math.max(box.x + box.w, at.x + at.w);
      box.x = Math.min(box.x, at.x);
      box.w = right - box.x;
    }
  }
  return boxes.size ? [...boxes.values()] : whole;
}

export const markStroke = (mark: Item) => mark.style?.strokeWidth ?? 2.5;

/** Bounds of points, grown by `pad` on every side. */
function around(points: Point[], pad: number): Box {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y),
    x = Math.min(...xs) - pad,
    y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

const corners = (b: Box): Point[] => [
  { x: b.x, y: b.y },
  { x: b.x + b.w, y: b.y },
  { x: b.x + b.w, y: b.y + b.h },
  { x: b.x, y: b.y + b.h },
];

/** A hand-drawn loop around `box`, seeded by the mark id so every renderer draws the same one. */
function loop(box: Box, seed: string): Point[] {
  let state = 7;
  for (const char of seed) state = (state * 31 + char.charCodeAt(0)) % 2147483647;
  const random = () => (state = (state * 48271) % 2147483647) / 2147483647;
  const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 },
    rx = box.w * 0.6 + 6,
    ry = box.h * 0.6 + 6,
    start = random() * Math.PI * 2,
    wobble = random() * Math.PI * 2,
    tilt = (random() - 0.5) * 6,
    points: Point[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40,
      angle = start + t * Math.PI * 2 * 1.12,
      r = 1 + 0.035 * Math.sin(angle * 3 + wobble) + 0.06 * t - 0.03;
    points.push(
      rotatePoint(
        { x: center.x + Math.cos(angle) * rx * r, y: center.y + Math.sin(angle) * ry * r },
        center,
        tilt,
      ),
    );
  }
  return points;
}

/** Strokes and fills of a mark in frame coordinates. */
export function markShapes(mark: Item, rects: Box[]): MarkShape[] {
  const type = mark.mark ?? 'highlight',
    all = rects.flatMap(corners);
  if (type === 'underline')
    return rects.map((r) => ({
      fill: false,
      points: [
        { x: r.x, y: r.y + r.h * 0.88 },
        { x: r.x + r.w, y: r.y + r.h * 0.88 },
      ],
    }));
  if (type === 'box') {
    const points = corners(around(all, 4));
    return [{ fill: false, points: [...points, points[0]] }];
  }
  if (type === 'circle') return [{ fill: false, points: loop(around(all, 0), mark.id) }];
  return rects.map((r) => ({ fill: true, points: corners(r) }));
}

const frameCenter = (frame: MarkFrame) => ({ x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 });

/** Page bounds of what a mark draws, strokes included. */
export function markBounds(mark: Item, frame: MarkFrame, shapes: MarkShape[]): Box {
  const local = shapes.flatMap((shape) => shape.points);
  if (!local.length) return { x: frame.x, y: frame.y, w: 0, h: 0 };
  const page = local.map((p) =>
    rotatePoint({ x: frame.x + p.x, y: frame.y + p.y }, frameCenter(frame), frame.rotation),
  );
  return around(page, shapes.some((shape) => !shape.fill) ? markStroke(mark) / 2 : 0);
}

/** Whether a page point touches a visible stroke. A highlight is a fill and is never hit. */
export function markHit(
  mark: Item,
  frame: MarkFrame,
  shapes: MarkShape[],
  point: Point,
  tolerance: number,
): boolean {
  const p = rotatePoint(point, frameCenter(frame), -frame.rotation),
    local = { x: p.x - frame.x, y: p.y - frame.y },
    reach = tolerance + markStroke(mark) / 2;
  return shapes.some(
    (shape) =>
      !shape.fill &&
      shape.points.slice(1).some((q, i) => segmentDistance(local, shape.points[i], q) <= reach),
  );
}

/** A mark needs a target on its own page that is neither a mark nor a connector. */
function requireTarget(mark: Item, id: unknown, items: Item[]): void {
  const target = items.find((item) => item.id === id);
  if (typeof id !== 'string' || !target)
    throw new Error(`Mark ${mark.id} needs a target on its page; ${String(id)} does not exist.`);
  if (isOverlay(target) || target.kind === 'connector')
    throw new Error(`Mark ${mark.id} cannot target ${target.kind} ${target.id}.`);
}

/**
 * Check a new mark, or a `set` patch on one, against the items on its page. Geometry comes from
 * the target: a new mark stores x/y/w/h as 0, and a patch drops x, y, w, h, and rotation.
 */
export function checkMark(mark: Item, items: Item[], patch?: Partial<Item>): void {
  const fields = patch ?? mark;
  for (const key of ['x', 'y', 'w', 'h', 'rotation'] as const) delete fields[key];
  if (!patch) Object.assign(mark, { x: 0, y: 0, w: 0, h: 0 });
  if (!patch || Object.hasOwn(patch, 'target')) requireTarget(mark, fields.target, items);
}

/**
 * Remove the marks on `root` or its descendants from the page, so a removed target takes its
 * marks with it. Marks inside `root` leave with it anyway. Returns the inverse adds in undo order.
 */
export function dropMarks(page: Page, root: Item): Op[] {
  const gone = new Set<string>();
  const collect = (item: Item) => {
    gone.add(item.id);
    item.children?.forEach(collect);
  };
  collect(root);
  const inverse: Op[] = [];
  const walk = (list: Item[], parent?: string) => {
    for (let index = list.length - 1; index >= 0; index--) {
      const item = list[index];
      if (gone.has(item.id)) continue;
      if (item.children) walk(item.children, item.id);
      if (!isOverlay(item) || !gone.has(item.target as string)) continue;
      list.splice(index, 1);
      inverse.unshift({
        op: 'add',
        item: clone(item),
        page: page.id,
        ...(parent ? { parent } : {}),
        index,
      });
    }
  };
  walk(page.items);
  return inverse;
}
