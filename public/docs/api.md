# API reference

## Imports

| Import                   | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `anniedrawing`           | Browser board, kinds (`defineKind`, `registerKind`), catalog (`kindsSince`), types |
| `anniedrawing/core`      | Headless document, validation, history, geometry, and kind catalog                 |
| `anniedrawing/agent`     | Tool definitions, dispatch, descriptions, queries, and kind catalog                |
| `anniedrawing/ui`        | Optional plain-DOM editor controls (`mountUI`)                                     |
| `anniedrawing/fellow`    | `createFellowBoard` embed preset                                                   |
| `anniedrawing/style.css` | Editor styles                                                                      |

Use Node.js 22.12 or newer to develop this repository and to install it from git. The published library is ES2022. Browser hosts need Pointer Events, SVG, ResizeObserver, and `structuredClone`. All JavaScript exports are ESM.

## createBoard and createDoc

```ts
const board = createBoard(host, {
  doc, // optional initial AnnieDoc
  readonly: false,
  theme: 'light', // also 'dark' | 'auto'
  ui: {
    menu: true, // AnnieDrawing control; false hides it
    export: ['png', 'svg'], // add 'json' for AnnieDoc; false hides Export
    pages: true, // false hides page chips
  },
  autosaveKey: 'my-diagram', // opt-in browser persistence
  exposeGlobal: false, // true registers window.__anniedrawing; the demo sets true
  agentName: 'Alex', // cursor label when apply omits agentName
  agentHistory: 'shared', // 'hidden' skips agent: origins on default undo
  agentReveal: 'fit', // 'created' flies to the new items; 'none' leaves the camera still
  agentRevealMinZoom: 0.6, // lowest zoom a 'created' reveal uses
  agentLayout: 'auto', // 'none' places agent nodes one by one; or { direction, shape }
  agentPlaceGap: 32, // default place.gap for agent: origins
  agentPresence: true, // or { maxStops, durationScale, write }
  allowedImageOrigins: ['https://images.example.com'],
  // sanitizeHTML: (html) => DOMPurify.sanitize(html),
  // kinds: [customKind],
  // unfurl: false, // skip fetching pasted website URLs for title and image
});
await board.ready; // wait for optional autosave restoration
// ...
board.destroy();
```

The host must have nonzero width and height. `destroy()` releases the board's listeners, views, subscriptions, and global registration. Dispose application integrations with their own cleanup functions. The library does not ship a font file. The demo loads Nunito. The library CSS uses system fallbacks. `BoardOptions`, `UiOptions`, and `UiExportFormat` are exported from `anniedrawing`.

