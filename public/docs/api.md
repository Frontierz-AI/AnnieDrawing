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

Use Node.js 24 or newer to develop this repository and to install it from git. The published library is ES2022. Browser hosts need Pointer Events, SVG, ResizeObserver, and `structuredClone`. All JavaScript exports are ESM.

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
  agentReveal: 'fit', // 'none' skips the post-arrival camera fit
  agentPlaceGap: 32, // default place.gap for agent: origins
  agentPresence: true, // or { maxStops, durationScale }
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

| Option         | Default         | Meaning                                                                                                     |
| -------------- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| `theme`        | `'light'`       | `'light'`, `'dark'`, or `'auto'` (follows `prefers-color-scheme`). Change later with `setTheme`.            |
| `ui`           | `true`          | `false` omits editor chrome. An object keeps the tools and sets the header.                                 |
| `ui.menu`      | `true`          | AnnieDrawing control: open a drawing, grid, appearance, documentation, GitHub, and the package version.     |
| `ui.export`    | `['png','svg']` | `false` hides Export. `'png'`, `'svg'`, and `'json'` (AnnieDoc `.annie`). One format downloads immediately. |
| `ui.pages`     | `true`          | `false` hides page chips. `page.add` and `setPage` still work.                                              |
| `exposeGlobal` | `false`         | `true` registers the board on `window.__anniedrawing`. The local demo sets this.                            |

`ui: true` is the same as `{ menu: true, export: ['png', 'svg'], pages: true }`. Two or more export formats open a menu. The local demo passes `export: ['png', 'svg', 'json']`. Programmatic `board.export()` still supports JSON, SVG, PNG, JPEG, and WebP even when the Export control hides a format.

`createFellowBoard(host, { fellowName, theme, ... })` from `anniedrawing/fellow` applies embed defaults. Explicit options override them.

`createDoc(initial?, { readonly?, allowedImageOrigins?, sanitizeHTML?, kinds?, agentHistory?, agentPlaceGap? })` provides the model without creating DOM nodes. `allowedImageOrigins` gates remote images on non-`user` origins. User paste, import, and `load()` are not gated. `sanitizeHTML` is required to render HTML as HTML and must strip a script/event-handler probe. It returns `apply`, `get`, `query`, `describe`, `kindsSince`, `changesSince`, `toJSON`, `undo`, `redo`, `load`, `clear`, `on`, `revision`, `canUndo`, `canRedo`, `itemSignal`, `fieldSignal`, and `childrenSignal`. `anniedrawing/core` also exports `applyDraft`, `translateItem`, `copyItems`, `detachMissingEndpoints`, `allItems`, and `clipboardText` for hosts that implement clipboard or preview layers. `applyDraft` merges nested `style`, `text`, and `data`. `clipboardText` reads the first non-comment `text/uri-list` line, then `text/plain`.

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
| `board.get(id)`                              | Deep item copy, or `undefined`.                                             |
| `board.query(selector)`                      | Matching item copies. Filters combine with AND.                             |
| `board.describe(options?)`                   | Deterministic text with IDs, labels, and optional relations and free space. |
| `board.changesSince(since, options?)`        | Committed session slices after that revision.                               |
| `board.revision`                             | Session transaction counter. Starts at 0.                                   |
| `board.kindsSince(since?)`                   | Built-in kinds added or last changed after that catalog version.            |
| `board.boundsOf(ids?)`                       | Content bounds `{ x, y, w, h }`.                                            |
| `board.selection`                            | Selected item IDs.                                                          |

`query` accepts `kind` (string or string array), `text` (string or JavaScript `RegExp`), `within`, `inside`, `connectedTo`, `direction` (`in`, `out`, or `both`, default `both`), `data`, `hidden`, `locked`, and `page`. `text` matches `item.text.value` and `item.name`. A string is a case-insensitive substring. `kind` arrays match any listed kind.

