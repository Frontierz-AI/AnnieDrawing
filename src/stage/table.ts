import { layoutTable, TABLE, tableRows, type TableLayout } from '../core/table';
import type { Item } from '../core/types';
import type { KindDef } from '../kinds/registry';
import { color, esc, fontFamily, labelColor, round } from './paint';

/** Background, header band, inner rules, and border. Shared by the stage and SVG export. */
function grid(item: Item, layout: TableLayout, theme: 'light' | 'dark'): string {
  const style = item.style ?? {},
    stroke = esc(color(style.stroke ?? 'ink', theme)),
    { w, h, x, y } = layout,
    r = Math.max(0, Math.min(style.corner ?? 8, w / 2, h / 2)),
    dash = style.dash === 'dashed' ? '8 6' : style.dash === 'dotted' ? '1 6' : '';
  const rules = [
    ...x.slice(1, -1).map((at) => `M${round(at)},0V${round(h)}`),
    ...y.slice(1, -1).map((at) => `M0,${round(at)}H${round(w)}`),
  ].join('');
  return `<rect width="${round(w)}" height="${round(h)}" rx="${r}" fill="${esc(color(style.fill ?? 'paper', theme))}"${style.fillMode === 'tint' ? ' fill-opacity="0.22"' : ''}/>${item.header ? `<path d="M0,${round(y[1])}V${r}Q0,0 ${r},0H${round(w - r)}Q${round(w)},0 ${round(w)},${r}V${round(y[1])}Z" fill="${stroke}" fill-opacity="0.1"/>` : ''}${rules ? `<path d="${rules}" fill="none" stroke="${stroke}" stroke-opacity="0.45" stroke-width="1"/>` : ''}<rect width="${round(w)}" height="${round(h)}" rx="${r}" fill="none" stroke="${stroke}" stroke-width="${style.strokeWidth ?? 1.5}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
}

const painted = new WeakMap<HTMLElement, string>();
const px = (value: number) => `${value}px`;

/** Built-in `table`: plain-text cells as DOM nodes over an SVG grid, and the same grid in exports. */
export const tableKind: KindDef = {
  kind: 'table',
  paint(view, item) {
    const theme = view.theme ?? 'light',
      key = JSON.stringify([item.rows, item.header, item.w, item.h, item.style, theme]);
    let box = view.element.querySelector<HTMLElement>(':scope > .annie-table');
    // An open cell editor keeps its node; the next paint after it closes catches up.
    if (
      (box && painted.get(view.element) === key) ||
      box?.querySelector('[contenteditable="plaintext-only"]')
    )
      return;
    painted.set(view.element, key);
    const layout = layoutTable(item);
    view.shape.innerHTML = grid(item, layout, theme);
    if (!box) {
      box = document.createElement('div');
      box.className = 'annie-table';
      view.element.append(box);
    }
    box.style.color = labelColor(item, theme);
    box.style.fontFamily = fontFamily();
    box.replaceChildren(
      ...layout.cells.flatMap((row, r) =>
        row.map((text, c) => {
          const cell = document.createElement('div');
          cell.className = item.header && !r ? 'annie-cell annie-cell-head' : 'annie-cell';
          cell.dataset.adCell = `${r},${c}`;
          Object.assign(cell.style, {
            left: px(layout.x[c]),
            top: px(layout.y[r]),
            width: px(layout.cols[c]),
            height: px(layout.rows[r]),
            padding: `${TABLE.padY}px ${TABLE.padX}px`,
          });
          cell.textContent = text;
          return cell;
        }),
      ),
    );
  },
  toSVG(item, { theme }) {
    const layout = layoutTable(item),
      { font, line, padX, padY } = TABLE;
    const cells = layout.lines.flatMap((row, r) =>
      row.map((lines, c) => {
        if (!lines.some(Boolean)) return '';
        const x = round(layout.x[c] + padX);
        return `<text x="${x}" y="${round(layout.y[r] + padY + font)}"${item.header && !r ? ' font-weight="700"' : ''}>${lines.map((text, i) => `<tspan x="${x}" dy="${i ? round(font * line) : 0}">${esc(text) || '&#160;'}</tspan>`).join('')}</text>`;
      }),
    );
    return `${grid(item, layout, theme)}<g font-family="${esc(fontFamily())}" font-size="${font}" fill="${esc(labelColor(item, theme))}">${cells.join('')}</g>`;
  },
  summarize(item) {
    const rows = tableRows(item);
    return `Table, ${rows[0].length} columns, ${rows.length} rows: ${rows[0].join(', ')}`;
  },
};
