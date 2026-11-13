# Changelog

## 0.8.0

A minor release with new kinds, a layout pass for agent diagrams, and several changed defaults. The document format stays version 2, and the kind catalog is 4. A host will notice these default changes: `agent:` batches are laid out together as a graph (`agentLayout: 'none'` or `layout: 'none'` restores per-node placement); automatic elbow connectors attach and route differently, and a connector label moves off the path midpoint when something is under it; `createFellowBoard` reveals with `'created'` instead of `'fit'`; agent reveals move the camera only while `board.view.follow` is true, and the person's own camera input, including the built-in zoom and fit controls and keys, turns it off; `view` events carry `cause`; images added without `w` and `h` take their media's aspect ratio instead of 240×180; an agent `text` sent without `h` stores the height of its lines (25 for one line at the default size) instead of 48, and two `text` items placed relative to each other default to a one-line gap; `ApplyResult` always has `updated` and `removed`, and `created` no longer lists an item the same batch removed; `describe()` prints a neutral overflow line, stroke and dash, and marks only items an agent created; and the stylesheet no longer declares `--ad-ui-accent` or `--ad-focus`, so host values inherit. A host custom kind that stores a different shape under one of the new item field names (`rows`, `header`, `pending`, `progress`, `fitMedia`, `target`, `mark`, `match`, or `text.format`) now fails validation.

Agent diagrams:

- Nodes that an `agent:` batch sends without `x`, `y`, or `place` are laid out together after the batch's operations run, from every arrow in the batch and from connectors to nodes already on the page. Flows get ranked columns, and arrows back to an earlier step do not rank. Branches that rejoin sit above and below the trunk, trees keep each parent beside its children, a node linked to four or more otherwise unconnected nodes sits in the middle of them, a pure cycle becomes a ring, chains linked by cross arrows keep their own rows, and unconnected nodes are packed in a grid shaped like the viewport. A first unconnected `text` in the batch titles the diagram, above its top-left corner.
- The layout picks left to right or top down, and wraps a long flow into rows, so the diagram fits the viewport at a zoom of about 0.6 or more when the node count allows it. A board passes its own size; a headless document assumes 1280×760 unless `apply` receives `viewport`. The gap between two ranks grows to fit the label of an arrow between them.
- A new diagram that does not connect to existing work goes below or right of the page content, whichever reads larger. Nodes linked to existing ones are placed beside them. An existing node moves along the flow only when an agent placed it and no person or API call has moved or resized it since in this session (a move that was undone does not count); `result.moved` lists it and undo restores it. Locked items, items in locked groups, and items a person moved stay. Explicit `x`/`y` or `place` pins a node.
- New `ApplyOptions.layout` (`'auto'` by default, `'none'`, or `{ direction, shape }` as a hint), `agentLayout` on `createBoard` and `createDoc` as the host default, and `ApplyOptions.viewport`. The `board_apply` tool accepts `layout`. A layout error is reported as the warning `LAYOUT_FAILED` and the batch commits with its nodes where they were created.
- Automatic elbows leave and enter on the sides where their two nodes face each other, so a fan-in arrives on one side of the target and a tree enters each child from the top. Connectors that share a side are spread along it in the order of their far ends. Lanes keep 16 px from nodes they do not connect and 12 px from parallel lanes of other connectors when a clear channel exists. A connector whose facing gap holds another node, or that returns along an earlier connector between the same nodes, uses the bottom (or right) side of both, so a loop runs under its row. Routes no longer step back on themselves. Explicit sides, anchors, waypoints, and straight and curve routes are unchanged.
- Connector labels sit on the longest segment of their route where they cover no node, no other label, and no other connector. The board and the SVG, PNG, and JPEG exports place and wrap them the same way.
- SVG export routes connectors against the pages that hold the exported items, so content on another page no longer changes exported routes.
- `anniedrawing/core` exports `routePage`, `connectorLabel`, `labelSize`, `labelLines`, and `placeLabel` to read routes and label boxes without a DOM. `routePage` took about 9 microseconds per connector at both 240 and 990 connectors on one development machine.