`describe` accepts `detail` (`brief`, `normal`, or `full`, default `normal`), `relations`, `freeSpace`, `maxItems` (default 100, maximum 10,000), `scope`, `page`, `selection`, and `since`. Empty pages include the line `An empty board, ready for your first idea.` When `since` is set, only items created, last written, or removed after that session revision are listed. An empty delta is `No changes since revision <since>.` Removed items are `removed <id>` or `removed <id> <kind>`. Normal and full lines append `, by agent` when the last session writer origin starts with `agent:`. A headless `board_read` tool supports whole-document scope only. Narrow a headless document with `query` and `page` or `inside`.

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
  reveal: 'fit', // default for agent: origins; 'none' leaves the camera still
  lenient: false, // skip invalid ops; default is all-or-nothing
});
// { ok, created: string[], errors: [...], warnings: [...], skipped?: [...] }
```

Pass `expectedRevision` from the read that informed an edit to `apply` or `board_apply`. A mismatch returns `STALE_REVISION` without applying any operation, including in lenient or dry-run mode. Read again before retrying. This guards one session only: `load()` and `clear()` reset revisions.

Supported operations: `add`, `set`, `remove`, `order`, `reparent`, `page.add`, `page.set`, `page.remove`, `meta.set`, `media.set`, and `media.remove`. A batch is all-or-nothing unless `lenient: true`. Then failed operations go to `skipped` and the rest commit as one transaction. If nothing commits, `ok` is false and the document is unchanged. `set` merges `style`, `text`, and `data` one level deep. Do not change an item's ID. Add operations may provide IDs so later operations in the same batch can reference the new items. `add` also accepts `page`, `parent`, and `index`. `page.add` accepts `index`. `order.to` is `front`, `back`, `forward`, `backward`, or a numeric index.

`add.item.kind` accepts `rectangle` (stored `rect`) and `arrow` (stored `connector` with an end arrow and elbow route when those fields are omitted). `query({ kind: 'rectangle' })` and `query({ kind: 'arrow' })` match those stored kinds. Color strings `black`, `grey`, `gray`, `blue`, `light-blue`, `green`, `light-green`, `red`, `light-red`, `orange`, `yellow`, `violet`, and `light-violet` store the matching palette token. Connector `from` and `to` accept `{ item, side }`, `{ x, y }`, or a string item id (`{ item, side: 'auto' }`). Compact JSON writes tokens and structured endpoints.

`place` requires exactly one of `rightOf`, `leftOf`, `above`, `below`, `inside`, or `near`. Default `gap` is 32 (`agentPlaceGap` when origin starts with `agent:` and `gap` is omitted). Default `align` is `middle`. An `agent:` add that omits `place` uses a single `place` on the item, keeping `gap` and `align` when they are valid. A labeled `rect`, `ellipse`, `diamond`, `note`, or `text` that covers a similar label already on the page is placed `rightOf` that label, so omitted or repeated coordinates do not stack flowchart steps. The smaller area must be at least 40% of the larger, and the overlap at least half of the smaller box. A much smaller shape inside a larger one keeps the coordinates that were sent. An `agent:` node sent without `x`, `y`, or `place` is placed from the arrows in its batch: right of the first source already on the page, otherwise left of the first such target, using the same insert, pass, or stack rule. An unconnected one whose default spot would cover existing work goes right of the page content, top-aligned. Send nodes and their arrows in one batch and omit coordinates unless the position matters. `inside` requires a `group` and finds a free slot; it fails if the group is full. `near` searches rings around the reference. `rightOf` / `leftOf` / `above` / `below` slide further along that axis when the first slot is occupied. An `agent:` add instead reads the arrows in the same batch: a node that flows between the reference and the occupant is inserted there and the occupant with everything downstream of it moves over by the node's size plus the gap (`result.moved` lists the moved ids; locked items stay), a node that follows the occupant goes past it, and an unconnected node stacks beside it. Omitted `w` and `h` use the built-in default size for that kind. An `agent:` create or text patch on `rect`, `ellipse`, `diamond`, `note`, or `text` grows that size so the label fits. Standalone `text` defaults to 600 wide. A larger explicit size is kept. Agent-created `rect`, `ellipse`, `diamond`, and `note` items with no explicit fill get varied palette tints, stored once so save/reload and undo keep them. Explicit fills, including `none`, stay unchanged. An `agent:` connector that omits `route` stores `elbow`. Automatic elbows prefer lanes around boxes and earlier connectors; automatic attachment sides may change to reduce crossings. Explicit sides and waypoints stay as written. Straight and curve routes, and elbows with waypoints, stay as written.

`result.created` is the stored ids for that batch. Warnings do not roll back:

| Code                | Meaning                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OVERLAPS_EXISTING` | A new item intersects another item.                                                                                                                                      |
| `ID_REMAPPED`       | An `agent:` create reused an id. Stored as `id_1`, then `_2`. Same-batch refs follow it. `get` with the id you sent returns the older item. User/API origins still fail. |

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

