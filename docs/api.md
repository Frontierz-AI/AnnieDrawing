# Public API

## Entry points

| Import                   | Purpose                                              |
| ------------------------ | ---------------------------------------------------- |
| `anniedrawing`           | Browser board, public types and built-in editor      |
| `anniedrawing/core`      | Headless document, validation, history and geometry  |
| `anniedrawing/agent`     | Tool definitions, dispatch, descriptions and queries |
| `anniedrawing/ui`        | Optional plain-DOM editor controls                   |
| `anniedrawing/style.css` | Editor styles                                        |

Use Node.js 24+ for development and headless examples. Browser use requires modern Pointer Events, SVG, ResizeObserver and structuredClone support. All JavaScript exports are ESM.

## Create and dispose

```ts
const board = createBoard(host, {
  doc, // optional initial AnnieDoc
  readonly: false,
  theme: 'auto', // 'light' | 'dark' | 'auto'
  ui: true, // false for your own controls
  autosaveKey: 'my-diagram', // opt-in browser persistence
  exposeGlobal: true, // window.__anniedrawing registration
  agentPresence: true, // visiting cursor for new items with an agent: origin
  allowedImageOrigins: ['https://images.example.com'],
  // sanitizeHTML: (html) => DOMPurify.sanitize(html),
  // kinds: [customKind],
});
await board.ready; // wait for optional autosave restoration
// ...
board.destroy();
```

The host must have nonzero width and height. `destroy()` releases the board's listeners, views, subscriptions and global registration. Dispose application integrations with their cleanup functions too. The library does not ship a font file; the demo loads Nunito and the library CSS has system fallbacks.

`createDoc(initial?, { readonly?, allowedImageOrigins?, sanitizeHTML?, kinds? })` provides the model without creating DOM nodes. It returns `apply`, `get`, `query`, `describe`, `toJSON`, `undo`, `redo`, `load`, `on`, `canUndo` and `canRedo`.

## Observe headless state

The model exposes readonly signals for custom views and integrations:

```ts
const stop = doc.fieldSignal('i_api', 'x').subscribe((x) => {
  console.log('API moved to', x);
});
const item = doc.itemSignal('i_api').value;
const childIds = doc.childrenSignal('p_main').value;
stop();
```

`doc.toJSON()` emits the compact portable document. `doc.toJSON({ compact: false })` retains normalized defaults and geometry fields for an internal renderer or integration that needs a complete snapshot.

`itemSignal(id)` returns the current item or `undefined`; `fieldSignal(id, key)` observes one property. `childrenSignal(id)` returns immediate child IDs for a page or group. Values are frozen snapshots. Read the signal but edit through `apply`; never assign its value or mutate a snapshot. Updates from a committed batch are published together, and an unrelated property change does not notify a field subscriber. Browser consumers can access the same model through `board.model`.

## Read

| API                                          | Result                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| `board.read(scope?)`                         | Deep document copy; scope is `doc`, `page`, `selection` or `viewport`  |
| `board.read({ scope, includeDrafts: true })` | Explicitly includes current draft properties                           |
| `board.get(id)`                              | Deep item copy or `undefined`                                          |
| `board.query(selector)`                      | Matching item copies; filters combine with AND                         |
| `board.describe(options?)`                   | Deterministic text with IDs, labels, optional relations and free space |
| `board.boundsOf(ids?)`                       | Content bounds `{ x, y, w, h }`                                        |
| `board.selection`                            | Selected item IDs                                                      |

`query` accepts `kind`, `text` (string or JavaScript RegExp), `within`, `inside`, `connectedTo`, `direction`, `data`, `hidden`, `locked` and `page`. `describe` accepts `detail`, `relations`, `freeSpace`, `maxItems`, `scope` and `page`. A headless `board_read` tool supports whole-document scope; narrow it with `query` when no browser selection or viewport exists.

Reads scoped to `page`, `selection` or `viewport` include only media referenced by the returned items. Whole-document reads retain the complete media table. Scoped exports follow the same boundary, so exporting a selection does not include unrelated embedded images.

## Write

```ts
const result = board.apply(ops, {
  origin: 'agent:planner',
  label: 'Organize ideas',
  dryRun: false,
  agentName: 'Julia', // optional visiting-cursor label
});
// { ok, created: string[], errors: [...], warnings: [...] }
```