| Option               | Default         | Meaning                                                                                                                        |
| -------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `theme`              | `'light'`       | `'light'`, `'dark'`, or `'auto'` (follows `prefers-color-scheme`). Change later with `setTheme`.                               |
| `ui`                 | `true`          | `false` omits editor chrome. An object keeps the tools and sets the header.                                                    |
| `ui.menu`            | `true`          | AnnieDrawing control: open a drawing, grid, appearance, documentation, GitHub, and the package version.                        |
| `ui.export`          | `['png','svg']` | `false` hides Export. `'png'`, `'svg'`, and `'json'` (AnnieDoc `.annie`). One format downloads immediately.                    |
| `ui.pages`           | `true`          | `false` hides page chips. `page.add` and `setPage` still work.                                                                 |
| `exposeGlobal`       | `false`         | `true` registers the board on `window.__anniedrawing`. The local demo sets this.                                               |
| `agentReveal`        | `'fit'`         | Camera after an agent arrival: `'fit'`, `'created'`, or `'none'`. See [Agent origin presentation](#agent-origin-presentation). |
| `agentRevealMinZoom` | `0.6`           | Lowest zoom a `'created'` reveal uses. Values above 1 are treated as 1.                                                        |
| `agentLayout`        | `'auto'`        | Default `layout` for `agent:` batches. `'none'` keeps per-node placement.                                                      |
| `agentPresence`      | `true`          | `false` skips the arrival. An object sets `maxStops` (default 8), `durationScale` (0.25 to 2, default 1), and `write`.         |

`ui: true` is the same as `{ menu: true, export: ['png', 'svg'], pages: true }`. Two or more export formats open a menu. The local demo passes `export: ['png', 'svg', 'json']`. Programmatic `board.export()` still supports JSON, SVG, PNG, JPEG, and WebP even when the Export control hides a format.

`createFellowBoard(host, { fellowName, theme, ... })` from `anniedrawing/fellow` applies embed defaults: `agentHistory: 'hidden'`, `agentReveal: 'created'`, `agentPlaceGap: 120`, `agentPresence: { maxStops: 3, durationScale: 0.55 }`, no global hook, no unfurl, and no menu, export, or page chips. Explicit options override them. An `agentPresence` object is merged over the Fellow pace, so `agentPresence: { write: true }` keeps `maxStops: 3` and `durationScale: 0.55`; `false` and `true` replace it.

`createDoc(initial?, { readonly?, allowedImageOrigins?, sanitizeHTML?, kinds?, agentHistory?, agentLayout?, agentPlaceGap? })` provides the model without creating DOM nodes. `allowedImageOrigins` gates remote images on non-`user` origins. User paste, import, and `load()` are not gated. `sanitizeHTML` is required to render HTML as HTML and must strip a script/event-handler probe. It returns `apply`, `get`, `query`, `describe`, `kindsSince`, `changesSince`, `toJSON`, `undo`, `redo`, `load`, `clear`, `on`, `revision`, `canUndo`, `canRedo`, `itemSignal`, `fieldSignal`, and `childrenSignal`. `anniedrawing/core` also exports `applyDraft`, `translateItem`, `copyItems`, `detachMissingEndpoints`, `allItems`, and `clipboardText` for hosts that implement clipboard or preview layers. `applyDraft` merges nested `style`, `text`, and `data`. `clipboardText` reads the first non-comment `text/uri-list` line, then `text/plain`.

`anniedrawing/core` also measures routes, labels, and marks without a DOM. `routePage(items, outline?)` returns every visible connector of a page in document order as `{ id, points, label? }`, in one pass. `connectorLabel(item, lookup?, outline?)` returns one connector's label box, or `undefined` without text. `labelSize(text)` and `labelLines(text)` give the estimated box size and wrapped lines of a connector label, and `placeLabel(points, size, blocked)` centers a box on the longest segment of a route where `blocked(box)` returns 0. `markGeometry(mark, lookup?, outline?)` returns `{ target, frame, rects, shapes }` for a mark, or `undefined` when its target is missing. `MARK_TYPES` lists the mark types, and `isOverlay(item)` is true for kinds that never take space (`mark`). `routeConnector` and `ConnectorGeometry` are unchanged; `midpoint` is still the path midpoint, and the stage and exports no longer place labels there.

## Signals

The model exposes readonly signals for custom views and integrations:

```ts
const stop = doc.fieldSignal('i_api', 'x').subscribe((x) => {
  console.log('API moved to', x);
});
const item = doc.itemSignal('i_api').value;
const childIds = doc.childrenSignal('p_main').value;
stop();
```

`doc.toJSON()` emits the compact portable document. `doc.toJSON({ compact: false })` keeps normalized defaults and geometry fields for a renderer or integration that needs a complete snapshot.

`itemSignal(id)` returns the current item or `undefined`. `fieldSignal(id, key)` observes one property. `childrenSignal(id)` returns immediate child IDs for a page or group. Values are frozen snapshots. Read the signal and write through `apply`. Do not assign the signal's value or mutate a snapshot. Updates from a committed batch are published together. A change to an unrelated property does not notify a field subscriber. Browser hosts can reach the same model through `board.model`.

## Read

| API                                          | Result                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| `board.read(scope?)`                         | Deep document copy. Scope is `doc`, `page`, `selection`, or `viewport`.     |
| `board.read({ scope, includeDrafts: true })` | Includes current draft properties.                                          |
| `board.toJSON(options?)`                     | Portable document, the same as `createDoc().toJSON(options?)`.              |
| `board.get(id)`                              | Deep item copy, or `undefined`.                                             |
| `board.query(selector)`                      | Matching item copies. Filters combine with AND.                             |
| `board.describe(options?)`                   | Deterministic text with IDs, labels, and optional relations and free space. |
| `board.changesSince(since, options?)`        | Committed session slices after that revision.                               |
| `board.revision`                             | Session transaction counter. Starts at 0.                                   |
| `board.kindsSince(since?)`                   | Built-in kinds added or last changed after that catalog version.            |
| `board.boundsOf(ids?)`                       | Content bounds `{ x, y, w, h }`. Without ids, marks are left out.           |
| `board.selection`                            | Selected item IDs.                                                          |

`query` accepts `kind` (string or string array), `text` (string or JavaScript `RegExp`), `within`, `inside`, `connectedTo`, `direction` (`in`, `out`, or `both`, default `both`), `data`, `hidden`, `locked`, and `page`. `text` matches `item.text.value`, `item.name`, and table cell text, with Markdown markers included. A string is a case-insensitive substring. `kind` arrays match any listed kind.

`describe` accepts `detail` (`brief`, `normal`, or `full`, default `normal`), `relations`, `freeSpace`, `maxItems` (default 100, maximum 10,000), `scope`, `page`, `selection`, `since`, and `overflowHint`. Empty pages include the line `An empty board, ready for your first idea.` When `since` is set, only items created, last written, or removed after that session revision are listed. An empty delta is `No changes since revision <since>.` Removed items are `removed <id>` or `removed <id> <kind>`. Normal and full lines include `, fill <color>` when set, and `, stroke <color>` and `, dash <dash>` when they differ from `ink` and `solid`; connection lines include stroke and dash after the route. Normal and full lines append `, by agent` when an `agent:` origin created the item in this session; later edits do not change the mark, and items that predate the session are never marked. A pending image reads `image (pending)`. A table reads `t1 table 4x3 header "Current point" "Next focus" ...`: columns × rows, then the first row, marked `header` or `first row`. Labels are printed as stored, so `md` labels keep their markers. Marks follow the connections in a `Marks:` section, one line each: `  m2: circle on notes "Exactly 1 trial run" at (x,y) w×h, stroke coral`; `brief` stops after the phrase, and a mark whose target is gone adds `(target missing)`. When more items match than `maxItems`, the last line is `<n> more items not listed: <count> near (<x>,<y>); ...`, followed by `Use query() or increase maxItems for detail.` only with `overflowHint: true` (the `board_describe` tool sets it). A headless `board_read` tool supports whole-document scope only. Narrow a headless document with `query` and `page` or `inside`. Ids, kinds, colors, and data keys that are not plain tokens (letters, digits, `_`, `.`, `:`, `#`, `-`) are JSON-quoted, so document text cannot add lines or fields.

`changesSince(since)` returns `{ cursor, since, changes }`. Filter with `origin` for an exact match, or `'agent'` for any `agent:` origin. A `since` older than the retained 500 slices returns `{ changes: [], truncated: true }`. `cursor` is the current `revision`.

`kindsSince(since?)` returns `{ version, since, kinds }`. Each kind is `{ kind, since, w, h, note }`. Omit `since` or pass `0` to list every built-in kind. Pass the last `version` you saw to get only kinds added or last changed after that number. `CATALOG_VERSION`, `KIND_CATALOG`, and `kindsSince` are also exported from `anniedrawing`, `anniedrawing/core`, and `anniedrawing/agent`. The catalog version is independent of the document format version. Custom host kinds are not listed.

Reads scoped to `page`, `selection`, or `viewport` include only media referenced by the returned items. Whole-document reads keep the complete media table. Scoped exports follow the same boundary, so exporting a selection does not include unrelated embedded images.

`board.getPointer()` returns a copy of the last human pointer: `{ x, y, pageId, inside, pointerType, ageMs, itemId }`, or `null` before a pointer is observed, after a page switch, or after destruction. Coordinates are page-space. While `inside` is true they follow pan and zoom; `itemId` is the topmost hittable item or `null`. Editor controls are excluded. Leaving, blur, hidden tabs, cancel, or touch release sets `inside: false` and preserves the last point. `ageMs` measures time since the last pointer event, not camera changes. Treat an outside point as historical; ask the user to point again when ambiguous. Pointer state is never serialized.

## apply

```ts
const result = board.apply(ops, {
  origin: 'agent:planner',
  label: 'Organize ideas',
  dryRun: false,
  merge: false, // fold into the previous history entry when origin and label match
  agentName: 'planner', // optional visiting-cursor label
  reveal: 'fit', // default: agentReveal for agent: origins; also 'created' or 'none'
  layout: 'auto', // agent: origins; 'none' or { direction, shape }
  presentation: { durationMs: 3000 }, // browser agent: batches; arrival length
  lenient: false, // skip invalid ops; default is all-or-nothing
});
// { ok, created, updated, removed, errors, warnings, moved?, skipped? }
```

`created`, `updated`, and `removed` are always arrays of item ids. `created` lists items the batch added, nested children included, that exist after it. `updated` lists items that existed before and still exist and that a `set`, `order`, or `reparent` in the batch named, including connectors detached from a removed target and images resized by a `media.set`; a `set` that changes nothing is not listed, `order` and `reparent` subjects always are, and items listed only in `moved` are not. `removed` lists items that existed before and do not exist after, including descendants of a removed group, children dropped by a `set` of `children`, and marks removed with their target. An item created and removed in the same batch appears in none of the three; one created and then edited appears in `created` only. Dry runs report what would happen. A failed batch returns empty arrays. `moved` lists existing items moved to make room, by an inserted step or by the agent layout.

Pass `expectedRevision` from the read that informed an edit to `apply` or `board_apply`. A mismatch returns `STALE_REVISION` without applying any operation, including in lenient or dry-run mode. Read again before retrying. This guards one session only: `load()` and `clear()` reset revisions.

Supported operations: `add`, `set`, `remove`, `order`, `reparent`, `page.add`, `page.set`, `page.remove`, `meta.set`, `media.set`, and `media.remove`. A batch is all-or-nothing unless `lenient: true`. Then failed operations go to `skipped` and the rest commit as one transaction. If nothing commits, `ok` is false and the document is unchanged. `set` merges `style`, `text`, and `data` one level deep. Do not change an item's ID. Add operations may provide IDs so later operations in the same batch can reference the new items. `add` also accepts `page`, `parent`, and `index`. `page.add` accepts `index`. `order.to` is `front`, `back`, `forward`, `backward`, or a numeric index.

`add.item.kind` accepts `rectangle` (stored `rect`) and `arrow` (stored `connector` with an end arrow and elbow route when those fields are omitted). `query({ kind: 'rectangle' })` and `query({ kind: 'arrow' })` match those stored kinds. Color strings `black`, `grey`, `gray`, `blue`, `light-blue`, `green`, `light-green`, `red`, `light-red`, `orange`, `yellow`, `violet`, and `light-violet` store the matching palette token. Connector `from` and `to` accept `{ item, side }`, `{ x, y }`, or a string item id (`{ item, side: 'auto' }`). `text` accepts a plain string on `add`, `page.add`, and `set`: it stores `{ value }`, and a `set` patch keeps the label's other fields, including `format`. `ItemSchema` validates stored items; `NewItemSchema` validates `add` input. Compact JSON writes tokens, structured endpoints, and label objects.

`agent:` nodes sent without `x`, `y`, or `place` are laid out together after the batch's operations run, from the arrows in the batch and the connectors to nodes already on the page: flows in ranked columns (arrows back to an earlier step do not rank), rejoining branches above and below the trunk, trees with each parent beside its children, a node with four or more unlinked neighbors in the middle of them, a pure cycle as a ring, chains linked by cross arrows on their own rows, and unconnected nodes in a grid. A first unconnected `text` in the batch titles the diagram, above its top-left corner. The layout picks left to right or top down, and wraps long flows, so the diagram reads at about 0.6 zoom in the viewport. `board.apply` passes the board's visible size as `viewport` for `agent:` origins; a headless document uses 1280×760 unless `viewport: { w, h }` is passed. Gaps follow `agentPlaceGap`, and a rank gap grows to fit an arrow label. A new diagram that links to nothing goes below or right of existing content, whichever reads larger, never into a hole in it. Nodes linked to existing ones are placed beside them. Existing nodes that an agent placed, and that no person or API call has moved or resized since in this session, may move along the flow to make room; `result.moved` lists them. Locked items, items in locked groups, and items a person moved stay. After `load()` or a new `createDoc(saved)`, every existing node stays fixed until an agent writes it again. Explicit `x`/`y`, or a `place` beside an item that existed before the batch, pins a node. A `place` (on the op or on the item) whose single relation `rightOf`, `leftOf`, `above`, `below`, or `near` names another add of the same batch is a hint, not a pin, and may name an add that comes later in the batch. The node joins the layout; a hint between two nodes that an arrow path already joins is ignored, and otherwise the two end up side by side on the stated side with `place.gap` and `place.align`, or the gap per-node placement would use, so text lines chained with `below` in one batch stay a tight column. A hinted chain is not ranked or wrapped. A node placed beside a same-batch item that is itself pinned, or that is not a layout node, is placed per node once that item has its position. `inside` is never a hint, and `layout: 'none'` and other origins keep per-node placement, where a forward reference still fails. A reference that is neither on the page nor added by the batch rejects the add with `INVALID_OP`. An item that is not a layout node and is placed relative to a node the layout moves follows that node, and the layout does not reserve its slot, so `OVERLAPS_EXISTING` can report a collision. Nodes are every kind except `connector`, `line`, `path`, `group`, `mark`, and hidden items. `layout: 'none'` (or `agentLayout: 'none'`) places node by node instead: right of the first source already on the page, otherwise left of the first such target, and an unconnected node whose default spot would cover existing work goes right of the page content. `layout: { direction: 'right' | 'down', shape: 'flow' | 'tree' | 'radial' | 'ring' }` turns off the automatic detection: `direction` fixes the ranked direction, `flow` forces ranked layers left to right, `tree` ranked layers top down, `radial` the most connected node in the middle, and `ring` the nodes on a ring in arrow order. `user` and `api` adds are never laid out. Send nodes and their arrows in one batch and omit coordinates unless the position matters.

`place` requires exactly one of `rightOf`, `leftOf`, `above`, `below`, `inside`, or `near`. Default `gap` is 32 (`agentPlaceGap` when origin starts with `agent:` and `gap` is omitted). When a `text` item is placed `rightOf`, `leftOf`, `above`, or `below` another `text` item and the caller omits `gap`, the gap is one line of the larger text (`ceil(1.35 × font size)`, 25 at the default size), for any origin. Default `align` is `middle`. An `agent:` add that omits `place` uses a single `place` on the item, keeping `gap` and `align` when they are valid. A labeled `rect`, `ellipse`, `diamond`, `note`, or `text` that covers a similar label already on the page is placed `rightOf` that label, so repeated coordinates do not stack flowchart steps. The smaller area must be at least 40% of the larger, and the overlap at least half of the smaller box. A much smaller shape inside a larger one keeps the coordinates that were sent. `inside` requires a `group` and finds a free slot; it fails if the group is full. `near` searches rings around the reference. `rightOf` / `leftOf` / `above` / `below` slide further along that axis when the first slot is occupied. An `agent:` add instead reads the arrows in the same batch: a node that flows between the reference and the occupant is inserted there and the occupant with everything downstream of it moves over by the node's size plus the gap (`result.moved` lists the moved ids; locked items, and groups that hold locked work, stay; a locked occupant makes the node stack beside it instead), a node that follows the occupant goes past it, and an unconnected node stacks beside it. Omitted `w` and `h` use the built-in default size for that kind, except that images and tables take their size from their content (see [Labels, tables, images, and marks](#labels-tables-images-and-marks)). An `agent:` create or text patch on `rect`, `ellipse`, `diamond`, `note`, or `text` grows that size so the label fits, and an agent `text` sent without `h` stores the height of its lines. Standalone `text` defaults to 600 wide. A larger explicit size is kept. Agent-created `rect`, `ellipse`, `diamond`, and `note` items with no explicit fill get varied palette tints, stored once so save/reload and undo keep them. Explicit fills, including `none`, stay unchanged. An `agent:` connector that omits `route` stores `elbow`. Automatic elbows leave and enter on the sides where their nodes face each other, spread connectors that share a side in the order of their far ends, keep 16 px from other nodes and 12 px from other lanes when they can, and send a loop back under its row. Only the first-choice side is spread: a connector that falls back to another side attaches at its center, and automatic ends are not spread around explicit `side` ends or on rotated nodes and custom outlines. Connector labels sit on the longest segment of the route that covers no node, label, or other connector, or on the least covered spot; routes do not move for labels. Explicit sides, anchors, and waypoints stay as written. Straight and curve routes stay as written.

A failed batch returns `ok: false` and changes nothing. Its `errors` use these codes:

| Code               | Meaning                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `READONLY`         | The board or document is read-only.                                                                                                                      |
| `BATCH_LIMIT`      | `ops` is not an array, or it has more operations than the origin allows.                                                                                 |
| `INVALID_DATA`     | The batch is not plain JSON data: a circular value, a class instance, or an unsafe key.                                                                  |
| `INVALID_OP`       | An operation failed validation or could not apply, such as a missing id or parent, a table cell key outside the table, or a mark without a valid target. |
| `INVALID_DOCUMENT` | The operations applied, but the resulting document would be invalid.                                                                                     |
| `STALE_REVISION`   | `expectedRevision` does not match the current session revision.                                                                                          |
| `LOCKED`           | A browser `user` edit touches a locked item. Lenient batches skip it instead.                                                                            |

`runTool` returns `{ ok: false, error: { code, message } }` for a call it cannot run: `UNKNOWN_TOOL`, `INVALID_INPUT` (arguments fail the tool schema), `UNSUPPORTED_SCOPE` (a headless `board_read` scope other than `doc`), `BROWSER_REQUIRED` (`board_snapshot` or `board_view_fit` on a headless document), or `TOOL_FAILED`.

`result.created` is the stored ids for that batch. Warnings do not roll back:

| Code                | Meaning                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OVERLAPS_EXISTING` | A new item, or one moved to make room, overlaps another item on its page.                                                                                                                              |
| `ID_REMAPPED`       | An `agent:` create reused an id. Stored as `id_1`, then `_2`. Same-batch refs, including a mark's `target`, follow it. `get` with the id you sent returns the older item. User/API origins still fail. |
| `LAYOUT_FAILED`     | The agent layout stopped with an error. The batch committed with its nodes where they were created.                                                                                                    |

`merge: true` appends to the last history entry when that entry has the same `origin` and `label`. Each committed apply still increments `revision` once. History keeps at most 100 entries. The session log keeps 500 slices.

```ts
board.undo(); // returns whether anything changed
board.undo({ origin: 'agent:planner' });
board.redo();
board.load(nextDocument); // replaces the document and resets history and session revision
board.clear(); // empty default document; resets history and session revision
board.select(['i_one']);
board.isLocked('i_one'); // includes locks on ancestors and descendants
board.setTool('rect');
board.setPage('p_main');
board.setTheme('dark'); // also 'light' | 'auto'
board.setGrid(false);
board.focus();
board.add('rect'); // toolbar-sized item at the view center
board.duplicate();
board.group();
board.ungroup();
board.align('left'); // also center, right, top, middle, bottom, horizontal, vertical
await board.addImage(file); // PNG, JPEG, GIF, WebP, or AVIF; under 10 MB
await board.setHref(id, 'https://example.com'); // video or link href
board.editText('i_table', [1, 2]); // open the editor on a label, or on a table cell
```

`board.add`, `board.addImage`, and `board.setHref` are editor helpers. They commit through `apply` with `origin: 'user'`. Agents should call `apply` directly. `setHref` keeps the item kind: a video still needs a YouTube or Vimeo URL. A link card refreshes its fallback title and may unfurl, matching paste. `align` modes `horizontal` and `vertical` distribute spacing. `addCleanup(fn)` runs when `destroy()` runs.

`readonly` rejects saved mutations. Locks prevent interactive item edits, including keyboard commands, erasing, and context actions. `board.isLocked(id)` is true if the item, an ancestor, or a descendant is locked. A mixed selection stays protected until unlocked. `board.updateSelection({ locked: false })` clears the locks that affect that selection in one history entry.

Browser `apply` batches with `origin: 'user'` reject protected item mutations atomically with `LOCKED`. Unlock-only patches are allowed. Other programmatic origins and the headless model may still edit locked items. Locks do not restrict page management or undo and redo. An `origin` label is provenance. It is not authentication. `load()` and `clear()` replace the document and reset session revision. Use small operations for ordinary edits.

`board.pageId` is the active page ID. `board.setPage(id)` switches pages. To create a page and add content to it in one batch:

```ts
board.apply([
  { op: 'page.add', page: { id: 'p_planning', name: 'Planning', items: [] } },
  {
    op: 'add',
    page: 'p_planning',
    item: { id: 'i_plan', kind: 'note', text: { value: 'Next steps' } },
  },
]);
board.setPage('p_planning');
```

A browser text item with `autoWidth: true` measures its plain text when it is added, when its text is set through `apply`, or when a text edit commits. `agent:` creates of `text` set `autoWidth` when it is omitted. Measurement uses a hidden DOM measurer and cache. The resulting width and height are saved in the document. A headless document keeps stored or grown dimensions and does not measure fonts. The default omitted size is 600×48; an agent `text` sent without `h` stores the height of its lines instead.

## Labels, tables, images, and marks

Labels on `rect`, `ellipse`, `diamond`, `note`, and `text` accept `text.format: 'md'`:

```ts
board.apply([
  {
    op: 'add',
    item: {
      kind: 'note',
      text: { value: '# Plan\n- **Draft** the outline\n- *Review* it\n1. Ship', format: 'md' },
    },
  },
]);
```

`md` renders `**bold**`, `*italic*`, `- ` and `1. ` list items with a hanging indent, and `# ` / `## ` headings at 1.5 and 1.25 times the item's text size. Anything else is shown as written, including `### `, `* item`, indented markers, links, code, and HTML; a run of three or more `*` stays literal, and lists do not nest. The default `plain` renders as before. `get`, `query`, `describe`, and JSON return the source with its markers. A string `text` patch keeps `format`; send `text: { format: 'plain' }` to switch back. Connector labels stay plain. Agent creates size `md` labels for their structure, and browser `autoWidth` text measures it. Double-clicking an `md` label edits the source with its markers visible. The stage renders one `div.annie-line` per source line with `data-ad-line` set to `p`, `h1`, `h2`, `ul`, or `ol`, bold runs as `strong`, and italic runs as `em`; it never assigns markup. The accessible name is the visible text without markers. SVG export keeps the hanging indent for start-aligned lists only. There is no inspector control to switch a label to `md`.

A `table` stores `rows` (an array of rows of cell strings) and an optional `header` (the first row is bold on a tinted band):

```ts
board.apply([
  {
    op: 'add',
    item: {
      id: 'i_table',
      kind: 'table',
      header: true,
      rows: [
        ['Current point', 'Next focus'],
        ['Draft', 'Reports'],
      ],
    },
  },
  { op: 'set', id: 'i_table', patch: { cells: { '1,1': 'Charts' } } },
]);
```

Omit `w` and `h`: the size comes from the text, with each column growing to its longest line up to 260 px and longer cells wrapping. A larger explicit size is spread over the columns and rows; a narrower width wraps more, and the height never drops below what the text needs. Ragged rows are padded with empty cells. `set { rows }` replaces the content, and `set { cells: { 'row,column': text } }` changes single cells, counted from 0 with the header as row 0. `cells` is operation input only: the stored item and the change log carry `rows`. A key outside the table rejects the operation; `cells` on another kind fails, and a table without `rows` fails. Undo restores rows and size together. Cells are plain text, with no `md`, per-cell style, or merged cells. The background is `style.fill` (default `paper`), and the border is `style.stroke`. Double-click a cell to edit it: Ctrl/Cmd+Enter or clicking away saves one undo step, Escape cancels, Tab and Shift+Tab save and move, and Enter inserts a line break. While a cell is being edited, longer text can spill past the cell until it is saved. Readonly boards and locked tables do not open the editor. Cells carry `data-ad-cell="r,c"` and header cells `.annie-cell-head`; the item's label is `Table, 4 columns, 3 rows: <header cells>`. SVG export wraps cells by the size estimate, so exported line breaks can differ from the board within the same columns. There is no toolbar control to create a table or add rows or columns.

An `image` added without `w` and `h` is sized from its media to fit 480×360 without enlarging; with only `w` or only `h`, the other side follows the aspect ratio. A `media.set` earlier in the same batch counts. Such an image stores `fitMedia: true`; when media is replaced under its key, it keeps its width and takes the new aspect ratio in the same history entry, and an explicit `w` or `h` in a later `set` clears the marker. Images with an explicit size keep it. Replacing media under an existing key updates every item that uses it and creates nothing, so there is no arrival. Only top-level `add` items are sized this way, not `page.add` items or group children.

An image whose picture does not exist yet can be pending:

```ts
board.apply([
  {
    op: 'add',
    item: { id: 'i_photo', kind: 'image', pending: true, name: 'Team at a whiteboard' },
  },
]);
board.apply([{ op: 'set', id: 'i_photo', patch: { progress: 0.5 } }]);
board.apply([
  { op: 'media.set', id: 'm_photo', media: { mime: 'image/jpeg', w: 1536, h: 1024, src: dataUrl } },
  { op: 'set', id: 'i_photo', patch: { media: 'm_photo', pending: false } },
]);
```

`pending: true` makes `media` optional. The board shows a shimmer (static under reduced motion), the item's `name`, and a progress bar while `progress` (0 to 1) is set; the item has `aria-busy="true"` and can be selected, moved, and connected. A pending image sent without `w` and `h` is 240×180 and takes the picture's aspect ratio when it resolves. Resolve it in one batch, as above, so the id and bound connectors stay. `progress` stays stored after it resolves and is ignored. Exports draw a pending image as a labeled placeholder, with a progress bar when `progress` is set. To give up, remove the item. A document with a pending image cannot be loaded by 0.7.0.

A remote image that fails to load shows "Image unavailable". `board.on('media', ({ id, media, status }) => ...)` reports `loaded` or `error` each time an image item's picture finishes on the board, including after a swap or a theme repaint. Pending images do not fire it.

A `mark` draws emphasis on another item and takes its geometry from that `target`:

```ts
board.apply([
  { op: 'add', item: { kind: 'mark', target: 'i_note', mark: 'circle' } },
  { op: 'add', item: { kind: 'mark', target: 'i_note', match: 'Draft' } },
]);
```

`mark` is `highlight` (default), `underline`, `circle`, or `box`. `match` marks the first occurrence of that phrase in the target's visible text (without `md` markers); without `match`, or when the phrase is not found, the mark covers the whole item and keeps its `match` for when the phrase returns. A phrase that wraps is highlighted or underlined line by line; a circle or box surrounds all of it. A highlight on a phrase, or on a whole `text` item, is a marker band behind the text. A highlight on any other whole item is a band around it, 8 px wide and 6 px outside its outline, so the item keeps its own fill and its label keeps its contrast. A highlight uses `style.fill`, then `style.stroke`, then `amber`; the others use `style.stroke` (default `coral`), `style.strokeWidth` (default 2.5), and `style.dash`. The target must be an existing item on the same page that is not a mark or a connector; otherwise the operation fails with `INVALID_OP`, and a connector cannot attach to a mark. `x`, `y`, `w`, and `h` are stored as 0, and `rotation` and `place` are ignored. A mark follows its target as it moves, resizes, rotates, and re-wraps. On the board the phrase is measured from the rendered label; exports use the exporter's wrapping, which can differ from the browser's. Removing a target removes its marks in the same operation, and undo restores both. A `set` that replaces a group's `children` and drops a target does not: the mark stays without a target, draws nothing, and `describe()` prints `(target missing)`. Pasting a copied mark without its target fails that paste. Marks never take space: placement, layout, overlap warnings, routing, group bounds, and `view.fit()` ignore them. A highlight does not catch the pointer. An underline, circle, or box can be selected by its stroke and deleted with Delete; it shows an outline without handles and cannot be moved, resized, rotated, or given text. Marks on a single table cell are not supported.

## Agent origin presentation

A successful `board.apply` with an `agent:` origin gives newly created items a short visual arrival. A lilac cursor enters from outside the board, visits the first on-screen shapes one after another, then reveals the rest together, including connectors and items outside the viewport. Each visited item fades in with a small scale change, then the cursor leaves. It has no name unless `apply` passes `agentName` or `createBoard` set `agentName`. Groups reveal their children together. Connectors fade without scaling their page-space paths. After eight visible non-connector stops (`agentPresence.maxStops`), or when no further on-screen shapes remain, the rest of the batch appears together. Consecutive additions share one cursor. A mark arrives with the normal fade, and the cursor stops on the marked phrase.

When the arrival finishes, the camera reveals the batch according to `reveal` (default `agentReveal` for `agent:` origins, `'none'` otherwise):

- `'fit'`, the `createBoard` default, fits all content on the current page, including earlier batches and partially clipped items. It is instant.
- `'created'`, the `createFellowBoard` default, does nothing when every created item is fully in view and the zoom is at most 1. Otherwise it flies (280 ms, instant under reduced motion or in a hidden tab) to the created items plus the items their new connectors attach to, at a zoom between `agentRevealMinZoom` and 1. Work too large for that floor shows its top-left part. Neighbors reached only by older connectors are not framed.
- `'none'` leaves the camera still.

Both reveals move the camera only while `board.view.follow` is true. Camera input by the person (wheel, pinch, hand tool, Space-drag, zoom keys, and the built-in zoom and fit controls) sets it to false. A reveal skipped that way is remembered, and setting `view.follow = true` moves to it.

`board.on('presented', ({ ids, origin }) => ...)` fires once per successful `agent:` batch that created items, with that batch's `result.created` ids, when its arrival ends. Under reduced motion, in a hidden tab, or with `agentPresence: false` it fires right after `apply` returns, in a microtask, so a listener can call `apply` again. It does not fire for dry runs, failed batches, other origins, or batches that created nothing. When batches overlap, their events follow the cursor walk, not apply order.

`agentPresence.write` writes the labels of created items left to right, line by line, with the cursor shown as a pen, instead of fading them. `write: { charsPerSecond }` sets the speed (default 30, from 5 to 400); each label takes its length divided by that speed, from 160 ms to 10 s, times `durationScale`. Standalone `text` is written without a fade; a labeled `rect`, `ellipse`, `diamond`, or `note` fades in, then its label is written. Connector labels, items without labels, rotated items, and items off screen when the cursor reaches them fade as before. Written items are always stops and do not count toward `maxStops`, so with `write` on and no `durationMs` a batch with many labels takes as long as the writing needs. Writing reveals text with a clip; the DOM text, the document, exports, and history are complete from the first frame, and screen readers get the whole label at once. Editing, moving, resizing, or removing an item while it is written ends its writing on the current state; so does a theme change. `presented` fires when the last label is written. Writing is off by default, including in `createFellowBoard`.

`presentation: { durationMs }` (0 to 60000) on an `agent:` batch sets the time from the start of that batch's arrival to its `presented` event. The time is shared over the batch's stops by text length; without `write`, it stretches or shortens the existing cursor walk. The clock starts when the cursor reaches the batch, which is later than `apply` when an earlier batch is still arriving, and `presented` can land a few frames after the target. It is ignored by headless documents, other origins, dry runs, failed batches, batches that create nothing, `agentPresence: false`, reduced motion, and hidden tabs.

The operation is synchronous and atomic. `get`, `read`, exports, and history contain the complete result immediately. Temporary presentation state is not written to the document. Failed batches, dry runs, ordinary user or API edits, existing-item updates, and headless operations do not animate. A batch that is entirely outside the viewport, or on another page, does not summon a cursor. Off-screen items in a mixed batch stay hidden until the remaining items appear together. An immediate `board.view.fit()` after `apply` uses the new viewport for the arrival.

The cursor ignores pointer events. Selection, focus, and the person's native cursor stay intact. Clicks, pans, zoom, and edits continue while the walk is running; pending items are not hittable. The camera is sampled each frame so the cursor stays on the placements. Removing those items, changing page, replacing the document, and destroying the board drop the presentation. Reduced-motion preferences and background tabs show the committed items immediately. Pass `agentPresence: false` to `createBoard` to opt out.

## Editor chrome

The built-in toolbar shows select, hand, eraser, then Shapes, draw, text, sticky note, and image. Shapes groups rectangle, ellipse, diamond, line, and arrow. On phones, including landscape, hand moves into the AnnieDrawing menu so the bottom bar stays tappable, unless that menu is hidden. Pages, zoom, undo, redo, and Export move into Board controls at the top right. A short desktop host keeps the sidebar centered. When the AnnieDrawing menu or page chips are present, icons and padding tighten at 640px host height. Without those bars, 640px reduces the left inset and uses a middle tool size; tools fully shrink at 500px. That menu also opens appearance, document actions, documentation, and the GitHub repository, and shows the package version. Export downloads the current page. Hosts choose PNG, SVG, and AnnieDoc (`json`); an imported board defaults to PNG and SVG. Page chips in the bottom bar switch pages. `+` adds a page. All pages appears when the chips overflow. The active page stays visible. Right-click a page chip to rename or delete that page. The last page cannot be deleted. Arrow keys, Home, and End navigate page tabs. The zoom percentage opens zoom controls.

Selecting an item opens a compact inspector for that item type. Fill, Line, and Opacity share one row. Color replaces fill and line on plain text. Fill, line, and text color open a palette. Text-capable shapes, including empty ones, show Text (S/M/L/XL), Align, and Font on their own rows. Font choices are Friendly (`sans`), Serif, Mono, and Handwritten (`hand`, the default). Stroked shapes also get line weight (1, 2, 4, or 8) and Pattern (solid, dashed, or dotted) on separate rows. Open freehand paths omit pattern. Sticky notes keep fill and text controls and omit line color, weight, and pattern. Images, videos, and link cards omit line and text controls. A selected video offers Edit Video URL; a selected link card offers Edit URL. Opacity opens a 0-100% slider; the document stores opacity as 0-1. The lock icon beside Delete locks or unlocks the selection. Connector route and arrowhead controls appear for a selected connector. More arrangement options opens align, distribute, group, ungroup, and stacking. Deselect to hide the inspector. The inspector does not expose `fillMode: 'hatch'`; set that through `apply`.

Select a shape and press Enter, double-click it, or double-tap it on a touchscreen to edit its text. An `md` label shows its markers while it is edited. Double-clicking a table edits the cell under the pointer; Enter opens its first cell. Marks never open an editor. Double-click a YouTube or Vimeo player, or an HTML item, to use its controls. Click the board or press Escape to drag it again. Link cards keep an Open button that always works. Press and hold an item, or right-click it, to select it and open its actions. The anchored context menu offers Edit text where supported, Edit Video URL or Edit URL for those items, Bring to front, Send to back, Duplicate, and Delete, all for the clicked item. Shift+F10 opens the selected item's menu. Escape dismisses it. Click, tap, or focus a locked item to select it. Its editing controls and context actions are gray and disabled. Unlock and Deselect remain available in the inspector. A readonly board disables saved changes, including unlocking.

Pasting a single `http(s)` URL creates a specialised item. YouTube and Vimeo become a `video` player. Image URLs become an `image`. Other sites become a `link` card with title, description, and an Open control. The card is created immediately from the URL. The browser may then fetch that page, without credentials, for Open Graph title, description, and image. That fetch skips loopback, private-network, IPv4-mapped, and NAT64 hosts, and checks each redirect hop the same way before following it; a link that redirects to another site keeps its fallback card. Preview images must pass the same check. Pass `unfurl: false` to skip the fetch, or pass a function when the host has its own preview source. Agent operations do not fetch. Dropping the same URL text onto the board follows the same rules.

Position and rotation follow the pointer. Shift constrains movement to one axis or keeps resize proportions. Alt resizes from the center. Pinch to zoom, or use the hand tool to pan on a touchscreen. A displayed grid is a visual reference.

## Keyboard

These shortcuts apply while the board is focused.

| Action                         | Keys                                        |
| ------------------------------ | ------------------------------------------- |
| Select / hand                  | V / H                                       |
| Rectangle / ellipse / diamond  | R / O / D                                   |
| Arrow / line / draw            | A / L / P                                   |
| Text / sticky note / eraser    | T / N / E                                   |
| Pan                            | Hold Space and drag                         |
| Fit drawing / actual size      | 2 / 1                                       |
| Zoom in / out                  | + / = / -                                   |
| Select all visible unlocked    | Ctrl or Command + A                         |
| Edit / finish text             | Enter / Ctrl or Command + Enter             |
| Undo / redo                    | Ctrl/Command + Z / Shift+Z or Y             |
| Copy / cut / paste / duplicate | Ctrl or Command + C / X / V / D             |
| Group / ungroup                | Ctrl/Command + G / Ctrl/Command + Shift + G |
| Nudge / larger nudge           | Arrow keys / Shift + arrow keys             |
| Move backward / forward        | [ / ]; hold Shift for back / front          |
| Delete selection / cancel      | Delete or Backspace / Escape                |

## Camera and events

```ts
board.view.fit(); // current page content
board.view.fit(['i_one']);
board.view.flyTo({ x: 0, y: 0, w: 800, h: 600 });
board.view.zoom = 1;
board.view.center = { x: 300, y: 200 };
board.view.follow = false; // stop agent reveals from moving the camera
board.view.viewport; // { x, y, w, h } visible, in page coordinates
board.view.toScreen(board.boundsOf(board.selection)); // board pixels
board.view.toPage({ x: 40, y: 40 }); // page coordinates

const unsubscribe = board.on('change', ({ ops, inverse, origin, label, revision }) => {
  console.log(origin, label, revision, ops);
});
unsubscribe();
board.on('follow', (following) => followButton.toggleAttribute('hidden', following));
board.on('presented', ({ ids }) => speakNext(ids));
```

`view.toScreen(pointOrBox)` and `view.toPage(pointOrBox)` return the same shape they receive, in pixels from the board's top-left corner (the host's content box). To anchor a popover to the selection, convert `board.boundsOf(board.selection)` and update it on `select` and `view`. `view.viewport` is the visible page box, the same one `export({ scope: 'viewport' })` uses.

