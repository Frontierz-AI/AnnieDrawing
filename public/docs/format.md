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

Built-in kinds: `rect`, `ellipse`, `diamond`, `line`, `connector`, `path`, `text`, `note`, `image`, `video`, `link`, `group`, and `html`. Unknown kinds are kept and shown as a placeholder. Load and save do not drop custom content.

Default sizes when `w` and `h` are omitted: rect and ellipse 180×110, diamond 160×140, line 180×0, connector 0×0, path 0×0, text 200×48, note 200×180, image 240×180, video 480×270, link 220×200, group 0×0, html 240×160.

`text` has a plain `value`, horizontal `align` (`start`, `center`, `end`), vertical `valign` (`top`, `middle`, `bottom`), `size` (`s`, `m`, `l`, `xl`, or a number from 1 to 1000), and `font` (`sans`, `serif`, `mono`, `hand`). Omitted `font` is `hand`, the handwritten Comic Sans-like stack. `autoWidth: true` on a browser `text` item stores measured width and height.

Style fields: `stroke`, `strokeWidth` (0 to 1000), `dash` (`solid`, `dashed`, `dotted`), `fill`, `fillMode` (`solid`, `tint`, `hatch`), `corner`, and `opacity` (0 to 1). Notes, images, videos, and link cards default to a 12px corner. `hatch` is a document and export fill. The inspector does not offer it.

`href` is an `http(s)` URL on `video` and `link` items. `description` is optional plain text for a link card. A `video` href must be a YouTube or Vimeo watch or embed URL. The renderer derives the player address from the parsed id. It does not store iframe markup. `html` holds markup for `html` items. `mount` is an internal id the renderer assigns; do not treat it as a file field to author.

Named colors: `ink`, `slate`, `coral`, `amber`, `moss`, `teal`, `sky`, `violet`, `rose`, and `paper`. These map to Frontierz colors and theme-aware foreground and background values. Ordinary CSS colors are also accepted. `fill: 'none'` draws a hollow shape.

## Connectors and paths

A connector has `from` and `to`. Each end is either `{ "item": "i_note", "side": "right" }` or a free `{ "x": 100, "y": 200 }` point. `side` is `auto`, `top`, `right`, `bottom`, or `left`. An attached endpoint can use a normalized `anchor: [0, 0.5]`. Routes are `straight`, `elbow`, or `curve`. Heads accept `none`, `arrow`, or `dot`. Optional `waypoints` are page-space `[x, y]` points between the ends. When a target disappears, that endpoint becomes a free point at its last position in the same atomic edit.

Line and freehand `points` are relative to the item's `x` and `y`. Freehand points may include pressure: `[x, y, pressure]`. `closed: true` closes a path. Item IDs and connector bindings survive moves and export or import.

## Media and HTML

Image items reference a key in the top-level `media` map. A record contains `{ mime, w, h, src }`. Allowed `mime` values are `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif`, and `image/svg+xml`. The toolbar `addImage` helper accepts the raster types under 10 MB; it does not accept SVG files. Embedded data URLs make files portable. Remote images require an explicit allowed origin. PNG export can still fail if that server does not permit cross-origin loading. Link cards may reuse `media` for a preview image. Optional `crop` is a box in media pixel space.

HTML is an optional application integration. Plain text is safe by construction. Rendered HTML requires an explicit sanitizer. `video` and `link` items are structured fields rendered with trusted DOM. They are not HTML items. Custom kind mount callbacks live in trusted application code. They are never executable code stored in the file. See [security](security.md).

## Versions

The integer `version` belongs to the document format. It is independent of the package version and of the built-in kind catalog (`CATALOG_VERSION` / `kindsSince`). Version 2 is the current format and uses `pages`. New examples, saves, and exports use this form.

The loader accepts version 1 drawings with `sheets` and migrates them to version 2 `pages` before validation. It keeps page and item IDs, item trees, coordinates, connector references, media, and custom page names. Default names such as `Sheet 1` become `Page 1`. Existing `.annie` files and browser autosaves remain readable. The next save writes version 2. Migration reads the original object without mutating it.

The editing API uses `page.add`, `page.set`, `page.remove`, the `page` operation property, and the `page` read and export scope. Legacy field names belong only to imported version 1 data. Unsupported future versions are rejected.

Older drawings that contain `frame` items load as ordinary groups. The loader keeps the container ID, children, metadata, and connector bindings, adds a rectangle for the background and text for the heading, and drops clipping. Content that sat outside a container becomes visible. New drawings use groups for nesting and rectangles for visible boxes.
