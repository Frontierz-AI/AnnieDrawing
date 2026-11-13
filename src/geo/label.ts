import { TEXT_ADVANCE, textFontSize, wrapPlainText } from '../core/textFit';
import type { Box, ItemText, Point } from '../core/types';
import { distance } from './vec';

/** Connector labels wrap at this width, padding included, as on the stage. */
const LABEL_WIDTH = 240;

/** Lines of a connector label as the headless box wraps them. */
export const labelLines = (text: ItemText) =>
  wrapPlainText(text.value, LABEL_WIDTH - 16 - textFontSize(text) / 2, textFontSize(text));

/**
 * Headless size of a connector label box: 8 px side padding, 3 px top and bottom, 1.25 line
 * height. The glyph estimate is generous, and half an em more holds short labels with wide
 * capitals, so the rendered label fits inside it without breaking a word.
 */
export function labelSize(text: ItemText): { w: number; h: number } {
  const size = textFontSize(text),
    room = 16 + size / 2,
    lines = labelLines(text);
  return {
    w: Math.ceil(
      Math.min(
        LABEL_WIDTH,
        Math.max(...lines.map((line) => line.length)) * size * TEXT_ADVANCE + room,
      ),
    ),
    h: Math.ceil(lines.length * size * 1.25 + 6),
  };
}

/**
 * Center a label box on the longest segment of `points` where `blocked` counts nothing under it,
 * sliding along each segment from its middle. Falls back to the least blocked spot.
 */
export function placeLabel(
  points: Point[],
  size: { w: number; h: number },
  blocked: (box: Box) => number,
): Box {
  const at = (point: Point): Box => ({
    x: point.x - size.w / 2,
    y: point.y - size.h / 2,
    ...size,
  });
  const length = (i: number) => distance(points[i], points[i + 1]);
  const order = points
    .slice(1)
    .map((_, i) => i)
    .sort((a, b) => length(b) - length(a) || a - b);
  let best = at(points[0] ?? { x: 0, y: 0 }),
    least = Infinity;
  for (const i of order) {
    const a = points[i],
      b = points[i + 1],
      steps = Math.min(8, Math.floor(length(i) / 24));
    for (let k = 0; k <= steps * 2; k++) {
      const t = 0.5 + ((k % 2 ? 1 : -1) * Math.ceil(k / 2)) / (steps * 2 + 2);
      const box = at({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      const count = blocked(box);
      if (!count) return box;
      if (count < least) [best, least] = [box, count];
    }
  }
  return best;
}
