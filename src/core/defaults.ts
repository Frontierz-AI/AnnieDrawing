import type { AnnieDoc, Item, NewItem, Style } from './types';
import { itemId } from './ids';
export const DEFAULT_STYLE: Required<Style> = {
  stroke: 'ink',
  strokeWidth: 2,
  dash: 'solid',
  fill: 'none',
  fillMode: 'solid',
  corner: 12,
  opacity: 1,
};
export const CARD_CORNER = 16;
export const DEFAULT_SIZES: Record<string, [number, number]> = {
  rect: [180, 110],
  ellipse: [180, 110],
  diamond: [160, 140],
  line: [180, 0],
  connector: [0, 0],
  path: [0, 0],
  text: [200, 48],
  note: [200, 180],
  image: [240, 180],
  video: [480, 270],
  link: [280, 300],
  group: [0, 0],
  html: [240, 160],
};
export function clone<T>(value: T): T {
  return structuredClone(value);
}
export function defaultDoc(): AnnieDoc {
  return {
    format: 'anniedrawing',
    version: 2,
    meta: { title: 'Untitled board' },
    pages: [{ id: 'p_main', name: 'Page 1', background: 'paper', items: [] }],
    media: {},
  };
}
export function normalizeItem(
  input: NewItem,
  kindDefaults: Record<string, Partial<Item>> = {},
): Item {
  const custom = kindDefaults[input.kind];
  if (custom)
    input = {
      ...clone(custom),
      ...input,
      ...(custom.style ? { style: { ...clone(custom.style), ...input.style } } : {}),
    };
  const size = DEFAULT_SIZES[input.kind] ?? [180, 110];
  const result = {
    ...clone(input),
    id: input.id ?? itemId(),
    x: input.x ?? 0,
    y: input.y ?? 0,
    w: input.w ?? size[0],
    h: input.h ?? size[1],
  } as Item;
  if (input.children)
    result.children = input.children.map((child) => normalizeItem(child, kindDefaults));
  return result;
}
export function minimalItem(item: Item, kindDefaults: Record<string, Partial<Item>> = {}): Item {
  const defaults = {
    ...DEFAULT_STYLE,
    ...(item.kind === 'note' ? { fill: 'moss', strokeWidth: 0, corner: CARD_CORNER } : {}),
    ...kindDefaults[item.kind]?.style,
  };
  const next = clone(item);
  if (next.rotation === 0) delete next.rotation;
  if (next.locked === false) delete next.locked;
  if (next.hidden === false) delete next.hidden;
  if (next.style) {
    for (const key of Object.keys(next.style) as (keyof Style)[])
      if (next.style[key] === defaults[key]) delete next.style[key];
    if (!Object.keys(next.style).length) delete next.style;
  }
  if (next.children) {
    next.children = next.children.map((child) => minimalItem(child, kindDefaults));
    if (!next.children.length) delete next.children;
  }
  if (next.kind === 'connector') {
    delete (next as Partial<Item>).x;
    delete (next as Partial<Item>).y;
    delete (next as Partial<Item>).w;
    delete (next as Partial<Item>).h;
  }
  return next;
}
