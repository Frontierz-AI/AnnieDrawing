import type { AnnieDoc, Item, Point } from '../core/types';

export interface Outline {
  points: Point[];
  closed: boolean;
}
export interface KindView {
  element: HTMLDivElement;
  shape: SVGSVGElement;
  text: HTMLDivElement;
  doc: AnnieDoc;
}
export interface SVGContext {
  doc: AnnieDoc;
  theme: 'light' | 'dark';
  color: (value: string) => string;
  escape: (value: unknown) => string;
}
export interface KindDef {
  kind: string;
  schema?: unknown;
  defaults?: Partial<Item>;
  outline?: (item: Item) => Outline | Outline[];
  /** Creates content once; optionally returns cleanup. The wrapper belongs to the stage. */
  mount?: (view: KindView) => void | (() => void);
  /** Updates custom content; changed contains transform, geometry, style, text, or content. */
  paint?: (view: KindView, item: Item, changed: Set<string>) => void;
  handles?: (item: Item) => { id: string; x: number; y: number; label?: string; cursor?: string }[];
  /** Handle points use unrotated local item coordinates. Return a draft patch. */
  dragHandle?: (
    item: Item,
    handleId: string,
    point: Point,
    modifiers: { shift: boolean; alt: boolean },
  ) => Partial<Item>;
  toSVG?: (item: Item, context: SVGContext) => SVGElement | string;
  summarize?: (item: Item) => string;
}
const registry = new Map<string, KindDef>();
const builtins = [
  'rect',
  'ellipse',
  'diamond',
  'line',
  'connector',
  'path',
  'text',
  'note',
  'image',
  'video',
  'link',
  'group',
  'html',
];
for (const kind of builtins) registry.set(kind, { kind });

/** Declare a reusable kind; registration is scoped to each board's options. */
export function defineKind<T extends KindDef>(definition: T): T {
  if (!/^[a-z][a-z0-9_-]*$/i.test(definition.kind))
    throw new Error(
      'Kind names must begin with a letter and contain only letters, digits, _ or -.',
    );
  return definition;
}
/** Register a default kind globally for boards created afterwards. */
export function registerKind(definition: KindDef): () => void {
  defineKind(definition);
  const previous = registry.get(definition.kind);
  registry.set(definition.kind, definition);
  return () => {
    if (previous) registry.set(definition.kind, previous);
    else registry.delete(definition.kind);
  };
}
export function getKind(kind: string): KindDef | undefined {
  return registry.get(kind);
}
export function getKinds(): KindDef[] {
  return [...registry.values()];
}
export function createKindRegistry(extra: KindDef[] = []): Map<string, KindDef> {
  return new Map([...getKinds(), ...extra.map(defineKind)].map((kind) => [kind.kind, kind]));
}
