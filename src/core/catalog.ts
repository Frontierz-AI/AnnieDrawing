/** Bump when a built-in kind is added or its create/read contract changes. */
export const CATALOG_VERSION = 4;

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
    since: 4,
    w: 180,
    h: 110,
    note: 'Rounded rectangle. Nodes, cards, boxes. Agent creates grow so text fits; omitted fill gets a varied tint. text.format "md" renders **bold**, *italic*, - and 1. lists, # and ## headings.',
  },
  {
    kind: 'ellipse',
    since: 4,
    w: 180,
    h: 110,
    note: 'Ellipse or circle. Agent creates grow so text fits; omitted fill gets a varied tint. text.format "md" renders **bold**, *italic*, - and 1. lists, # and ## headings.',
  },
  {
    kind: 'diamond',
    since: 4,
    w: 160,
    h: 140,
    note: 'Diamond. Decisions or highlights. Agent creates grow so text fits; omitted fill gets a varied tint. text.format "md" renders **bold**, *italic*, - and 1. lists, # and ## headings.',
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
    kind: 'mark',
    since: 4,
    w: 0,
    h: 0,
    note: 'Emphasis on another item: target (item id, same page) and mark highlight, underline, circle, or box. Optional match: a phrase of the target text (first occurrence); else the whole item. Follows the target; removed with it. x/y/w/h ignored; never affects placement. style.fill or style.stroke.',
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
    since: 4,
    w: 600,
    h: 48,
    note: 'Text. Default width 600. Agent creates grow so a title fits; without h they store the height of their lines. Browser autoWidth measures. text.format "md" renders **bold**, *italic*, - and 1. lists, # and ## headings.',
  },
  {
    kind: 'note',
    since: 4,
    w: 200,
    h: 180,
    note: 'Sticky note. User default is moss fill and a 12px corner. Agent creates grow so text fits; omitted fill gets a varied tint. text.format "md" renders **bold**, *italic*, - and 1. lists, # and ## headings.',
  },
  {
    kind: 'image',
    since: 4,
    w: 240,
    h: 180,
    note: 'References a media table key. Raster or SVG; remote URLs need allowed origins. Omitted w/h come from the media (fit in 480x360); one sent derives the other. pending: true allows no media yet, with optional progress 0 to 1; resolve with media.set plus set { media, pending: false }.',
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
    kind: 'table',
    since: 4,
    w: 0,
    h: 0,
    note: 'Grid of plain-text cells. Create with rows: string[][] and header: true for a bold first row; omit w/h, the size comes from the text. Replace with set { rows }; edit cells with set { cells: { "row,column": "text" } }, zero-based, header is row 0. Connectors and placement treat it as a box.',
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
