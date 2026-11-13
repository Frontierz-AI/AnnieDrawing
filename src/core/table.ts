import { wrapPlainText } from './textFit';
import type { Item, NewItem } from './types';

/** Cell font size, line height factor, padding, and column width bounds, all in page pixels. */
export const TABLE = { font: 16, line: 1.35, padX: 10, padY: 6, maxInner: 240, minInner: 24 };
/** Glyph advance per font size, as for labels. The bold header row gets a wider one. */
const ADVANCE = 0.62,
  HEAD_ADVANCE = 0.68;

export interface TableLayout {
  /** Column widths and row heights. */
  cols: number[];
  rows: number[];
  /** Column and row edges, relative to the item: `x[c]` to `x[c + 1]`, `y[r]` to `y[r + 1]`. */
  x: number[];
  y: number[];
  w: number;
  h: number;
  /** Wrapped lines per cell, `lines[row][column]`. */
  lines: string[][][];
  cells: string[][];
}

/** Rows padded to the longest row with empty cells; missing or non-string cells read as empty. */
export function tableRows(item: Pick<Item, 'rows'>): string[][] {
  const rows = Array.isArray(item.rows) && item.rows.length ? item.rows : [[]];
  const width = Math.max(1, ...rows.map((row) => (Array.isArray(row) ? row.length : 0)));
  return rows.map((row) =>
    Array.from({ length: width }, (_, c) => (typeof row?.[c] === 'string' ? row[c] : '')),
  );
}

const sum = (list: number[]) => list.reduce((total, value) => total + value, 0);
const edges = (list: number[]) => list.reduce((at, size) => [...at, at.at(-1)! + size], [0]);
/** Resize `sizes` to sum to `target` in proportion to each size, none below `min`. */
const scaleTo = (sizes: number[], target: number, min = 0) => {
  const total = sum(sizes),
    low = new Set<number>();
  if (!(target > 0) || target === total) return sizes;
  if (target > total) return sizes.map((size) => size + ((target - total) * size) / total);
  for (;;) {
    const scale = (target - low.size * min) / sum(sizes.filter((_, i) => !low.has(i))),
      before = low.size;
    sizes.forEach((size, i) => size * scale < min && low.add(i));
    if (low.size === before || low.size === sizes.length)
      return sizes.map((size, i) => (low.has(i) ? min : size * scale));
  }
};

/**
 * Column widths come from the longest line in each column, capped at `TABLE.maxInner`, and row
 * heights from the wrapped lines. A larger `w` or `h` is spread over columns or rows in proportion;
 * a smaller `w` narrows columns proportionally down to a minimum and wraps more. The height never
 * drops below what the wrapped text needs, so a table never clips its text. Pass 0 for natural size.
 */
export function layoutTable(item: Item, w = item.w, h = item.h): TableLayout {
  const cells = tableRows(item),
    header = item.header === true,
    { font, line, padX, padY, maxInner, minInner } = TABLE;
  const advance = (r: number) => (header && !r ? HEAD_ADVANCE : ADVANCE);
  const natural = cells[0].map(
    (_, c) =>
      Math.ceil(
        Math.min(
          maxInner,
          Math.max(
            minInner,
            ...cells.map(
              (row, r) =>
                Math.max(...row[c].split('\n').map((text) => text.length)) * font * advance(r),
            ),
          ),
        ),
      ) +
      padX * 2,
  );
  const cols = scaleTo(natural, w, minInner + padX * 2);
  const lines = cells.map((row, r) =>
    row.map((text, c) => wrapPlainText(text, cols[c] - padX * 2, font, advance(r))),
  );
  const needed = lines.map(
    (row) => Math.ceil(Math.max(...row.map((cell) => cell.length)) * font * line) + padY * 2,
  );
  const rows = scaleTo(needed, Math.max(h, sum(needed)));
  return { cols, rows, x: edges(cols), y: edges(rows), w: sum(cols), h: sum(rows), lines, cells };
}

