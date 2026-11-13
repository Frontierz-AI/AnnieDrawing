import { layoutRichText, parseRichText, type TextRun } from '../core/richText';
import type { Item } from '../core/types';
import { esc, round } from '../stage/paint';

const runMarkup = (runs: TextRun[]) =>
  runs
    .map((run) =>
      run.bold || run.italic
        ? `<tspan${run.bold ? ' font-weight="700"' : ''}${run.italic ? ' font-style="italic"' : ''}>${esc(run.text)}</tspan>`
        : esc(run.text),
    )
    .join('');

/**
 * Rows of `md` text as `tspan`s, laid out by the same parser and wrapping rule the stage and the
 * size heuristic use. Each row is a `tspan` with absolute `x`/`y`; headings carry their own size.
 */
export function richTextRows(
  item: Item,
  size: number,
  padding: number,
  width: number,
  advance: number,
): string {
  const text = item.text!;
  const lineHeight = item.kind === 'note' ? 1.5 : 1.35;
  const rows = layoutRichText(parseRichText(text.value), width, size, advance);
  const total = rows.reduce((sum, row) => sum + row.size * lineHeight, 0);
  const align = text.align ?? (item.kind === 'text' ? 'start' : 'center');
  const x = align === 'start' ? padding : align === 'end' ? item.w - padding : item.w / 2;
  let top =
    text.valign === 'top'
      ? padding
      : text.valign === 'bottom'
        ? item.h - padding - total
        : (item.h - total) / 2;
  return rows
    .map((row) => {
      const y = round(top + row.size);
      top += row.size * lineHeight;
      const marker = row.first && row.line.marker ? esc(row.line.marker) : '';
      const heading = row.size !== size;
      const font = heading ? ` font-size="${round(row.size)}" font-weight="700"` : '';
      // Start-aligned lists keep the hanging indent; centered or end-aligned rows lead with the marker.
      if (align === 'start' && row.line.marker)
        return `${marker ? `<tspan x="${x}" y="${y}">${marker}</tspan>` : ''}<tspan x="${round(x + row.indent)}" y="${y}"${font}>${runMarkup(row.runs)}</tspan>`;
      const content = `${marker ? `${marker} ` : ''}${runMarkup(row.runs)}`;
      return content ? `<tspan x="${x}" y="${y}"${font}>${content}</tspan>` : '';
    })
    .join('');
}