Tables:

- New built-in `table` kind: `{ kind: 'table', rows: string[][], header: true }`. Column widths and row heights come from the text; a column grows with its longest line up to 260 px, and longer cells wrap. Ragged rows are padded with empty cells.
- `set { rows }` replaces the content and `set { cells: { '1,2': 'Reports' } }` changes single cells (row and column from 0, the header is row 0). Only `rows` is stored and logged. A cell key outside the table rejects the operation.
- Double-click a cell to edit it. Ctrl/Cmd+Enter or clicking away saves, Escape cancels, and Tab and Shift+Tab save and move. `board.editText(id, [row, column])` opens a cell from code.
- Tables are boxes for connectors, hit testing, routing, and placement, and SVG, PNG, and JPEG exports draw them with the board's column layout. `describe()` prints `t1 table 4x3 header "Current point" ...`, and `query({ text })` matches cell text.
- `LIMITS` gains `maxTableRows` (200), `maxTableColumns` (50), and `maxCellLength` (2000).

Marks:

- New built-in `mark` kind: emphasis drawn on another item. `{ kind: 'mark', target: 'step3', mark: 'circle' }` marks the whole item; `match: 'Exactly 1 trial run'` marks the first occurrence of that phrase in the target's visible text. Types are `highlight` (default), `underline`, `circle`, and `box`.
- A mark takes its geometry from its target, like a connector from its ends. It moves, resizes, rotates, and re-wraps with the target on the board, in exports, in `board.boundsOf([id])`, and in `describe()`. On the board the phrase is measured from the rendered label; exports use the exporter's own wrapping.
- Removing a target removes its marks in the same change, and one undo restores both. When the phrase is no longer in the text, the mark covers the whole item until it comes back.
- Marks never take space: placement, layout, overlap warnings, routing, and `view.fit()` ignore them. A highlight does not catch the pointer. An underline, circle, or box can be selected by its stroke and deleted; it cannot be moved, resized, or given text.
- `describe()` lists marks in a `Marks:` section.

Images:

- An image added without `w` and `h` is sized from its media to fit 480×360 without enlarging. With only `w` or only `h`, the other side follows the aspect ratio. This applies to every origin.
- When media is replaced under a key, images whose size came from their media keep their width and take the new aspect ratio, in the same history entry. Images with an explicit size keep it.
- `pending: true` lets an image exist before its picture, with a shimmer, its `name`, and a progress bar for `progress` (0 to 1). It can be selected, moved, and connected. Resolve it with `media.set` plus `set { media, pending: false }` in one batch; the id and connectors stay. `describe()` prints `image (pending)`, and exports draw a labeled placeholder.
- PNG, JPEG, and WebP export now include remote images: each one is fetched with CORS and embedded. An image that cannot be fetched is drawn as a labeled placeholder and reported through the new `onWarning` export option. `export('svg', { embedImages: true })` writes a self-contained SVG.
- A remote image that fails to load shows "Image unavailable" on the board. The new `media` board event reports `{ id, media, status }` with `loaded` or `error`.

Text:

- Labels on `rect`, `ellipse`, `diamond`, `note`, and `text` accept `text.format: 'md'`: `**bold**`, `*italic*`, `- ` and `1. ` list items with a hanging indent, and `# ` / `## ` headings. Anything else is shown as written. Exports draw the same structure, editing shows the source with its markers, and agent creates size the box for it. Connector labels stay plain.
- A `text` item placed `below`, `above`, `rightOf`, or `leftOf` another `text` item without `place.gap` sits one line of the larger text away. Eleven stacked one-line agent lines under the Fellow defaults take 525 px instead of about 1788 px.
- The label size estimate no longer counts an extra row when a line is exactly as wide as the box.

Camera and presentation:

