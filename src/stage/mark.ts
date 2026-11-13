import type { Box, Item } from '../core/types';
import { markStroke, type MarkShape } from '../core/mark';
import { visibleText } from '../core/richText';
import type { MarkGeometry } from '../geo/box';
import { color, esc, pathFromPoints } from './paint';

/** Highlights multiply in the light theme, so the text above stays as dark as it was. */
export const markBlend = (mark: Item, theme: 'light' | 'dark') =>
  (mark.mark ?? 'highlight') === 'highlight' && theme === 'light' ? 'multiply' : '';

/** SVG for a mark in frame coordinates; the stage and the exporter share it. */
export function markMarkup(mark: Item, shapes: MarkShape[], theme: 'light' | 'dark'): string {
  const fill = color(mark.style?.fill ?? mark.style?.stroke ?? 'amber', theme),
    stroke = color(mark.style?.stroke ?? 'coral', theme),
    dash = mark.style?.dash === 'dashed' ? '8 6' : mark.style?.dash === 'dotted' ? '1 6' : '';
  return shapes
    .map((shape) =>
      shape.fill
        ? `<path d="${pathFromPoints(shape.points, true)}" fill="${esc(fill)}" fill-opacity="${theme === 'light' ? 0.7 : 0.38}"/>`
        : `<path d="${pathFromPoints(shape.points)}" fill="none" stroke="${esc(stroke)}" stroke-width="${markStroke(mark)}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`,
    )
    .join('');
}

/** What a stage view needs to draw a mark. */
interface MarkView {
  element: HTMLElement;
  shape: SVGSVGElement;
  text: HTMLElement;
}
const painted = new WeakMap<HTMLElement, string>();

/**
 * Draw a mark in its target's frame. Returns the transform and opacity it wrote, or nothing when
 * nothing changed. A mark without a target draws nothing.
 */
export function paintMark(
  view: MarkView,
  mark: Item,
  geometry: MarkGeometry | undefined,
  theme: 'light' | 'dark',
  fresh: boolean,
): { transform: string; opacity: string } | undefined {
  const frame = geometry?.frame,
    transform = frame
      ? `translate3d(${frame.x}px,${frame.y}px,0) rotate(${frame.rotation}deg)`
      : '',
    markup = geometry ? markMarkup(mark, geometry.shapes, theme) : '',
    opacity = String(mark.style?.opacity ?? 1),
    label = `Mark ${mark.mark ?? 'highlight'} on ${String(mark.target)}${mark.match ? `: “${mark.match}”` : ''}`,
    key = JSON.stringify([transform, frame?.w, frame?.h, markup, opacity, label, theme]);
  if (!fresh && painted.get(view.element) === key) return;
  painted.set(view.element, key);
  const { element, shape } = view;
  element.style.transform = transform;
  element.style.width = `${frame?.w ?? 0}px`;
  element.style.height = `${frame?.h ?? 0}px`;
  element.style.opacity = opacity;
  element.style.mixBlendMode = markBlend(mark, theme);
  element.setAttribute('aria-label', label);
  shape.setAttribute('width', String(frame?.w ?? 0));
  shape.setAttribute('height', String(frame?.h ?? 0));
  shape.innerHTML = markup;
  view.text.style.display = 'none';
  return { transform, opacity };
}

/**
 * Phrase boxes measured from the target's rendered label, in its frame (unrotated, unscaled).
 * Plain labels are one text node; `md` labels are `div.annie-line` rows whose marker span is
 * followed by a space in the visible text. `null` when the phrase is not in the text, so the
 * mark covers the whole item; undefined when the label is not laid out yet.
 */
export function measurePhrase(
  view: MarkView,
  target: Item,
  match: string,
): Box[] | null | undefined {
  const label = view.text;
  if (!target.text || label.isContentEditable || !target.w) return;
  const start = visibleText(target.text).indexOf(match);
  if (start < 0) return null;
  const pieces: { node: Text; at: number }[] = [];
  let at = 0;
  const lines = label.querySelectorAll(':scope > .annie-line');
  if (!lines.length && label.firstChild?.nodeType === 3)
    pieces.push({ node: label.firstChild as Text, at });
  lines.forEach((line, index) => {
    if (index) at++;
    const walker = label.ownerDocument.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (
      let node = walker.nextNode() as Text | null;
      node;
      node = walker.nextNode() as Text | null
    ) {
      pieces.push({ node, at });
      at += node.data.length + (node.parentElement?.classList.contains('annie-marker') ? 1 : 0);
    }
  });
  const end = start + match.length;
  // Pieces are in reading order: the last one at or before an offset holds it.
  const first = pieces.filter((piece) => piece.at <= start).at(-1),
    last = pieces.filter((piece) => piece.at < end).at(-1);
  if (!first || !last) return null;
  const range = label.ownerDocument.createRange();
  range.setStart(first.node, Math.min(start - first.at, first.node.length));
  range.setEnd(last.node, Math.min(end - last.at, last.node.length));
  // Measure the label unrotated; camera zoom and the arrival scale divide out below.
  const element = view.element,
    transform = element.style.transform;
  if (target.rotation) element.style.transform = transform.replace(/rotate\([^)]*\)/, '');
  const frame = element.getBoundingClientRect(),
    client = [...range.getClientRects()];
  element.style.transform = transform;
  if (!frame.width) return;
  // Inline runs of one line come back as separate rects; join the ones that share a line.
  const scale = target.w / frame.width,
    rows: { l: number; t: number; r: number; b: number }[] = [];
  for (const { left: l, top: t, right: r, bottom: b, width } of client.sort(
    (a, z) => a.top - z.top,
  )) {
    const row = rows.at(-1);
    if (width < 0.5) continue;
    if (row && t < (row.t + row.b) / 2)
      Object.assign(row, { l: Math.min(row.l, l), r: Math.max(row.r, r), b: Math.max(row.b, b) });
    else rows.push({ l, t, r, b });
  }
  return rows.length
    ? rows.map(({ l, t, r, b }) => ({
        x: (l - frame.left) * scale,
        y: (t - frame.top) * scale,
        w: (r - l) * scale,
        h: (b - t) * scale,
      }))
    : undefined;
}
