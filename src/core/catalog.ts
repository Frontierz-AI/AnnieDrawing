/** Bump when a built-in kind is added or its create/read contract changes. */
export const CATALOG_VERSION = 2;

export interface KindCatalogEntry {
  kind: string;
  /** Catalog version that added this kind or last changed its create/read fields. */
  since: number;
  w: number;
  h: number;
  note: string;
}

export interface KindCatalogSnapshot {
  version: number;
  since: number;
  kinds: KindCatalogEntry[];
}

/** Built-in kinds. `since` is the catalog version that introduced or last changed the kind. */
export const KIND_CATALOG: readonly KindCatalogEntry[] = [
  {
    kind: 'rect',
    since: 2,
    w: 180,
    h: 110,
    note: 'Rounded rectangle. Nodes, cards, boxes. Agent creates grow so text fits.',
  },
  {
    kind: 'ellipse',
    since: 2,
    w: 180,
    h: 110,
    note: 'Ellipse or circle. Agent creates grow so text fits.',
  },
  {
    kind: 'diamond',
    since: 2,
    w: 160,
    h: 140,
    note: 'Diamond. Decisions or highlights. Agent creates grow so text fits.',
  },
  {
    kind: 'line',
    since: 1,
    w: 180,
    h: 0,
    note: 'Straight segment. Optional points are relative to x/y.',
  },
  {
    kind: 'connector',
    since: 2,
    w: 0,
    h: 0,
    note: 'Bound or free link. Requires from and to. Agent creates that omit route store elbow. Compact JSON omits x/y/w/h.',
  },
  {
    kind: 'path',
    since: 1,
    w: 0,
    h: 0,
    note: 'Freehand or polyline. points relative to x/y; closed optional.',
  },
  {
    kind: 'text',
    since: 2,
    w: 600,
    h: 48,
    note: 'Plain text. Default width 600. Agent creates grow so a title fits. Browser autoWidth measures.',
  },
  {
    kind: 'note',
    since: 2,
    w: 200,
    h: 180,
    note: 'Sticky note. Default moss fill and 12px corner. Agent creates grow so text fits.',
  },
  {
    kind: 'image',
    since: 1,
    w: 240,
    h: 180,
    note: 'References a media table key. Raster or SVG; remote URLs need allowed origins.',
  },
  {
    kind: 'video',
    since: 1,
    w: 480,
    h: 270,
    note: 'YouTube or Vimeo href. Stores the watch URL, not iframe markup.',
  },
  {
    kind: 'link',
    since: 1,
    w: 220,
    h: 200,
    note: 'Website card. href plus optional title, description, and preview media.',
  },
  {
    kind: 'group',
    since: 1,
    w: 0,
    h: 0,
    note: 'Only kind that contains children. Child positions stay in page coordinates.',
  },
  {
    kind: 'html',
    since: 1,
    w: 240,
    h: 160,
    note: 'Markup. Renders only when the host passed a sanitizer.',
  },
];

/**
 * Built-in kinds added or last changed after `since`.
 * Omit `since` or pass 0 to list every built-in kind.
 */
export function kindsSince(since = 0): KindCatalogSnapshot {
  const from = since || 0;
  return {
    version: CATALOG_VERSION,
    since: from,
    kinds: KIND_CATALOG.filter((entry) => entry.since > from).map((entry) => ({ ...entry })),
  };
}
