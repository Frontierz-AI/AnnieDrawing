# Changelog

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
