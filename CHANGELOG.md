# Changelog

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