`view.follow` starts `true`. A `user` camera change sets it to `false` and emits `follow`. Setting it emits `follow`, and setting it to `true` moves to the last agent reveal target. `view.fit()`, `view.flyTo()`, and the `zoom` and `center` setters do not change it; when your own controls move the camera for the person, set `view.follow = false` as well. There is no public way to report a camera change as `user`.

Events are `change`, `select`, `view`, `follow`, `presented`, `media`, `tool`, `page`, and `save`. `view` reports `{ x, y, zoom, cause }`: `cause` is `user` for direct input and the built-in zoom and fit controls, `api` for `view` calls, `agent` for reveals, and `resize` when the host element changes size. `follow` reports the new boolean. `presented` and `media` are described above. `ViewEvent`, `ViewCause`, and `MediaLoadEvent` are exported types. A change describes one committed transaction. `save` reports autosave as `{ status, message?, resolve? }` with status `saving`, `saved`, `error`, or `conflict`. A conflict means the stored drawing changed elsewhere, in another tab or in a save found after local edits began; nothing is written until `resolve('load')` opens the stored drawing or `resolve('keep')` saves this one over it. An idle tab follows another tab's saves and keeps its camera and page. An unreadable stored drawing is copied to `<key>#unreadable-<time>` in the same store before new work is saved. The built-in UI shows errors and conflicts until a save succeeds. Camera, selection, and pointer drafts are local view state. They do not become drawing items.