- `reveal: 'created'` (on `apply`, and as `agentReveal`) leaves the camera alone when the new items are already in view at a zoom of 1 or less, and otherwise flies to them and the items their connectors reach, at a zoom between `agentRevealMinZoom` (default 0.6) and 1. Work too large for that floor shows its top-left part. `createBoard` still defaults to `'fit'`.
- `board.view.follow` (default `true`) is turned off by the person's camera input and emits a `follow` event. Agent reveals move the camera only while it is on. Setting it back to `true` goes to the last reveal.
- `view` events carry `cause`: `user`, `api`, `agent`, or `resize`.
- `presented` fires once per successful `agent:` batch that created items, with `{ ids, origin }`, when that batch's arrival ends.
- `board.view.toScreen()` and `board.view.toPage()` convert points and boxes between page coordinates and board pixels. `board.view.viewport` is the visible page box.
- `agentPresence.write` writes the labels of new agent items left to right with a pen cursor instead of fading them. It is off by default, including in `createFellowBoard`. `write: { charsPerSecond }` sets the speed (default 30). The document, exports, history, and DOM text are complete from the first frame.
- `apply(ops, { presentation: { durationMs } })` sets how long an agent batch's arrival takes, up to its `presented` event. The `board_apply` tool accepts `presentation` and `reveal: 'created'`.
- `createFellowBoard` merges a host `agentPresence` object over its own pace (`maxStops: 3`, `durationScale: 0.55`), so `agentPresence: { write: true }` keeps the Fellow pace. A host that passed a partial object before now gets the Fellow values for the fields it omitted.

Theming:

- The editor accent is themeable with `--ad-ui-accent`, `--ad-ui-accent-soft`, `--ad-ui-accent-strong`, and `--ad-ui-accent-fg`. Setting `--ad-ui-accent` alone on the host element recolors the Export button, brand mark, pressed tools, selected page tab, focus rings, marquee, range inputs, selection outline, and text editing outline in every theme. `--ad-focus` follows the accent unless the host sets it.
- `--ad-header-inset-start` and `--ad-header-inset-end` reserve room at either end of the header.
- Tokens set on the host element win over the library's theme defaults without extra specificity. With no host tokens the editor looks as in 0.7.
- `KindView.theme` gives custom kinds the theme of the current paint.

Results and descriptions:

- `apply()` results include `updated` and `removed` id arrays. A removed group lists its descendants, and removed marks are listed. Dry runs report them too.
- `describe()` lines include `stroke` and `dash` when they differ from `ink` and `solid`. `, by agent` marks items an agent created in this session, not items an agent last edited. The overflow line reads `N more items not listed: ...`; `overflowHint: true` adds the old hint, and the `board_describe` tool sets it.

Compatibility:

- 0.7.0 cannot load a document that holds a pending image without media, and shows `table` and `mark` items as unknown kinds. Other documents load there unchanged.
- The library applies table sizing to any item of kind `table`, including a host custom kind of that name.

The library has four direct runtime dependencies. IDs use native Web Crypto with the same prefixes, six-character alphabet, and unbiased random selection. The agent tools read JSON schemas generated during the build instead of shipping the converter; their schemas and runtime validation are unchanged. The declared Valibot minimum is 1.5.0, matching the schema converter's peer requirement. The declared `@preact/signals-core` minimum is 1.14.5.

DOMPurify remains a development dependency for sanitizer integration tests and a documented host option; it is no longer an optional peer. Its update to 3.4.17 fixes the reported sanitization advisories. Security checks now include development dependencies in both lockfiles.

Vite 8.3.8, Vitest 5.1.0, Playwright 1.65.0, Prettier 3.9.10, and compatible transitive dependencies are updated, and the MCP example uses `ws` 8.22.2. `@types/node` stays on 22. Vite's Rolldown lists an optional WebAssembly fallback that depends on `tslib` (0BSD); it is installed only on platforms without a native binding and is never shipped, and 0BSD is now an approved license. The Forge script defaults to Node.js 24.22.1, and the live MCP smoke test imports the browser launcher from the declared Playwright test package. Node.js 22.12 remains supported.

The package lockfile matches `0.8.0`. The private MCP example stays `0.1.0`.

