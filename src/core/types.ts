import type { ReadonlySignal } from '@preact/signals-core';
import type { KindCatalogSnapshot } from './catalog';
export type Point = {
  x: number;
  y: number;
};
export type Box = Point & {
  w: number;
  h: number;
};
export type Color = string;
export type Outline = {
  points: Point[];
  closed: boolean;
};
export type ItemKind =
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'line'
  | 'connector'
  | 'path'
  | 'text'
  | 'note'
  | 'image'
  | 'video'
  | 'link'
  | 'group'
  | 'html'
  | (string & {});
export interface Style {
  stroke?: Color;
  strokeWidth?: number;
  dash?: 'solid' | 'dashed' | 'dotted';
  fill?: Color;
  fillMode?: 'solid' | 'tint' | 'hatch';
  corner?: number;
  opacity?: number;
}
export interface ItemText {
  value: string;
  align?: 'start' | 'center' | 'end';
  valign?: 'top' | 'middle' | 'bottom';
  size?: 's' | 'm' | 'l' | 'xl' | number;
  font?: 'sans' | 'serif' | 'mono' | 'hand';
}
export type Endpoint =
  | {
      item: string;
      side?: 'auto' | 'top' | 'right' | 'bottom' | 'left';
      anchor?: [number, number];
    }
  | Point;
/** Custom kinds may store extra fields; mutating a copy returned by get/query/read does not edit the document. */
export interface Item {
  id: string;
  kind: ItemKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  style?: Style;
  text?: ItemText;
  locked?: boolean;
  hidden?: boolean;
  name?: string;
  data?: Record<string, unknown>;
  children?: Item[];
  points?: [number, number, number?][];
  from?: Endpoint;
  to?: Endpoint;
  route?: 'straight' | 'elbow' | 'curve';
  heads?: {
    start?: 'none' | 'arrow' | 'dot';
    end?: 'none' | 'arrow' | 'dot';
  };
  waypoints?: [number, number][];
  closed?: boolean;
  autoWidth?: boolean;
  media?: string;
  crop?: Box;
  href?: string;
  description?: string;
  html?: string;
  mount?: string;
  [key: string]: unknown;
}
export type NewItem = {
  [K in keyof Item as K extends 'children' | 'kind' ? never : K]?: Item[K];
} & {
  kind: ItemKind;
  children?: NewItem[];
};
export interface Page {
  id: string;
  name: string;
  background?: Color;
  items: Item[];
}
export interface Media {
  mime: string;
  w: number;
  h: number;
  src: string;
}
export interface AnnieDoc {
  format: 'anniedrawing';
  version: 2;
  meta: {
    title: string;
    modified?: string;
    [key: string]: unknown;
  };
  pages: Page[];
  media: Record<string, Media>;
}
export interface Placement {
  rightOf?: string;
  leftOf?: string;
  above?: string;
  below?: string;
  inside?: string;
  near?: string;
  gap?: number;
  align?: 'start' | 'middle' | 'end';
}
export type Op =
  | {
      op: 'add';
      item: NewItem;
      page?: string;
      parent?: string;
      index?: number;
      place?: Placement;
    }
  | {
      op: 'set';
      id: string;
      patch: Partial<Item>;
    }
  | {
      op: 'remove';
      id: string;
    }
  | {
      op: 'order';
      id: string;
      to: 'front' | 'back' | 'forward' | 'backward' | number;
    }
  | {
      op: 'reparent';
      id: string;
      parent: string | null;
      index?: number;
    }
  | {
      op: 'page.add';
      page: Partial<Page> & {
        name: string;
      };
      index?: number;
    }
  | {
      op: 'page.set';
      id: string;
      patch: Partial<Omit<Page, 'id' | 'items'>>;
    }
  | {
      op: 'page.remove';
      id: string;
    }
  | {
      op: 'meta.set';
      patch: Partial<AnnieDoc['meta']>;
    }
  | {
      op: 'media.set';
      id: string;
      media: Media;
    }
  | {
      op: 'media.remove';
      id: string;
    };
export interface ApplyOptions {
  /** Provenance, not auth. Default in createDoc is `api`. Non-`user` origins sanitize HTML and use LIMITS.maxBatch. */
  origin?: string;
  label?: string;
  dryRun?: boolean;
  merge?: boolean;
  agentName?: string;
}
export interface ApplyResult {
  ok: boolean;
  created: string[];
  errors: {
    index: number;
    code: string;
    message: string;
  }[];
  warnings: {
    index: number;
    code: string;
    message: string;
  }[];
}
export interface ChangeEvent {
  ops: Op[];
  inverse: Op[];
  origin: string;
  label?: string;
}
export interface Query {
  kind?: string | string[];
  text?: string | RegExp;
  within?: Box;
  connectedTo?: string;
  direction?: 'in' | 'out' | 'both';
  /** Descendants of this group, excluding the group itself. */
  inside?: string;
  data?: Record<string, unknown>;
  hidden?: boolean;
  locked?: boolean;
  page?: string;
}
export type Scope = 'doc' | 'page' | 'selection' | 'viewport';
export interface DescribeOptions {
  scope?: Scope;
  detail?: 'brief' | 'normal' | 'full';
  relations?: boolean;
  freeSpace?: boolean;
  maxItems?: number;
  selection?: string[];
  page?: string;
}
export interface ExportOptions {
  scope?: Scope;
  /** PNG pixel ratio; defaults to 2. */
  scale?: number;
  background?: string | boolean;
  padding?: number;
  labels?: boolean;
}
export interface DocOptions {
  readonly?: boolean;
  allowedImageOrigins?: string[];
  sanitizeHTML?: (html: string) => string;
  kinds?: {
    kind: string;
    schema?: unknown;
    defaults?: Partial<Item>;
    outline?: (item: Item) => Outline | Outline[];
  }[];
}
export interface DocModel {
  itemSignal(id: string): ReadonlySignal<Item | undefined>;
  fieldSignal<K extends keyof Item>(id: string, key: K): ReadonlySignal<Item[K] | undefined>;
  /** Immediate child IDs of a page or group. */
  childrenSignal(id: string): ReadonlySignal<readonly string[]>;
  apply(ops: Op[], options?: ApplyOptions): ApplyResult;
  get(id: string): Item | undefined;
  query(selector?: Query): Item[];
  describe(options?: DescribeOptions): string;
  /** Built-in kinds added or last changed after `since`. Omit or pass 0 for the full catalog. */
  kindsSince(since?: number): KindCatalogSnapshot;
  toJSON(options?: { compact?: boolean }): AnnieDoc;
  undo(options?: { origin?: string }): boolean;
  redo(): boolean;
  load(doc: AnnieDoc): void;
  /** Only `'change'` is emitted; the argument exists so subscribers are typed. */
  on(type: 'change', callback: (event: ChangeEvent) => void): () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}
export interface LensState {
  x: number;
  y: number;
  zoom: number;
}