A browser text item with `autoWidth: true` measures its plain text when it is added, when its text is set through `apply`, or when a text edit commits. `agent:` creates of `text` set `autoWidth` when it is omitted. Measurement uses a hidden DOM measurer and cache. The resulting width and height are saved in the document. A headless document keeps stored or grown dimensions and does not measure fonts. The default omitted size is 600×48.

## Agent origin presentation

A successful `board.apply` with an `agent:` origin gives newly created items a short visual arrival. A lilac cursor enters from outside the board, visits the first on-screen shapes one after another, then reveals the rest together, including connectors and items outside the viewport. Each visited item fades in with a small scale change, then the cursor leaves. It has no name unless `apply` passes `agentName` or `createBoard` set `agentName`. Groups reveal their children together. Connectors fade without scaling their page-space paths. After eight visible non-connector stops (`agentPresence.maxStops`), or when no further on-screen shapes remain, the rest of the batch appears together. Consecutive additions share one cursor. When the arrival finishes, `reveal: 'fit'` (the default for `agent:` origins) fits all content on the current page, including earlier batches and partially clipped items. Pass `reveal: 'none'` or `agentReveal: 'none'` to leave the camera still.

The operation is synchronous and atomic. `get`, `read`, exports, and history contain the complete result immediately. Temporary presentation state is not written to the document. Failed batches, dry runs, ordinary user or API edits, existing-item updates, and headless operations do not animate. A batch that is entirely outside the viewport, or on another page, does not summon a cursor. Off-screen items in a mixed batch stay hidden until the remaining items appear together. After that arrival the camera fits the whole current page unless reveal is `none`. An immediate `board.view.fit()` after `apply` uses the new viewport for the arrival.

The cursor ignores pointer events. Selection, focus, and the person's native cursor stay intact. Clicks, pans, zoom, and edits continue while the walk is running; pending items are not hittable. The camera is sampled each frame so the cursor stays on the placements. Removing those items, changing page, replacing the document, and destroying the board drop the presentation. Reduced-motion preferences and background tabs show the committed items immediately. Pass `agentPresence: false` to `createBoard` to opt out.

## Editor chrome

The built-in toolbar shows select, hand, eraser, then Shapes, draw, text, sticky note, and image. Shapes groups rectangle, ellipse, diamond, line, and arrow. On phones, including landscape, hand moves into the AnnieDrawing menu so the bottom bar stays tappable, unless that menu is hidden. Pages, zoom, undo, redo, and Export move into Board controls at the top right. A short desktop host keeps the sidebar centered. When the AnnieDrawing menu or page chips are present, icons and padding tighten at 640px host height. Without those bars, 640px reduces the left inset and uses a middle tool size; tools fully shrink at 500px. That menu also opens appearance, document actions, documentation, and the GitHub repository, and shows the package version. Export downloads the current page. Hosts choose PNG, SVG, and AnnieDoc (`json`); an imported board defaults to PNG and SVG. Page chips in the bottom bar switch pages. `+` adds a page. All pages appears when the chips overflow. The active page stays visible. Right-click a page chip to rename or delete that page. The last page cannot be deleted. Arrow keys, Home, and End navigate page tabs. The zoom percentage opens zoom controls.

Selecting an item opens a compact inspector for that item type. Fill, Line, and Opacity share one row. Color replaces fill and line on plain text. Fill, line, and text color open a palette. Text-capable shapes, including empty ones, show Text (S/M/L/XL), Align, and Font on their own rows. Font choices are Friendly (`sans`), Serif, Mono, and Handwritten (`hand`, the default). Stroked shapes also get line weight (1, 2, 4, or 8) and Pattern (solid, dashed, or dotted) on separate rows. Open freehand paths omit pattern. Sticky notes keep fill and text controls and omit line color, weight, and pattern. Images, videos, and link cards omit line and text controls. A selected video offers Edit Video URL; a selected link card offers Edit URL. Opacity opens a 0-100% slider; the document stores opacity as 0-1. The lock icon beside Delete locks or unlocks the selection. Connector route and arrowhead controls appear for a selected connector. More arrangement options opens align, distribute, group, ungroup, and stacking. Deselect to hide the inspector. The inspector does not expose `fillMode: 'hatch'`; set that through `apply`.

