# API reference

## Imports

| Import                   | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `anniedrawing`           | Browser board, kinds (`defineKind`, `registerKind`), catalog (`kindsSince`), types |
| `anniedrawing/core`      | Headless document, validation, history, geometry, and kind catalog                 |
| `anniedrawing/agent`     | Tool definitions, dispatch, descriptions, queries, and kind catalog                |
| `anniedrawing/ui`        | Optional plain-DOM editor controls (`mountUI`)                                     |
| `anniedrawing/style.css` | Editor styles                                                                      |

Use Node.js 24 or newer for development and headless examples. Browser hosts need Pointer Events, SVG, ResizeObserver, and `structuredClone`. All JavaScript exports are ESM.

## createBoard and createDoc

```ts
const board = createBoard(host, {
  doc, // optional initial AnnieDoc
  readonly: false,
  theme: 'light', // also 'dark' | 'auto'
  ui: {
    menu: true, // AnnieDrawing control; false hides it
    export: ['png', 'svg'], // add 'json' for AnnieDoc; false hides Export
  },
  autosaveKey: 'my-diagram', // opt-in browser persistence
  exposeGlobal: true, // default on; window.__anniedrawing is an array
  agentPresence: true, // default on; visiting cursor for agent: additions
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

| Option      | Default         | Meaning                                                                                                     |
| ----------- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| `theme`     | `'light'`       | `'light'`, `'dark'`, or `'auto'` (follows `prefers-color-scheme`). Change later with `setTheme`.            |
| `ui`        | `true`          | `false` omits editor chrome. An object keeps the tools and sets the header.                                 |
| `ui.menu`   | `true`          | AnnieDrawing control: open a drawing, grid, appearance, documentation.                                      |
| `ui.export` | `['png','svg']` | `false` hides Export. `'png'`, `'svg'`, and `'json'` (AnnieDoc `.annie`). One format downloads immediately. |

`ui: true` is the same as `{ menu: true, export: ['png', 'svg'] }`. Two or more export formats open a menu. The local demo passes `export: ['png', 'svg', 'json']`. Programmatic `board.export()` still supports every format even when the Export control hides one.

`createDoc(initial?, { readonly?, allowedImageOrigins?, sanitizeHTML?, kinds? })` provides the model without creating DOM nodes. It returns `apply`, `get`, `query`, `describe`, `kindsSince`, `toJSON`, `undo`, `redo`, `load`, `on`, `canUndo`, `canRedo`, `itemSignal`, `fieldSignal`, and `childrenSignal`. `anniedrawing/core` also exports `applyDraft`, `translateItem`, `copyItems`, `detachMissingEndpoints`, `allItems`, and `clipboardText` for hosts that implement clipboard or preview layers. `applyDraft` merges nested `style`, `text`, and `data`. `clipboardText` reads the first non-comment `text/uri-list` line, then `text/plain`.

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
| `board.kindsSince(since?)`                   | Built-in kinds added or last changed after that catalog version.            |
| `board.boundsOf(ids?)`                       | Content bounds `{ x, y, w, h }`.                                            |
| `board.selection`                            | Selected item IDs.                                                          |

`query` accepts `kind` (string or string array), `text` (string or JavaScript `RegExp`), `within`, `inside`, `connectedTo`, `direction` (`in`, `out`, or `both`, default `both`), `data`, `hidden`, `locked`, and `page`. `text` matches `item.text.value` and `item.name`. A string is a case-insensitive substring. `kind` arrays match any listed kind.

`describe` accepts `detail` (`brief`, `normal`, or `full`, default `normal`), `relations`, `freeSpace`, `maxItems` (default 100, maximum 10,000), `scope`, `page`, and `selection`. Empty pages include the line `An empty board, ready for your first idea.` A headless `board_read` tool supports whole-document scope only. Narrow a headless document with `query` and `page` or `inside`.

`kindsSince(since?)` returns `{ version, since, kinds }`. Each kind is `{ kind, since, w, h, note }`. Omit `since` or pass `0` to list every built-in kind. Pass the last `version` you saw to get only kinds added or last changed after that number. `CATALOG_VERSION`, `KIND_CATALOG`, and `kindsSince` are also exported from `anniedrawing`, `anniedrawing/core`, and `anniedrawing/agent`. The catalog version is independent of the document format version. Custom host kinds are not listed.

Reads scoped to `page`, `selection`, or `viewport` include only media referenced by the returned items. Whole-document reads keep the complete media table. Scoped exports follow the same boundary, so exporting a selection does not include unrelated embedded images.

## apply

```ts
const result = board.apply(ops, {
  origin: 'agent:planner',
  label: 'Organize ideas',
  dryRun: false,
  merge: false, // fold into the previous history entry when origin and label match
  agentName: 'planner', // optional visiting-cursor label
});
// { ok, created: string[], errors: [...], warnings: [...] }
```

Supported operations: `add`, `set`, `remove`, `order`, `reparent`, `page.add`, `page.set`, `page.remove`, `meta.set`, `media.set`, and `media.remove`. A batch is all-or-nothing. `set` merges `style`, `text`, and `data` one level deep. Do not change an item's ID. Add operations may provide IDs so later operations in the same batch can reference the new items. `add` also accepts `page`, `parent`, and `index`. `page.add` accepts `index`. `order.to` is `front`, `back`, `forward`, `backward`, or a numeric index.

`place` requires exactly one of `rightOf`, `leftOf`, `above`, `below`, `inside`, or `near`. Default `gap` is 32. Default `align` is `middle`. `inside` requires a `group` and finds a free slot; it fails if the group is full. `near` searches rings around the reference. Omitted `w` and `h` use the built-in default size for that kind.

Successful creates can add an `OVERLAPS_EXISTING` warning. The batch still commits. `merge: true` appends to the last history entry when that entry has the same `origin` and `label`. History keeps at most 100 entries.

```ts
board.undo(); // returns whether anything changed
board.undo({ origin: 'agent:planner' });
board.redo();
board.load(nextDocument); // replaces the document and resets history
board.clear(); // removes the current page's items through operations
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
```

`board.add` and `board.addImage` are editor helpers. They commit through `apply` with `origin: 'user'`. Agents should call `apply` directly. `align` modes `horizontal` and `vertical` distribute spacing. `addCleanup(fn)` runs when `destroy()` runs.

`readonly` rejects saved mutations. Locks prevent interactive item edits, including keyboard commands, erasing, and context actions. `board.isLocked(id)` is true if the item, an ancestor, or a descendant is locked. A mixed selection stays protected until unlocked. `board.updateSelection({ locked: false })` clears the locks that affect that selection in one history entry.

Browser `apply` batches with `origin: 'user'` reject protected item mutations atomically with `LOCKED`. Unlock-only patches are allowed. Other programmatic origins and the headless model may still edit locked items. Locks do not restrict page management or undo and redo. An `origin` label is provenance. It is not authentication. `load()` replaces the document. Use small operations for ordinary edits.

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

A browser text item with `autoWidth: true` measures its plain text when it is added, when its text is set through `apply`, or when a text edit commits. Measurement uses a hidden DOM measurer and cache. The resulting width and height are saved in the document. A headless document keeps stored dimensions and does not measure fonts.

## Agent origin presentation

A successful `board.apply` with an `agent:` origin gives newly created items a short visual arrival. A lilac cursor enters from outside the board, visits the placement points, reveals each item with a fade and a small scale change, then leaves. It has no name unless `apply` passes `agentName`. Groups reveal their children together. Connectors fade without scaling their page-space paths. After eight visible stops, the rest of the batch appears together. Consecutive additions share one cursor.

The operation is synchronous and atomic. `get`, `read`, exports, and history contain the complete result immediately. Temporary presentation state is not written to the document. Failed batches, dry runs, ordinary user or API edits, existing-item updates, and headless operations do not animate. Items outside the viewport or on other pages do not summon a cursor or move the camera. An immediate `board.view.fit()` after `apply` uses the new viewport for the arrival.

The cursor ignores pointer events. Selection, focus, and the person's native cursor stay intact. Canvas input, camera changes during an arrival, edits, undo and redo, page changes, and destruction finish or clear the presentation. Reduced-motion preferences and background tabs show the committed items immediately. Pass `agentPresence: false` to `createBoard` to opt out.

## Editor chrome

The built-in toolbar shows select, hand, eraser, then Shapes, draw, text, sticky note, and image. Shapes groups rectangle, ellipse, diamond, line, and arrow. On phones, hand moves into the AnnieDrawing menu so the bottom bar stays tappable, unless that menu is hidden. That menu also opens appearance, document actions, and documentation. Export downloads the current page. Hosts choose PNG, SVG, and AnnieDoc (`json`); an imported board defaults to PNG and SVG. Page chips in the bottom bar switch pages. `+` adds a page. All pages appears when the chips overflow. The active page stays visible. Right-click a page chip to rename or delete that page. The last page cannot be deleted. Arrow keys, Home, and End navigate page tabs. The zoom percentage opens zoom controls.

Selecting an item opens a compact inspector for that item type. Fill, Line, and Opacity share one row. Color replaces fill and line on plain text. Fill, line, and text color open a palette. Text-capable shapes, including empty ones, show Text (S/M/L/XL), Align, and Font on their own rows. Font choices are Friendly (`sans`), Serif, Mono, and Handwritten (`hand`, the default). Stroked shapes also get line weight (1, 2, 4, or 8) and Pattern (solid, dashed, or dotted) on separate rows. Open freehand paths omit pattern. Sticky notes keep fill and text controls and omit line color, weight, and pattern. Images, videos, and link cards omit line and text controls. Opacity opens a 0-100% slider; the document stores opacity as 0-1. The lock icon beside Delete locks or unlocks the selection. Connector route and arrowhead controls appear for a selected connector. More arrangement options opens align, distribute, group, ungroup, and stacking. Deselect to hide the inspector. The inspector does not expose `fillMode: 'hatch'`; set that through `apply`.

Select a shape and press Enter, double-click it, or double-tap it on a touchscreen to edit its text. Double-click a YouTube or Vimeo player, or an HTML item, to use its controls. Click the board or press Escape to drag it again. Link cards keep an Open button that always works. Press and hold an item, or right-click it, to select it and open its actions. The anchored context menu offers Edit text where supported, Bring to front, Send to back, Duplicate, and Delete, all for the clicked item. Shift+F10 opens the selected item's menu. Escape dismisses it. Click, tap, or focus a locked item to select it. Its editing controls and context actions are gray and disabled. Unlock and Deselect remain available in the inspector. A readonly board disables saved changes, including unlocking.

Pasting a single `http(s)` URL creates a specialised item. YouTube and Vimeo become a `video` player. Image URLs become an `image`. Other sites become a `link` card with title, description, and an Open control. The card is created immediately from the URL. The browser may then fetch that page, without credentials, for Open Graph title, description, and image. Pass `unfurl: false` to skip the fetch, or pass a function when the host has its own preview source. Agent operations do not fetch. Dropping the same URL text onto the board follows the same rules.

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

const unsubscribe = board.on('change', ({ ops, inverse, origin, label }) => {
  console.log(origin, label, ops);
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
});
```