## Export

```ts
const json = await board.export('json', { scope: 'doc' });
const svg = await board.export('svg', { scope: 'page', padding: 32 });
const png = await board.export('png', {
  scope: 'viewport',
  scale: 2,
  labels: true,
  colors: 32,
  maxBytes: 245760,
});
const jpeg = await board.export('jpeg', {
  maxSide: 1280,
  maxBytes: 245760,
  labels: true,
  onWarning: (warning) => console.warn(warning.message), // { code: 'IMAGE_UNAVAILABLE', id, media, message }
});
const portable = await board.export('svg', { embedImages: true });
```

PNG, JPEG, and WebP export fetch each remote image used by the exported items, with CORS, and embed it before rasterizing. Only media already in the document's media table is fetched. The image host must send `Access-Control-Allow-Origin`; otherwise that image is drawn as a dashed placeholder box with its `name`, and `onWarning` is called once per item with `IMAGE_UNAVAILABLE`. A throwing `onWarning` does not stop the export. The fetched bytes are not decoded first, so a host that answers with a non-image body leaves an empty area. SVG export keeps remote `href`s unless `embedImages: true`. Pending images export as labeled placeholders and do not warn. Hidden items are not fetched, but children of a hidden group are. `ExportWarning` is an exported type.

The Export control downloads the current page, even when items are selected. Which formats it offers is `ui.export` on `createBoard`: PNG and SVG by default, AnnieDoc when the host includes `'json'`, or hidden when `export` is `false`. One listed format downloads on click; two or more open a menu. Programmatic `export` accepts `'json'`, `'svg'`, `'png'`, `'jpeg'`, and `'webp'`, even when the control hides a format. It defaults to `scope: 'page'`. Raster output defaults to 2× resolution. Pass `scale`, `maxSide`, `maxBytes`, `quality` (JPEG/WebP, default 0.85), and PNG `colors` (2–256, indexed palette) to budget a raster. A missed `maxBytes` budget still returns the smallest blob; it does not throw. PNG with `labels: true` defaults to 32 colors and `maxBytes: 245760`. PNG with `maxBytes` and no `colors` tries a 32-color indexed encoding before shrinking the scale. JSON and SVG return strings. Rasters return a Blob. `labels` adds item IDs for vision workflows. Rasterization uses an offscreen canvas. The editor's drawing surface is HTML and SVG. Custom HTML cannot be assumed to rasterize identically across browsers. Prefer explicit custom SVG output for portable exports. Video and link items export as still cards with title and URL; SVG also wraps the card in the stored `http(s)` link. They never write an iframe or `foreignObject`. Headless documents reject raster export.