`add`, `set`, `remove`, `order`, `reparent`, `page.add`, `page.set`, `page.remove`, `meta.set`, `media.set` and `media.remove` are supported. A batch is all-or-nothing. `set` merges `style`, `text` and `data` one level deep. Do not change an item's ID. Add operations may provide IDs so later operations can reference new items in the same batch. `place` resolves `rightOf`, `leftOf`, `above`, `below`, `inside` or `near` into page coordinates.

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
board.setTheme('dark');
board.setGrid(false);
```

`readonly` rejects saved mutations. Locks prevent interactive item edits, including keyboard commands, erasing and context actions. `board.isLocked(id)` checks whether the item, an ancestor or a descendant is locked. A mixed selection stays protected until unlocked; `board.updateSelection({ locked: false })` clears the locks affecting that selection in one history entry. Browser `apply` batches with `origin: 'user'` reject protected item mutations atomically with `LOCKED`; unlock-only patches are allowed. Other programmatic origins and the headless model may still edit locked items. Locks do not restrict page management or undo/redo. Do not treat an `origin` label as authentication. `load()` is a document replacement API; use small operations for ordinary collaboration.

Use `board.pageId` to read the active page ID and `board.setPage(id)` to switch pages. To create a page and add content to it atomically:

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

A browser text item with `autoWidth: true` measures its plain text when it is added, its text is set through `apply`, or a text edit commits. Measurement uses a hidden DOM measurer and cache; the resulting width and height are saved in the document. A headless document preserves stored dimensions and does not measure fonts.

## AI placement presentation

Successful `board.apply` calls with an `agent:` origin give newly created items a brief visual arrival. A lilac cursor enters from outside the board, visits the placement points, reveals each item with a short fade and subtle scale, then leaves. It has no name unless `apply` passes `agentName`. Groups reveal their children together; connectors fade without scaling their page-space paths. After eight visible stops, the remaining batch appears together. Consecutive additions share one cursor.

The operation remains synchronous and atomic: `get`, `read`, exports and history contain the complete result immediately. Temporary presentation state never enters the document. Failed batches, dry runs, ordinary user/API edits, existing-item updates and headless operations do not animate. Items outside the viewport or on other pages do not summon a cursor or move the camera. An immediate `board.view.fit()` after `apply` uses the new viewport for the arrival.

The cursor is decorative and ignores pointer events. Selection, focus and the person's native cursor stay intact. Canvas input, camera changes during an arrival, edits, undo/redo, page changes and destruction finish or clear the presentation. Reduced-motion preferences and background tabs show the committed items immediately. Pass `agentPresence: false` to `createBoard` to opt out.

## Pointer and keyboard editing

The built-in toolbar shows select, hand, eraser, then **Shapes**, arrow, draw, text, sticky note and image. **Shapes** groups rectangle, ellipse, diamond and line. On phones, hand and arrow move into the **AnnieDrawing** menu so the bottom bar stays tappable. **AnnieDrawing** also opens appearance, document actions, the agent playground and documentation. **Export** is a format menu that downloads the current page as PNG, SVG or an Annie document. Page chips in the bottom bar switch pages, and **+** adds a page. **All pages** appears when the chips overflow; the active page stays visible. Right-click a page chip to rename or delete that page. The last page cannot be deleted. Arrow keys, Home and End navigate page tabs. The zoom percentage opens zoom controls.

Selecting an item opens a compact inspector with controls for that item type. **Fill**, **Line** and **Opacity** share one row; **Color** replaces fill and line on plain text. Fill, line and text color open a palette. Text-capable shapes, including empty ones, show **Text** (S/M/L/XL), **Align** and **Font** on their own rows. Friendly (`sans`), Serif, Mono and Handwritten (`hand`, the default) remain the font choices. Stroked shapes also get line weight (1, 2, 4 or 8) and **Pattern** (solid, dashed or dotted) on separate rows. Open freehand paths omit pattern. Sticky notes keep fill and text controls and omit line color, weight and pattern. Images omit line and text controls. **Opacity** opens a 0–100% slider. The lock icon beside Delete locks or unlocks the selection. Connector route and arrowhead controls appear directly for a selected connector. Deselect to return to the unobstructed board.

Select a shape and press Enter, double-click it, or double-tap it on a touchscreen to edit its text. Press and hold an item, or right-click it, to select it and open its actions. The anchored context menu offers Edit text where supported, Bring to front, Send to back, Duplicate and Delete, all for the clicked item. Shift+F10 opens the selected item’s menu; Escape dismisses it. Click, tap or focus a locked item to select it. Its editing controls and context actions are gray and disabled; Unlock and Deselect remain available in the inspector. A readonly board disables saved changes, including unlocking.

Position and rotation follow your pointer directly. Shift constrains movement to one axis or keeps resize proportions; Alt resizes from the center. Pinch to zoom, or use the hand tool to pan on a touchscreen. A displayed grid is a visual reference.

### Keyboard reference

Keyboard tool and editing controls remain available while the board is focused.

| Action                         | Keys                                        |
| ------------------------------ | ------------------------------------------- |
| Select / hand                  | V / H                                       |
| Rectangle / ellipse / diamond  | R / O / D                                   |
| Arrow / line / draw            | A / L / P                                   |
| Text / sticky note / eraser    | T / N / E                                   |
| Pan                            | Hold Space and drag                         |
| Fit drawing / actual size      | 2 / 1                                       |
| Zoom in / out                  | + / −                                       |
| Edit / finish text             | Enter / Ctrl or Command + Enter             |
| Undo / redo                    | Ctrl/Command + Z / Ctrl/Command + Shift + Z |
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

Events are `change`, `select`, `view`, `tool`, `page` and `save`. A change describes one committed transaction. Camera, selection and pointer drafts are local view state and do not become drawing items.

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

The Export menu always downloads the **current page**, even when items are selected. PNG output defaults to 2× resolution; pass `scale` to choose another resolution. The programmatic `export` API still accepts `scope` for the whole document, a selection or the viewport. Exports are asynchronous; JSON/SVG return strings and PNG returns a Blob. Scope controls the included content. `labels` adds item IDs for vision workflows. PNG uses an offscreen canvas only for rasterization; the editor's drawing surface is HTML/SVG. Browser CORS rules still apply to remote media. Custom HTML cannot be assumed to rasterize identically across browsers; prefer explicit custom SVG output for portable exports.

The operation limits are exported as `LIMITS` from `anniedrawing/agent`: maximum 1,000 operations per API/agent batch (including at most 1,000 created items across nested children), up to 50,000 operations for a local `user` batch, 50,000 items per document, coordinate magnitude 1,000,000, 100,000 text characters, nesting depth 32, 100,000 path points and 20,000,000 characters per media source. These are validation ceilings, not promises that every maximum-size document remains fast. Check runtime exported values before building UI around them.