Select a shape and press Enter, double-click it, or double-tap it on a touchscreen to edit its text. Double-click a YouTube or Vimeo player, or an HTML item, to use its controls. Click the board or press Escape to drag it again. Link cards keep an Open button that always works. Press and hold an item, or right-click it, to select it and open its actions. The anchored context menu offers Edit text where supported, Edit Video URL or Edit URL for those items, Bring to front, Send to back, Duplicate, and Delete, all for the clicked item. Shift+F10 opens the selected item's menu. Escape dismisses it. Click, tap, or focus a locked item to select it. Its editing controls and context actions are gray and disabled. Unlock and Deselect remain available in the inspector. A readonly board disables saved changes, including unlocking.

Pasting a single `http(s)` URL creates a specialised item. YouTube and Vimeo become a `video` player. Image URLs become an `image`. Other sites become a `link` card with title, description, and an Open control. The card is created immediately from the URL. The browser may then fetch that page, without credentials, for Open Graph title, description, and image. That fetch skips loopback, private-network, IPv4-mapped, and NAT64 hosts; preview images must pass the same check. Pass `unfurl: false` to skip the fetch, or pass a function when the host has its own preview source. Agent operations do not fetch. Dropping the same URL text onto the board follows the same rules.

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
| Zoom in / out                  | + / = / −                                   |
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

const unsubscribe = board.on('change', ({ ops, inverse, origin, label, revision }) => {
  console.log(origin, label, revision, ops);
});
unsubscribe();
```

Events are `change`, `select`, `view`, `tool`, `page`, and `save`. A change describes one committed transaction. Camera, selection, and pointer drafts are local view state. They do not become drawing items.

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
});
```

The Export control downloads the current page, even when items are selected. Which formats it offers is `ui.export` on `createBoard`: PNG and SVG by default, AnnieDoc when the host includes `'json'`, or hidden when `export` is `false`. One listed format downloads on click; two or more open a menu. Programmatic `export` accepts `'json'`, `'svg'`, `'png'`, `'jpeg'`, and `'webp'`, even when the control hides a format. It defaults to `scope: 'page'`. Raster output defaults to 2× resolution. Pass `scale`, `maxSide`, `maxBytes`, `quality` (JPEG/WebP, default 0.85), and PNG `colors` (2–256, indexed palette) to budget a raster. A missed `maxBytes` budget still returns the smallest blob; it does not throw. PNG with `labels: true` defaults to 32 colors and `maxBytes: 245760`. PNG with `maxBytes` and no `colors` tries a 32-color indexed encoding before shrinking the scale. JSON and SVG return strings. Rasters return a Blob. `labels` adds item IDs for vision workflows. Rasterization uses an offscreen canvas. The editor's drawing surface is HTML and SVG. Browser CORS rules still apply to remote media. Custom HTML cannot be assumed to rasterize identically across browsers. Prefer explicit custom SVG output for portable exports. Video and link items export as still cards with title and URL; SVG also wraps the card in the stored `http(s)` link. They never write an iframe or `foreignObject`. Headless documents reject raster export.

Operation limits are exported as `LIMITS` from `anniedrawing/agent` and `anniedrawing/core`: at most 1,000 operations per API or agent batch (including at most 1,000 created items across nested children), up to 50,000 operations for a local `user` batch (`LIMITS.maxItems`), 50,000 items per document, coordinate magnitude 1,000,000, 100,000 text characters, nesting depth 32, JSON data nesting 104 (`LIMITS.maxJsonDepth`), 100 history entries (`LIMITS.maxHistory`), 500 session log slices (`LIMITS.maxSessionLog`), 100,000 path points, and 20,000,000 characters per media source. `VISION_PNG` is `{ colors: 32, maxBytes: 245760 }`, the labeled snapshot default. These are validation ceilings. They are not a promise that every maximum-size document stays fast. Read the runtime exported values before building UI around them.