Operation limits are exported as `LIMITS` from `anniedrawing/agent` and `anniedrawing/core`: at most 1,000 operations per API or agent batch (including at most 1,000 created items across nested children), up to 50,000 operations for a local `user` batch (`LIMITS.maxItems`), 50,000 items per document, coordinate magnitude 1,000,000, 100,000 text characters, nesting depth 32, JSON data nesting 104 (`LIMITS.maxJsonDepth`), 100 history entries (`LIMITS.maxHistory`), 500 session log slices (`LIMITS.maxSessionLog`), 100,000 path points, 20,000,000 characters per media source, and tables of at most 200 rows (`LIMITS.maxTableRows`), 50 columns (`LIMITS.maxTableColumns`), and 2,000 characters per cell (`LIMITS.maxCellLength`). `VISION_PNG` is `{ colors: 32, maxBytes: 245760 }`, the labeled snapshot default. These are validation ceilings. They are not a promise that every maximum-size document stays fast. Read the runtime exported values before building UI around them.

## Theming

The board reads these CSS custom properties. Set them on the element that holds the board, with an inline style or any stylesheet rule on that element. They are inherited and win over the light, dark, and auto defaults without extra specificity. Setting them on `.annie-root` also works. They are a supported contract; internal class names are not.

| Token                      | Default                                                                                                                                                        | Used for                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `--ad-ui-accent`           | `#05d9ab`                                                                                                                                                      | Primary button (Export), brand mark, text editing outline, link card button, custom handles.                                                 |
| `--ad-ui-accent-soft`      | The accent with transparency: about 15% for pressed and selected backgrounds, 19% for the pressed tool, 9% for the marquee fill                                | Pressed and expanded buttons, pressed tool, pressed menu option, selected page tab, marquee fill.                                            |
| `--ad-ui-accent-strong`    | `#04c49a` hover, `#00876c` marquee stroke, `#05b48f` focus ring and range inputs; `color-mix(in srgb, <accent> 80%, #000)` when the host sets `--ad-ui-accent` | Primary button hover, marquee stroke, focus rings, range inputs, light-theme selection outline.                                              |
| `--ad-ui-accent-fg`        | `#103639`                                                                                                                                                      | Text and icons on the accent (Export button, brand mark).                                                                                    |
| `--ad-ui-accent-strong-fg` | `--ad-ui-accent-fg`                                                                                                                                            | Text and icons on the strong accent (the hovered Export button). Set it when the accent foreground does not contrast with the strong accent. |
| `--ad-focus`               | The strong accent in the light theme; in the dark theme `--ad-ui-accent-strong` when set, otherwise the accent                                                 | Focus rings, item focus outline, selection outline and handles.                                                                              |
| `--ad-header-inset-start`  | `0px`                                                                                                                                                          | Extra space at the header's start edge, added to the normal offset.                                                                          |
| `--ad-header-inset-end`    | `0px`                                                                                                                                                          | Extra space at the header's end edge (right in left-to-right layouts), for example to keep a corner free.                                    |

```js
host.style.setProperty('--ad-ui-accent', '#7c3aed');
host.style.setProperty('--ad-ui-accent-fg', '#fff');
host.style.setProperty('--ad-header-inset-end', '120px');
```

Setting `--ad-ui-accent` alone recolors the Export button, brand mark, pressed tools, selected page tab, focus rings, marquee, range inputs, selection outline, and text editing outline in every theme. With no host tokens the editor looks as in 0.7. The library no longer declares `--ad-ui-accent` or `--ad-focus` itself. The selection handle hover uses a 40% tint of a host accent and has no token of its own. Other `--ad-*` variables used by the stylesheets (`--ad-ui-bg`, `--ad-ui-surface`, `--ad-paper`, and so on) are not part of this contract; they are still declared per theme on `.annie-root`, so a host value for them loses to the dark theme defaults.
