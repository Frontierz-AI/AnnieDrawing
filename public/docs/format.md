# Document format

A document is UTF-8 JSON. The file extension is `.annie`. The MIME type is `application/vnd.anniedrawing+json`.

```json
{
  "format": "anniedrawing",
  "version": 2,
  "meta": { "title": "Architecture" },
  "pages": [
    {
      "id": "p_main",
      "name": "Page 1",
      "background": "paper",
      "items": [
        {
          "id": "i_note",
          "kind": "note",
          "x": 120,
          "y": 100,
          "w": 200,
          "h": 180,
          "text": { "value": "Note" },
          "style": { "fill": "moss" }
        }
      ]
    }
  ],
  "media": {}
}
```

The tree is `pages` to `items` to `children`. Only groups have children. Array order is back to front. IDs are unique across the document.

Child coordinates are in page space. They are not relative to the parent. Distances use CSS pixels at zoom 1. Positive y points down. Rotation is clockwise degrees around the item's center.

## Item fields

Common fields: `id`, `kind`, `x`, `y`, `w`, `h`, `rotation`, `style`, `text`, `name`, `locked`, `hidden`, and application-owned `data`. Generated IDs use `i_`, `p_`, and `m_` prefixes. Callers may supply their own IDs.

The model expands defaults internally and omits default style flags on serialization. Compact JSON also omits `x`, `y`, `w`, and `h` on connectors. `data` is JSON metadata. The editor does not execute it.

Built-in kinds: `rect`, `ellipse`, `diamond`, `line`, `connector`, `mark`, `path`, `text`, `note`, `image`, `video`, `link`, `table`, `group`, and `html`. Unknown kinds are kept and shown as a placeholder. Load and save do not drop custom content.

Default sizes when `w` and `h` are omitted: rect and ellipse 180×110, diamond 160×140, line 180×0, connector 0×0, mark 0×0, path 0×0, text 600×48, note 200×180, image 240×180, video 480×270, link 220×200, group 0×0, html 240×160. An `agent:` create or text patch on `rect`, `ellipse`, `diamond`, `note`, or `text` may store a larger size so the label fits, and an agent `text` sent without `h` stores the height of its lines. An image added without `w` and `h` takes its size from its media, fitted to 480×360 without enlarging, and a table takes its size from its text; 240×180 applies to an image whose media has no usable size or that is pending.

`text` has a `value`, horizontal `align` (`start`, `center`, `end`), vertical `valign` (`top`, `middle`, `bottom`), `size` (`s`, `m`, `l`, `xl`, or a number from 1 to 1000), `font` (`sans`, `serif`, `mono`, `hand`), and `format` (`plain` or `md`, default `plain`). Omitted `font` is `hand`, the handwritten Comic Sans-like stack. With `format: 'md'`, `value` keeps its Markdown source: `**bold**`, `*italic*`, `- ` and `1. ` list items, and `# ` / `## ` headings render as such on `rect`, `ellipse`, `diamond`, `note`, and `text`, and anything else is shown as written. Connector labels are always plain. `autoWidth: true` on a browser `text` item stores measured width and height.

Field names reserved by built-in kinds are validated on every item, whatever its kind: `rows`, `header`, `pending`, `progress`, `fitMedia`, `target`, `mark`, `match`, and `text.format`, as well as `from`, `to`, `points`, `media`, `href`, `html`, and the other fields listed here. A custom kind that stores a different shape under one of these names fails validation. Use other names, or keep custom fields in `data`.

Style fields: `stroke`, `strokeWidth` (0 to 1000), `dash` (`solid`, `dashed`, `dotted`), `fill`, `fillMode` (`solid`, `tint`, `hatch`), `corner`, and `opacity` (0 to 1). Rectangles, notes, images, videos, and link cards default to a 12px corner. `hatch` is a document and export fill. The inspector does not offer it.

`href` is an `http(s)` URL on `video` and `link` items. `description` is optional plain text for a link card. A `video` href must be a YouTube or Vimeo watch or embed URL. The renderer derives the player address from the parsed id. It does not store iframe markup. `html` holds markup for `html` items. `mount` is an internal id the renderer assigns; do not treat it as a file field to author.

Named colors: `ink`, `slate`, `coral`, `amber`, `moss`, `teal`, `sky`, `violet`, `rose`, and `paper`. These map to Frontierz colors and theme-aware foreground and background values. Ordinary CSS colors are also accepted. `fill: 'none'` draws a hollow shape. `apply` also accepts host color names (`black`, `grey`, `gray`, `blue`, `light-blue`, `green`, `light-green`, `red`, `light-red`, `orange`, `yellow`, `violet`, `light-violet`); compact JSON writes the token, not the alias. Kind aliases `rectangle` and `arrow` are operation input only. They are not format kinds. The same holds for a plain string `text` on `apply`: the document always stores `text` as an object with `value`.

## Connectors and paths

