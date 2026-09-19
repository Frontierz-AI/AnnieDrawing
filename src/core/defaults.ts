import type { AnnieDoc, Endpoint, EndpointInput, Item, NewItem, Style } from './types';
import { KIND_CATALOG } from './catalog';
import { itemId } from './ids';
export const KIND_ALIASES: Record<string, string> = {
  rectangle: 'rect',
  arrow: 'connector',
};
export const COLOR_ALIASES: Record<string, string> = {
  black: 'ink',
  grey: 'slate',
  gray: 'slate',
  blue: 'sky',
  'light-blue': 'sky',
  green: 'teal',
  'light-green': 'moss',
  red: 'rose',
  'light-red': 'rose',
  orange: 'coral',
  yellow: 'amber',
  violet: 'violet',
  'light-violet': 'violet',
};
export function storedKind(kind: string): string {
  return KIND_ALIASES[kind] ?? kind;
}
export function storedColor(value?: string): string | undefined {
  if (value === undefined) return undefined;
  return COLOR_ALIASES[value] ?? value;
}
export function storedEndpoint(value?: EndpointInput): Endpoint | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return { item: value, side: 'auto' };
  return value;
}
export function aliasStyle(style?: Style): Style | undefined {
  if (!style) return style;
  const stroke = storedColor(style.stroke),
    fill = storedColor(style.fill);
  if (stroke === style.stroke && fill === style.fill) return style;
  return {
    ...style,
    ...(stroke !== undefined ? { stroke } : {}),
    ...(fill !== undefined ? { fill } : {}),
  };
}
export const CARD_CORNER = 12;
export const DEFAULT_STYLE: Required<Style> = {
  stroke: 'ink',
  strokeWidth: 2,
  dash: 'solid',
  fill: 'none',
  fillMode: 'solid',
  corner: CARD_CORNER,
  opacity: 1,
};
export const DEFAULT_SIZES: Record<string, [number, number]> = Object.fromEntries(
  KIND_CATALOG.map((entry) => [entry.kind, [entry.w, entry.h]]),
);
export function clone<T>(value: T): T {
  return structuredClone(value);
}
export function sizeOf(kind: string): [number, number] {
  return DEFAULT_SIZES[kind] ?? [180, 110];
}
export function kindDefaultsFrom(
  kinds?: { kind: string; defaults?: Partial<Item> }[],
): Record<string, Partial<Item>> {
  return Object.fromEntries(
    (kinds ?? []).filter((kind) => kind.defaults).map((kind) => [kind.kind, kind.defaults!]),
  );
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
  const originalKind = input.kind,
    kind = storedKind(originalKind);
  const custom = kindDefaults[kind] ?? kindDefaults[originalKind];
  input = { ...input, kind };
  if (custom)
    input = {
      ...clone(custom),
      ...input,
      ...(custom.style ? { style: { ...clone(custom.style), ...input.style } } : {}),
    };
  const size = sizeOf(kind);
  const result = {
    ...clone(input),
    id: input.id ?? itemId(),
    kind,
    x: input.x ?? 0,
    y: input.y ?? 0,
    w: input.w ?? size[0],
    h: input.h ?? size[1],
  } as Item;
  const from = storedEndpoint(input.from),
    to = storedEndpoint(input.to),
    style = aliasStyle(input.style);
  if (from) result.from = from;
  else delete result.from;
  if (to) result.to = to;
  else delete result.to;
  if (style) result.style = style;
  else delete result.style;
  if (originalKind === 'arrow') {
    if (result.heads?.end === undefined) result.heads = { ...result.heads, end: 'arrow' };
    if (result.route === undefined) result.route = 'elbow';
  }
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
