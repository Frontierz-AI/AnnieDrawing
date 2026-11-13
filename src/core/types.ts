import type { ReadonlySignal } from '@preact/signals-core';
import type { KindCatalogSnapshot } from './catalog';
export type Point = {
  x: number;
  y: number;
};
/** Last observed human pointer. Coordinates are page-space; never serialized. */
export interface BoardPointer {
  x: number;
  y: number;
  pageId: string;
  inside: boolean;
  pointerType: string;
  ageMs: number;
  itemId: string | null;
}
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
  | 'mark'
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
  /** `md` renders **bold**, *italic*, `- ` and `1. ` list items, and `# ` / `## ` headings. Default `plain`. */
  format?: 'plain' | 'md';
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
  /** Mark only: the item it emphasizes. The mark takes its geometry from this item. */
  target?: string;
  /** Mark only: `highlight`, `underline`, `circle`, or `box`. Default `highlight`. */
  mark?: 'highlight' | 'underline' | 'circle' | 'box';
  /** Mark only: first occurrence of this phrase in the target's visible text. Omitted, or not found, covers the whole item. */
  match?: string;
  closed?: boolean;
  autoWidth?: boolean;
  /** Table only: cell text by row, then column. Ragged rows are padded with empty cells. */
  rows?: string[][];
  /** Table only: the first row is a header. */
  header?: boolean;
  media?: string;
  /** Image only: the picture does not exist yet. `media` may be omitted while this is true. */
  pending?: boolean;
  /** Image only: generation progress from 0 to 1, drawn while `pending`. */
  progress?: number;
  /** Image only: the size came from the media, so a `media.set` that changes its aspect ratio keeps `w` and sets `h`. */
  fitMedia?: boolean;
  crop?: Box;
  href?: string;
  description?: string;
  html?: string;
  mount?: string;
  [key: string]: unknown;
}
export type NewItem = {
  [K in keyof Item as K extends 'children' | 'kind' | 'from' | 'to' | 'text' ? never : K]?: Item[K];
} & {
  kind: ItemKind;
  children?: NewItem[];
  from?: EndpointInput;
  to?: EndpointInput;
  /** A plain string is stored as `{ value }`. */
  text?: ItemText | string;
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
      patch: Omit<Partial<Item>, 'from' | 'to' | 'text'> & {
        from?: EndpointInput;
        to?: EndpointInput;
        /** A plain string sets `text.value` and keeps the other label fields. */
        text?: Partial<ItemText> | string;
        /** Table only: `{ 'row,column': 'text' }`, zero-based with the header as row 0. Stored as `rows`. */
        cells?: Record<string, string>;
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
/**
 * Agent layout for nodes sent without `x`, `y`, or `place`. `auto` arranges each batch as a graph,
 * `none` places node by node from the arrows. An object keeps `auto` and fixes the direction or shape.
 */
export type AgentLayout =
  'auto' | 'none' | { direction?: 'right' | 'down'; shape?: 'flow' | 'tree' | 'radial' | 'ring' };
export interface ApplyOptions {
  /** Reject the whole batch if the document changed since this session revision. */
  expectedRevision?: number;
  /** Provenance, not auth. Default in createDoc is `api`. Non-`user` origins sanitize HTML and use LIMITS.maxBatch. */
  origin?: string;
  label?: string;
  dryRun?: boolean;
  /** `agent:` batches only. How nodes sent without `x`, `y`, or `place` are arranged. Default `auto`. */
  layout?: AgentLayout;
  /** Visible size in page units at zoom 1, read by the agent layout. Headless default 1280x760; a board passes its own. */
  viewport?: { w: number; h: number };
  merge?: boolean;
  agentName?: string;
  /**
   * After created items finish arriving, `fit` frames the whole current page and `created`
   * flies to what the batch created unless it is already in view. Both move only while
   * `board.view.follow` is true.
   */
  reveal?: 'none' | 'fit' | 'created';
  /**
   * Browser boards only, presentation only: `durationMs` (0 to 60000) is the time from the start
   * of this agent batch's arrival to its `presented` event, shared by text length.
   */
  presentation?: { durationMs?: number };
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
  /** Items the batch added (including nested children) that exist after it. */
  created: string[];
  /** Items that existed before, still exist, and were changed by a `set`, `order`, or `reparent` in the batch (or detached from a removed target). Excludes `moved`-only items and `created`. */
  updated: string[];
  /** Items that existed before and do not exist after, including descendants of removed groups and children dropped by a `set` of `children`. */
  removed: string[];
  errors: ApplyIssue[];
  warnings: ApplyIssue[];
  /** Present when an agent `place` inserted a node and moved existing items to make room. */
  moved?: string[];
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
  /** Append "Use query() or increase maxItems for detail." to the overflow line. Default false. */
  overflowHint?: boolean;
}
export type ExportFormat = 'json' | 'svg' | 'png' | 'jpeg' | 'webp';
export interface ExportOptions {
  scope?: Scope;
  /** Raster pixel ratio; defaults to 2. */
  scale?: number;
  background?: string | boolean;
  padding?: number;
  /** Adds item IDs. PNG then defaults to 32-color indexed and a 240 KiB budget. */
  labels?: boolean;
  /** Longest output side in CSS pixels. Ignored for json/svg. */
  maxSide?: number;
  /** If set, run a quality/scale ladder and return the smallest result that fits. */
  maxBytes?: number;
  /** Starting JPEG/WebP quality, 0.1–1. Default 0.85. */
  quality?: number;
  /** PNG only. Quantize to at most this many colors (2–256) and write an indexed PNG. */
  colors?: number;
  /** SVG only. Inline remote images as data URLs so the file is self-contained. Raster formats always do. */
  embedImages?: boolean;
  /** Called once per item whose image could not be embedded; the export draws a labeled placeholder. */
  onWarning?: (warning: ExportWarning) => void;
}
export interface ExportWarning {
  code: 'IMAGE_UNAVAILABLE';
  /** Item id. */
  id: string;
  /** Media key. */
  media: string;
  message: string;
}
/** Board `media` event: an image item's picture finished loading or failed in the browser. */
export interface MediaLoadEvent {
  /** Item id. */
  id: string;
  /** Media key. */
  media: string;
  status: 'loaded' | 'error';
}
export interface AgentPresenceOptions {
  /** On-screen non-connector stops before the rest appear together. Default 8. */
  maxStops?: number;
  /** Multiplier on move and reveal durations. Default 1. Minimum 0.25, maximum 2. */
  durationScale?: number;
  /**
   * Write the labels of created items left to right, line by line, with a pen cursor, instead
   * of fading them. Presentation only. Default false. `charsPerSecond` defaults to 30 (5 to 400).
   */
  write?: boolean | { charsPerSecond?: number };
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
  /** Default for `ApplyOptions.layout`. */
  agentLayout?: AgentLayout;
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
/** `user` is direct input, `api` a host call, `agent` a reveal, `resize` a host size change. */
export type ViewCause = 'user' | 'api' | 'agent' | 'resize';
export interface ViewEvent extends LensState {
  cause: ViewCause;
}