A connector has `from` and `to`. Each stored end is either `{ "item": "i_note", "side": "right" }` or a free `{ "x": 100, "y": 200 }` point. `apply` also accepts a string item id, stored as `{ item, side: "auto" }`. `side` is `auto`, `top`, `right`, `bottom`, or `left`. An attached endpoint can use a normalized `anchor: [0, 0.5]`. Routes are `straight`, `elbow`, or `curve`. An `agent:` create that omits `route` stores `elbow`. Omitted `route` in a saved file stays `straight`. Elbows pick a channel that misses intervening boxes. Routes and label positions are derived when drawing; they are not stored. A connector cannot attach to a `mark`. Heads accept `none`, `arrow`, or `dot`. Optional `waypoints` are page-space `[x, y]` points between the ends. When a target disappears, that endpoint becomes a free point at its last position in the same atomic edit.

Line and freehand `points` are relative to the item's `x` and `y`. Freehand points may include pressure: `[x, y, pressure]`. `closed: true` closes a path. Item IDs and connector bindings survive moves and export or import.

## Tables and marks

A `table` stores `rows`, an array of 1 to 200 rows of cell strings (at most 50 columns and 2,000 characters per cell), and optional `header: true`, which makes the first row a header. Ragged rows are padded with empty cells when stored. Cells are plain text. `w` and `h` hold the table's stored size, which is at least what the text needs. A table without `rows` is rejected. The `cells` patch accepted by `apply` is operation input only; the document stores `rows`.

```json
{
  "id": "i_plan",
  "kind": "table",
  "x": 80,
  "y": 80,
  "w": 291,
  "h": 68,
  "header": true,
  "rows": [
    ["Current point", "Next focus"],
    ["Draft", "Reports"]
  ]
}
```

A `mark` stores `target` (the id of an item on the same page), `mark` (`highlight`, `underline`, `circle`, or `box`; default `highlight`), and optional `match`, a non-empty phrase. It draws on its target: the whole item, or the first occurrence of `match` in the target's visible text, or the whole item when the phrase is not found. Its stored `x`, `y`, `w`, and `h` are 0, `rotation` is not stored, and compact JSON omits `x`, `y`, `w`, and `h` as for connectors. A mark may sit inside a group. A new mark must target an existing item that is not a mark or a connector. A document whose mark has lost its target still loads and round-trips; that mark draws nothing until it has a target again.

```json
{ "id": "i_ring", "kind": "mark", "target": "i_note", "mark": "circle", "match": "Next step" }
```

## Media and HTML

Image items reference a key in the top-level `media` map. A record contains `{ mime, w, h, src }`. Allowed `mime` values are `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif`, and `image/svg+xml`. The toolbar `addImage` helper accepts the raster types under 10 MB; it does not accept SVG files. Embedded data URLs make files portable. Remote images require an explicit allowed origin. Raster export fetches remote images with CORS; a server that does not permit it leaves a labeled placeholder in the export. Link cards may reuse `media` for a preview image. Optional `crop` is a box in media pixel space.

`fitMedia: true` on an image records that its size came from its media, so a later media change with a different aspect ratio keeps `w` and sets `h`. An explicit resize removes it. An image with `pending: true` has no picture yet and may omit `media`; every other image must reference an existing media key. `progress` is a number from 0 to 1 shown while the image is pending, and it may stay stored after the image resolves. Version 0.7.0 cannot load a document that holds a pending image without media.

HTML is an optional application integration. Plain text is safe by construction. Rendered HTML requires an explicit sanitizer. `video` and `link` items are structured fields rendered with trusted DOM. They are not HTML items. Custom kind mount callbacks live in trusted application code. They are never executable code stored in the file. See [security](security.md).

## Versions

The integer `version` belongs to the document format. It is independent of the package version, the built-in kind catalog (`CATALOG_VERSION` / `kindsSince`), and the session `revision` used by `changesSince`. Version 2 is the current format and uses `pages`. New examples, saves, and exports use this form. Session revision is not a file field. The kinds and fields added with catalog 4 (`table`, `mark`, `rows`, `header`, `pending`, `progress`, `fitMedia`, `target`, `mark`, `match`, and `text.format`) are optional additions to version 2; older readers keep `table` and `mark` as unknown kinds.

The loader accepts version 1 drawings with `sheets` and migrates them to version 2 `pages` before validation. It keeps page and item IDs, item trees, coordinates, connector references, media, and custom page names. Default names such as `Sheet 1` become `Page 1`. Existing `.annie` files and browser autosaves remain readable. The next save writes version 2. Migration reads the original object without mutating it.

The editing API uses `page.add`, `page.set`, `page.remove`, the `page` operation property, and the `page` read and export scope. Legacy field names belong only to imported version 1 data. Unsupported future versions are rejected.

Older drawings that contain `frame` items load as ordinary groups. The loader keeps the container ID, children, metadata, and connector bindings, adds a rectangle for the background and text for the heading, and drops clipping. Content that sat outside a container becomes visible. New drawings use groups for nesting and rectangles for visible boxes.

## Export

`board.export` writes JSON (AnnieDoc), SVG, PNG, JPEG, or WebP. PNG may be truecolor or an indexed palette (`colors`, 2–256). The editor Export control downloads the current page as PNG, SVG, or AnnieDoc. Programmatic export is not limited by that menu. See [API reference](api.md#export).
