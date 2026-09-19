# The `.annie` document

A document is UTF-8 JSON. The file extension is `.annie`; MIME type is `application/vnd.anniedrawing+json`.

```json
{
  "format": "anniedrawing",
  "version": 2,
  "meta": { "title": "Our next idea" },
  "pages": [
    {
      "id": "p_main",
      "name": "My board",
      "background": "paper",
      "items": [
        {
          "id": "i_idea",
          "kind": "note",
          "x": 120,
          "y": 100,
          "w": 200,
          "h": 180,
          "text": { "value": "Make something useful" },
          "style": { "fill": "moss" }
        }
      ]
    }
  ],
  "media": {}
}
```

The tree is `pages → items → children`. Only groups have children. Array order is back to front. IDs are unique across the document. Child coordinates are in page space, never relative to their parent. Distances use CSS pixels at zoom 1; positive y points down. Rotation is clockwise degrees around each box's center.

Common item fields are `id`, `kind`, `x`, `y`, `w`, `h`, `rotation`, `style`, `text`, `name`, `locked`, `hidden` and application-owned `data`. The document model expands defaults internally and omits default style flags on serialization. `data` is JSON metadata; the editor does not execute it.

Built-in kinds are `rect`, `ellipse`, `diamond`, `line`, `connector`, `path`, `text`, `note`, `image`, `group` and `html`. Unknown kinds are retained with a visible placeholder, so loading and saving do not silently destroy custom content.

`text` contains a plain `value`, horizontal `align`, vertical `valign`, `size` (`s`, `m`, `l`, `xl` or a number), and `font` (`sans`, `serif`, `mono`, `hand`). Style fields include `stroke`, `strokeWidth`, `dash`, `fill`, `fillMode`, `corner` and `opacity`.

The named colors are `ink`, `slate`, `coral`, `amber`, `moss`, `teal`, `sky`, `violet`, `rose` and `paper`. These map to Frontierz colors and theme-aware foreground/background values. Ordinary CSS colors are also accepted. `fill: 'none'` creates a hollow shape.

## Connections and paths

A connector has `from` and `to`, each either `{ "item": "i_idea", "side": "right" }` or a free `{ "x": 100, "y": 200 }` point. An attached endpoint can use normalized `anchor: [0, 0.5]`. Routes are `straight`, `elbow` or `curve`. Heads accept `none`, `arrow` or `dot`. When a target disappears, its endpoint becomes a free point at its last position in the same atomic edit.

Line and freehand `points` are relative to the item's x/y. Freehand points may include pressure: `[x, y, pressure]`. Item IDs and connector bindings survive moves and export/import.

## Media and HTML

Image items reference a key in the top-level `media` map. A record contains `{ mime, w, h, src }`. Embedded data URLs make files portable. Remote images require an explicit allowed origin and may still fail PNG export if their server does not permit cross-origin loading.

HTML is an optional application integration. Plain text is safe by construction; rendered HTML requires an explicit sanitizer. Custom kind mount callbacks live in trusted application code, never as executable code embedded in the file. See [security](../SECURITY.md).

## Versioning

The integer `version` belongs to the document format, independently of the package version. Version 2 is the current format and uses `pages`. New examples, saves and exports use this form.

The loader accepts version 1 drawings with `sheets` and migrates them to version 2 `pages` before validation. It preserves page and item IDs, item trees, coordinates, connector references, media and custom page names. Default names such as `Sheet 1` become `Page 1`. Existing `.annie` files and browser autosaves remain readable; the next save writes version 2. Migration reads the original object without mutating it.

The current editing API uses `page.add`, `page.set`, `page.remove`, the `page` operation property and the `page` read/export scope. Legacy field names belong only to imported version 1 data. Unsupported future versions are rejected rather than being silently rewritten.

Older drawings containing `frame` items load as ordinary groups. The loader preserves the container ID, children, metadata and connector bindings, adds a rectangle for its background and text for its heading, and drops clipping. Existing content outside a container becomes visible. New drawings use groups for nesting and rectangles for visible boxes.