## 0.7.0

A minor release: hosts that style or query the editor's CSS classes must rename them from `ad-` to `annie-`. The document format is unchanged.

The editor's CSS classes use the `annie-` prefix instead of `ad-` (`ad-root` is now `annie-root`, `ad-toolbar` is `annie-toolbar`, and so on for all 97). Ad blockers hide elements with ad-like class names, so with one active the board could show blank (`.ad-root { display: none !important }`). The `--ad-*` custom properties, the `data-ad-*` attributes, the `ad-context` and `ad-error` events, and the document format are unchanged.

Link previews are safer. A page full of unclosed `<title` or `<meta` tags no longer stalls the tab while its preview is read: a 200 KB page took about 13 seconds and now takes under a millisecond. Unfurling follows redirects one hop at a time and checks each target before requesting it, so a public link cannot redirect the request to a private or loopback address. Browsers hide cross-origin redirect targets, so a link that redirects to another site keeps its fallback card instead of a fetched preview. The demo's local unfurl proxy checks each hop the same way.

`nanoid` 6.0.2 is the locked runtime version (6.0.1 before; the `^6.0.1` range is unchanged).

Development and CI: development tools are up to date (Vite 8.3.3, Vitest 5.0.3, Prettier 3.9.9, DOMPurify 3.4.16 for tests), `@types/node` follows the Node.js 22 floor, and the MCP example uses `ws` 8.22.0. CI runs once per pull request, uses the current GitHub Actions, and adds CodeQL scanning. Dependabot groups minor and patch updates. The development lockfile uses `source-map-js` 1.2.2 (GHSA-68fv-2mgg-jv7q, reached only through Vite's CSS tooling), and the HTML sanitizer in the unit tests strips tags in one pass.

The package lockfile matches `0.7.0`. The private MCP example stays `0.1.0`.

## 0.6.2

The package and the MCP example now accept Node.js 22.12 or newer, down from 24. Installing on Node 22 LTS no longer prints an `EBADENGINE` warning. Nothing else changed: the library, the build, and the tests already ran on Node 22. CI now also runs the checks on Node 22.12.

The package lockfile matches `0.6.2`. The private MCP example stays `0.1.0`.

## 0.6.1

Bug fixes, speedups, and cleanup. The document format is unchanged.

Agent diagrams:

- An `agent:` batch whose arrows omit `id` now places coordinate-free nodes from those arrows. Before, a chain such as `A → B → C` sent without arrow ids turned into an L, with `C` and later steps stacked under `B`.
- `apply` accepts a plain string for `text` on `add`, `page.add`, and `set`: `text: 'Start'` stores `{ value: 'Start' }`, and a string `set` patch changes only the value and keeps size, alignment, and font. The `board_apply` tool schema advertises both forms. Documents still store the object form. `NewItemSchema` validates `add` input; `ItemSchema` still validates stored items.
- Agent id remapping follows batch order. An op that comes before a colliding create keeps referring to the item already on the board, so `[set a, add a]` edits the old `a`. A `remove` frees its ids for later creates in the same batch, so `[remove a, add a]` stores `a` again. A `set` that resends a group's `children` keeps their ids and bound connectors instead of renaming them `c1_1`.
- A connector inside a group that moves to make room moves once, and undo restores it.
- A group that holds locked work, or sits inside a locked group, stays put. When an insert meets a locked occupant, the new node stacks beside it instead of covering it.
- A node inserted before an item inside a group reads the arrows to that item instead of treating the whole group as the occupant.
- Stacking beside an occupant keeps clear of the reference. A zero `gap` works: touching boxes do not count as occupied, and `near` keeps searching outward. Up to 256 siblings of one reference get their own slots instead of piling up after 64.
- `OVERLAPS_EXISTING` compares only items on the same page, and also reports items moved to make room.
- `describe()` JSON-quotes ids, kinds, colors, connector ends, and data keys that are not plain tokens, so document text cannot add lines or fields to an agent's view of the board. Plain ids print as before.

Editing and undo:

- Undo history keeps only the items, pages, metadata, and media each entry changed, and document copies share media. A board with one 8 MB photo grew by about 8 MB per edit (320 MB after 40 edits); it now stays flat. Each stored image is validated once instead of on every commit, so an edit beside four 8 MB photos takes 0.1 ms instead of 29 ms.
- Selective undo and redo (`undo({ origin })` and `agentHistory: 'hidden'`) no longer get stuck when later edits shortened a list or removed a parent group. The restored item returns at the nearest valid index, or to the page when its group is gone.
- The browser board no longer pulls focus back after a text edit ends by clicking a field outside the board, so typing there cannot change tools or delete the selection.
- A remote removal closes an open editor on that item in every engine. A cancelled pointer or a native text drop inside the editor keeps the edit. Escape during input-method composition no longer discards the edit.
- An item moved while its agent arrival fades in ends at the new position. A drag or erase keeps the rest of its change when an agent removes one of its items mid-gesture. A second finger clears the first finger's marquee.

Browser autosave no longer loses work:

- Each save records a stamp beside the drawing and checks it in the same transaction. A tab never overwrites a drawing another tab saved after it last read; it reports a `save` event with status `conflict` and a `resolve('load' | 'keep')` callback. An idle tab follows another tab's saves instead, keeping its camera and page.
- Edits made before the saved drawing finished loading raise the same conflict instead of replacing that drawing. With nothing saved yet, those edits save right away.
- An unreadable saved drawing is copied to `<key>#unreadable-<time>` and new work keeps saving. Before, one bad record stopped autosave for the whole session.
- A write that aborts, including a full storage quota, reports an `error` instead of staying on `saving`.
- The built-in UI shows autosave errors and conflicts, with Use saved version and Keep this version buttons, until a save succeeds. `SaveEvent` is exported.
- The demo's `?blank` and `?benchmark` pages no longer autosave, so opening them cannot replace the saved playground drawing.

Speed: automatic elbow routing resumes one ordered lane pass per page instead of replaying every earlier connector for each one. Routes are unchanged. A page with 160 nodes and 240 elbows renders in about 40 ms instead of 3 s, and moving one node no longer freezes the board for seconds. `describe({ freeSpace })`, `query({ within })`, and detaching arrows from a removed node get the same speedup.

Security: fill and stroke values that are not palette tokens, named colors, hex, or CSS color functions render as ink. A `url(...)` paint could make the browser fetch a remote URL on render and in exported SVG, bypassing `allowedImageOrigins`. The MCP example's bridge closes a socket that sends a JSON value other than an object instead of exiting.

Package:

- The build imports `@preact/signals-core`, `nanoid`, `perfect-freehand`, `rbush`, and `valibot` from the consumer's install instead of bundling copies. A host that uses `@preact/signals-core` now shares one runtime with the board, so its own `effect` and `computed` track `itemSignal`, `fieldSignal`, and `childrenSignal`. The size check measures the editor bundled with those dependencies plus its styles, and fails on an import that is not a declared dependency.
- Every export has a `default` condition, and `anniedrawing/package.json` is exported. CommonJS hosts can `require('anniedrawing/core')` and `require('anniedrawing/agent')`.
- `board.toJSON(options?)` returns the portable document, as the docs already described.
- The tarball no longer includes the demo site's `public/` docs and favicon.
- The API reference lists apply and tool error codes. Docs no longer say agent `place` only slides, and several examples and defaults are corrected.

The package lockfile matches `0.6.1`. The private MCP example stays `0.1.0`.

## 0.6.0

An `agent:` node sent without `x`, `y`, or `place` is placed from the arrows in its batch. It goes right of the first source already on the page, otherwise left of the first such target, and a taken slot uses the insert, pass, or stack rule below. An unconnected one whose default spot would cover existing work goes right of the page content, top-aligned, instead of landing on the origin. An empty spot, sent coordinates (even one axis), explicit `place`, connectors, lines, paths, groups, children, and non-agent origins are unchanged. Agents can draw a diagram as labeled nodes plus arrows, with no coordinates or `place`.

An `agent:` add whose directional `place` slot is taken no longer slides to the end of the row. It reads the arrows in the same batch: a node that flows between the reference and the occupant is inserted there, and the occupant with everything downstream of it moves over by the node's size plus the gap; a node that follows the occupant goes past it; an unconnected node stacks beside it. `result.moved` lists the ids moved to make room, the moves are ordinary `set` operations in history and session slices, and locked items stay. Other origins keep sliding.

The package lockfile matches `0.6.0`. The private MCP example stays `0.1.0`.

## 0.5.1

A short wide diamond keeps its label vertically centered. The label inset no longer grows with the diamond's width.

Agent docs now say to place a new connected node beside the existing one. If the empty space between the boxes is more than three times the placement gap, move only that new node and leave the rest of the diagram.

The package lockfile matches `0.5.1`. The private MCP example stays `0.1.0`.

## 0.5.0

An `agent:` create that omits coordinates, or repeats one coordinate on every step, no longer stacks labeled flowchart nodes on one origin. A single `place` on the item is honored. Otherwise a labeled `rect`, `ellipse`, `diamond`, `note`, or `text` that covers a similar label is placed `rightOf` it, using `agentPlaceGap`. A much smaller shape inside a larger one stays where it was sent. Connectors, lines, paths, explicit `place`, and non-agent edits keep their coordinates.

The package lockfile matches `0.5.0`. The private MCP example stays `0.1.0`.

## 0.4.1

Agent arrivals now finish by fitting the whole current page. Later batches no longer crop earlier work, and a shape that only clipped the viewport is brought fully into view. Pass `reveal: 'none'` or `agentReveal: 'none'` to leave the camera still.

Automatic elbows stay out of node interiors and prefer lanes that cross fewer earlier connectors. When a side is omitted, the attachment may move to another face of the node. Explicit sides, anchors, straight and curve routes, and waypoints stay as written.

Agent-created rectangles, ellipses, diamonds, and notes receive a varied palette tint when fill is omitted. The color is stored in the document, so export, reload, undo, and later edits keep it. Explicit fills, including `none`, stay unchanged. Kind catalog 3 describes these defaults. Agent examples use relative placement and `arrow` aliases so diagram JSON stays small.

The package lockfile matches `0.4.1`. The private MCP example stays `0.1.0`.

## 0.4.0

On a short desktop host, the sidebar still moves inward at 640px. Tools and buttons fully shrink at that height when the AnnieDrawing menu or page chips are present. An embed without those bars uses a middle tool size from 640px and the tight size at 500px. On a narrow host, pages, zoom, undo, redo, and Export open from Board controls in the top right so the bottom bar can stay a tool strip.

An `agent:` create or text patch on `rect`, `ellipse`, `diamond`, `note`, or `text` grows the stored size so the label fits. Short labels keep the size the agent sent. Larger explicit sizes stay. Standalone `text` defaults to 600 wide, three times the previous 200, so graph titles stay on one line. The kind catalog is 2.

Elbow connectors pick a channel that misses intervening boxes. `rightOf` / `leftOf` / `above` / `below` slide further along that axis when the first slot is occupied. An `agent:` connector that omits `route` stores `elbow`. Existing documents that omitted `route` stay straight.

The package lockfile matches `0.4.0`. The private MCP example stays `0.1.0`.

## 0.3.3

Browser `getPointer()` exposes the human cursor in page coordinates, including whether it is still inside the drawing area, its age, and the item underneath. Editor controls do not count as canvas positions. Pointer state stays outside saved documents.

`apply` and `board_apply` accept `expectedRevision` to reject a stale batch atomically with `STALE_REVISION`. Hosts can re-read instead of overwriting an intervening edit.

The package lockfile matches `0.3.3`. The private MCP example stays `0.1.0`.

## 0.3.2

Public npm metadata now points at https://anniedrawing.com and https://github.com/Frontierz-AI/AnnieDrawing. The hosted demo is a static Laravel Forge site. This tarball includes the unfurl host checks described under 0.3.1.

The package lockfile matches `0.3.2`. The private MCP example stays `0.1.0`.

## 0.3.1

Indexed PNG for vision: `colors` (2–256) writes a palette file. `board_snapshot` and labeled `export('png', { labels: true })` default to 32 colors and a 240 KiB budget. Unlabeled Export PNG stays truecolor. The AnnieDrawing menu links to GitHub and shows the package version. The hosted demo is https://anniedrawing.com.

A selected video or link card offers Edit Video URL or Edit URL. `board.setHref` is the helper behind that dialog. PNG and SVG export those items as still cards with title and URL; SVG wraps the card in the stored `http(s)` link.

The package lockfile matches `0.3.1`. The private MCP example is `0.1.0` and reports that version in `serverInfo`.

Unfurl rejects IPv4-mapped IPv6, NAT64, unique-local addresses, and hostnames that begin with a private IPv4. Open Graph preview images must pass the same public-host check. The Vite demo proxy also resolves DNS and refuses private A/AAAA records.

## 0.3.0

First public AnnieDrawing: a framework-free HTML and SVG board, JSON document operations, headless and agent APIs, browser editing, PNG/SVG/JPEG/WebP and AnnieDoc export, custom-kind and sanitized-HTML integrations, a local demo, and a separate local MCP example.

The document is format version 2 with `pages`. Version 1 drawings with `sheets` migrate on load. Compact `.annie` JSON is the portable file. Session revision is memory only; it is not written to the file.

`apply` is the write boundary. The default batch is all-or-nothing. `lenient: true` skips invalid operations and commits the rest as one transaction. Each committed apply, undo, and redo increments a session `revision`. `changesSince(since)` returns compact slices; a window older than the retained 500 slices returns `truncated: true`. `describe({ since })` lists items created, last written, or removed after that revision. `load()` and `clear()` reset the session.

Agent-origin creates that reuse an item id store `id_1`, then `_2`, and so on, and emit `ID_REMAPPED`. Same-batch `place` and connector refs follow the stored ids. `result.created` is the stored ids. User and API origins still reject duplicates.

`createBoard({ agentName })` labels the visiting cursor when `apply` omits `agentName`. `agentHistory: 'hidden'` keeps `agent:` work off ordinary undo. After an agent arrival, created items on the current page are fitted if they sit outside the viewport (`agentReveal` defaults to `'fit'`). Pass `reveal: 'none'` to skip that. `agentPresence` accepts `{ maxStops, durationScale }`. `agentPlaceGap` sets the default `place.gap` for `agent:` origins.

`export('jpeg' | 'webp')` uses the same SVG path as PNG, with `maxSide`, `maxBytes`, and `quality`. The Export menu offers PNG, SVG, and optional AnnieDoc.

`ui.pages: false` hides page chips. Library chrome sizes in CSS pixels. `createFellowBoard` is `createBoard` with embed defaults (`agentHistory: 'hidden'`, `agentReveal: 'fit'`, `agentPlaceGap: 120`, a short visiting cursor, no global hook, no unfurl, no menu/export/pages). `createBoard` leaves `window.__anniedrawing` off unless `exposeGlobal: true`. The local demo opts in. `sanitizeHTML` is probed at create time and rejected if it leaves a script or event-handler probe in place. Library and demo unfurl skip loopback and private-network URLs and time out after four seconds.

`prepare` runs `npm run build` so a git checkout or `git+ssh` install produces `dist/`. `prepublishOnly` still runs the full `check`.

Operation input accepts kind aliases `rectangle` → `rect` and `arrow` → `connector`, color name aliases such as `black` → `ink`, and string connector endpoints. The document stores AnnieDrawing kinds, tokens, and `{ item, side }` endpoints. `query({ kind: 'rectangle' | 'arrow' })` matches those stored kinds.

The default editor gzip budget is 100 KiB, including styles. Optional entries stay outside that total.