The Export control downloads the current page, even when items are selected. Which formats it offers is `ui.export` on `createBoard`: PNG and SVG by default, AnnieDoc when the host includes `'json'`, or hidden when `export` is `false`. One listed format downloads on click; two or more open a menu. Programmatic `export` always accepts `'json'`, `'svg'`, and `'png'`, even when the control hides a format. It defaults to `scope: 'page'`. PNG output defaults to 2× resolution. Pass `scale` to choose another resolution. The programmatic API still accepts `scope` for the whole document, a selection, or the viewport. Exports are asynchronous. JSON and SVG return strings. PNG returns a Blob. Scope controls the included content. `labels` adds item IDs for vision workflows. PNG uses an offscreen canvas only for rasterization. The editor's drawing surface is HTML and SVG. Browser CORS rules still apply to remote media. Custom HTML cannot be assumed to rasterize identically across browsers. Prefer explicit custom SVG output for portable exports.

Operation limits are exported as `LIMITS` from `anniedrawing/agent` and `anniedrawing/core`: at most 1,000 operations per API or agent batch (including at most 1,000 created items across nested children), up to 50,000 operations for a local `user` batch (`LIMITS.maxItems`), 50,000 items per document, coordinate magnitude 1,000,000, 100,000 text characters, nesting depth 32, JSON data nesting 104 (`LIMITS.maxJsonDepth`), 100 history entries (`LIMITS.maxHistory`), 100,000 path points, and 20,000,000 characters per media source. These are validation ceilings. They are not a promise that every maximum-size document stays fast. Read the runtime exported values before building UI around them.