const fits = (item: Item) => {
  const natural = layoutTable(item, 0, 0);
  return { w: item.w === natural.w, h: item.h === layoutTable(item, item.w, 0).h };
};

/**
 * Store padded rows and a size that holds the text. An `auto` side takes the natural size; `grow`
 * widens to the natural width. Otherwise a side keeps its value unless the text needs more.
 */
export function fitTable(item: Item, autoW: boolean, autoH: boolean, grow = false): void {
  item.rows = tableRows(item);
  const natural = layoutTable(item, 0, 0).w;
  const w = autoW ? natural : grow ? Math.max(item.w, natural) : item.w;
  item.w = Math.ceil(Math.max(w, layoutTable(item, w, 0).w) - 1e-6);
  const h = layoutTable(item, item.w, 0).h;
  item.h = autoH ? h : Math.max(item.h, h);
}

/**
 * Fit a table after a `set`. A side that matched its natural size before the edit follows the text;
 * a side the patch sets, or a person resized earlier, only grows. Agent edits to rows also widen.
 */
export function refitTable(previous: Item, next: Item, patch: object, agent: boolean): void {
  const was = fits(previous),
    has = (key: string) => Object.hasOwn(patch, key);
  fitTable(next, was.w && !has('w'), was.h && !has('h'), agent && has('rows'));
}

/** Fit new tables in an added tree. A side the operation omitted takes the natural size. */
export function fitNewTables(item: Item, sent: NewItem, grow: boolean): void {
  if (item.kind === 'table') {
    if (!Array.isArray(sent.rows))
      throw new Error(`Table ${item.id} needs rows: an array of rows of cell strings.`);
    fitTable(item, sent.w === undefined, sent.h === undefined, grow);
  }
  item.children?.forEach((child, i) => fitNewTables(child, sent.children?.[i] ?? child, grow));
}

/** Turn a `cells` patch (`'row,column'` keys, zero-based, header row included) into `rows`. */
export function patchCells(item: Item, patch: Record<string, unknown>): void {
  const cells = patch.cells as Record<string, string>;
  delete patch.cells;
  if (item.kind !== 'table') throw new Error(`cells applies only to table items (${item.id}).`);
  const rows = tableRows({ rows: (patch.rows ?? item.rows) as string[][] });
  for (const [key, value] of Object.entries(cells)) {
    const [r, c] = /^\d+,\d+$/.test(key) ? key.split(',').map(Number) : [-1, -1];
    if (!(r >= 0 && c >= 0 && r < rows.length && c < rows[0].length))
      throw new Error(
        `Cell ${key} is outside table ${item.id} (${rows.length} rows x ${rows[0].length} columns; keys are "row,column" from 0).`,
      );
    rows[r][c] = value;
  }
  patch.rows = rows;
}

/** Cell under a page point, clamped to the table. */
export function cellAt(item: Item, point: { x: number; y: number }): [number, number] {
  const turn = (-(item.rotation ?? 0) * Math.PI) / 180,
    cx = item.x + item.w / 2,
    cy = item.y + item.h / 2,
    dx = point.x - cx,
    dy = point.y - cy;
  const x = cx + dx * Math.cos(turn) - dy * Math.sin(turn) - item.x,
    y = cy + dx * Math.sin(turn) + dy * Math.cos(turn) - item.y;
  const layout = layoutTable(item);
  const find = (at: number[], value: number) => {
    let index = 0;
    while (index < at.length - 2 && value >= at[index + 1]) index++;
    return index;
  };
  return [find(layout.y, y), find(layout.x, x)];
}

/** `3x2 header "A" "B" "C"`: columns x rows, then the header (or first) row, quoted. */
export function tableSummary(item: Item, quote: (value: string) => string): string {
  const rows = tableRows(item),
    first = rows[0].slice(0, 8).map(quote).join(' ');
  return ` ${rows[0].length}x${rows.length} ${item.header ? 'header' : 'first row'} ${first}${rows[0].length > 8 ? ` +${rows[0].length - 8} more` : ''}`;
}
