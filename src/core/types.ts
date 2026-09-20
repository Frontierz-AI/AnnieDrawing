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
/** Operation input; stored items keep structured endpoints. */
export type EndpointInput = Endpoint | string;
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
  [K in keyof Item as K extends 'children' | 'kind' | 'from' | 'to' ? never : K]?: Item[K];
} & {
  kind: ItemKind;
  children?: NewItem[];
  from?: EndpointInput;
  to?: EndpointInput;
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
      patch: Omit<Partial<Item>, 'from' | 'to'> & {
        from?: EndpointInput;
        to?: EndpointInput;
      };
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
  /** After a successful browser apply, fit the camera to created item ids. */
  reveal?: 'none' | 'fit';
  /**
   * When true, invalid operations are skipped and the rest commit as one
   * transaction. Default false (all-or-nothing).
   */
  lenient?: boolean;
}
export interface ApplyIssue {
  index: number;
  code: string;
  message: string;
}
export interface ApplyResult {
  ok: boolean;
  created: string[];
  errors: ApplyIssue[];
  warnings: ApplyIssue[];
  /** Present only when lenient: operations that did not commit. */
  skipped?: ApplyIssue[];
}
export interface ChangeSlice {
  revision: number;
  origin: string;
  label?: string;
  ops: Op[];
}
export interface ChangeLog {
  /** Current session revision (read this after the call). */
  cursor: number;
  since: number;
  changes: ChangeSlice[];
  truncated?: true;
}
export interface ChangeEvent {
  ops: Op[];
  inverse: Op[];
  origin: string;
  label?: string;
  /** Session revision after this commit. */
  revision: number;
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
  since?: number;
  /** Still-present ids for viewport scope. */
  ids?: string[];
}
export type ExportFormat = 'json' | 'svg' | 'png' | 'jpeg' | 'webp';
export interface ExportOptions {
  scope?: Scope;
  /** Raster pixel ratio; defaults to 2. */
  scale?: number;
  background?: string | boolean;
  padding?: number;
  labels?: boolean;
  /** Longest output side in CSS pixels. Ignored for json/svg. */
  maxSide?: number;
  /** If set, run a quality/scale ladder and return the smallest result that fits. */
  maxBytes?: number;
  /** Starting JPEG/WebP quality, 0.1–1. Default 0.85. */
  quality?: number;
}
export interface AgentPresenceOptions {
  /** On-screen non-connector stops before the rest appear together. Default 8. */
  maxStops?: number;
  /** Multiplier on move and reveal durations. Default 1. Minimum 0.25, maximum 2. */
  durationScale?: number;
}
export interface DocOptions {
  readonly?: boolean;
  /** Restricts remote images on non-`user` origins. User paste, import, and `load()` are not gated. */
  allowedImageOrigins?: string[];
  /** Required to render HTML as HTML. Identity functions are rejected. */
  sanitizeHTML?: (html: string) => string;
  kinds?: {
    kind: string;
    schema?: unknown;
    defaults?: Partial<Item>;
    outline?: (item: Item) => Outline | Outline[];
  }[];
  agentHistory?: 'shared' | 'hidden';
  agentPlaceGap?: number;
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
  clear(): void;
  changesSince(since: number, options?: { origin?: string | 'user' | 'agent' }): ChangeLog;
  /** Only `'change'` is emitted; the argument exists so subscribers are typed. */
  on(type: 'change', callback: (event: ChangeEvent) => void): () => void;
  readonly revision: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}
export interface LensState {
  x: number;
  y: number;
  zoom: number;
}
