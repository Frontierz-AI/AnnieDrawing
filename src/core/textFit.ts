import type { Item, ItemText } from './types';

/** Shapes whose label is laid out inside the box. */
export const LABEL_BOX_KINDS = new Set(['rect', 'ellipse', 'diamond', 'note', 'text']);

/** Average glyph width as a fraction of font size. Generous for the default hand stack. */
const TEXT_ADVANCE = 0.62;
/** Comfortable wrap width inside the padding. Standalone text uses the 600 default. */
const MAX_INNER = 320;
const TEXT_MAX_INNER = 600;
const FONT_PX = { s: 14, m: 18, l: 26, xl: 36 } as const;

export function textFontSize(text?: ItemText): number {
  return typeof text?.size === 'number' ? text.size : FONT_PX[text?.size ?? 'm'];
}

export function wrapPlainText(
  value: string,
  width: number,
  fontPx: number,
  advance = TEXT_ADVANCE,
): string[] {
  const maxChars = Math.max(1, Math.floor(width / (fontPx * advance)));
  const result: string[] = [];
  for (const paragraph of value.split('\n')) {
    if (!paragraph) {
      result.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (line && line.length + word.length + 1 > maxChars) {
        result.push(line);
        line = '';
      }
      let remaining = word;
      while (remaining.length > maxChars) {
        if (line) {
          result.push(line);
          line = '';
        }
        result.push(remaining.slice(0, maxChars));
        remaining = remaining.slice(maxChars);
      }
      line += `${line ? ' ' : ''}${remaining}`;
    }
    result.push(line);
  }
  return result;
}

function boxMetrics(kind: string): { pad: number; innerRatio: number; lineHeight: number } {
  return {
    pad: kind === 'note' ? 20 : kind === 'text' ? 0 : 12,
    innerRatio: kind === 'diamond' ? 0.6 : kind === 'ellipse' ? 0.7 : 1,
    lineHeight: kind === 'note' ? 1.5 : 1.35,
  };
}

function innerSize(kind: string, w: number, h: number): { w: number; h: number } {
  const { pad, innerRatio } = boxMetrics(kind);
  return innerRatio === 1
    ? { w: Math.max(0, w - pad * 2), h: Math.max(0, h - pad * 2) }
    : { w: w * innerRatio, h: h * innerRatio };
}

function boxFromInner(kind: string, innerW: number, innerH: number): { w: number; h: number } {
  const { pad, innerRatio } = boxMetrics(kind);
  return innerRatio === 1
    ? { w: innerW + pad * 2, h: innerH + pad * 2 }
    : { w: innerW / innerRatio, h: innerH / innerRatio };
}

/** Minimum box that can hold `text` for a labeled shape, wrapping long lines. */
export function labeledBoxSize(
  kind: string,
  text: ItemText,
  w = 0,
  h = 0,
): { w: number; h: number } {
  const fontPx = textFontSize(text);
  const { lineHeight } = boxMetrics(kind);
  const value = text.value;
  const unconstrained = Math.max(
    1,
    ...value.split('\n').map((line) => line.length * fontPx * TEXT_ADVANCE),
  );
  const provided = innerSize(kind, w, h);
  const cap = kind === 'text' ? TEXT_MAX_INNER : MAX_INNER;
  const wrapInner = Math.min(unconstrained, Math.max(cap, provided.w));
  const lines = wrapPlainText(value, wrapInner, fontPx);
  const innerH = Math.max(fontPx * lineHeight, lines.length * fontPx * lineHeight);
  return boxFromInner(kind, wrapInner, innerH);
}

/** Grow a labeled box so stored w/h can hold its text. Never shrinks. */
export function growLabeledBox(item: Item): void {
  if (!LABEL_BOX_KINDS.has(item.kind) || !item.text?.value.trim()) return;
  const fit = labeledBoxSize(item.kind, item.text, item.w, item.h);
  item.w = Math.max(item.w, Math.ceil(fit.w));
  item.h = Math.max(item.h, Math.ceil(fit.h));
}

export function growAgentLabeledTree(item: Item): void {
  growLabeledBox(item);
  item.children?.forEach(growAgentLabeledTree);
}
