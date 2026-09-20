# Changelog

## 0.3.1

Indexed PNG for vision: `colors` (2–256) writes a palette file. `board_snapshot` and labeled `export('png', { labels: true })` default to 32 colors and a 240 KiB budget. Unlabeled Export PNG stays truecolor. The AnnieDrawing menu links to GitHub and shows the package version.

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
