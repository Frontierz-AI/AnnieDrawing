# Changelog

## 0.3.0

First public AnnieDrawing: a framework-free HTML and SVG board, JSON document operations, headless and agent APIs, browser editing, PNG/SVG/JPEG/WebP and AnnieDoc export, custom-kind and sanitized-HTML integrations, a local demo, and a separate local MCP example.

The document is format version 2 with `pages`. Version 1 drawings with `sheets` migrate on load. Compact `.annie` JSON is the portable file. Session revision is memory only; it is not written to the file.

`apply` is the write boundary. The default batch is all-or-nothing. `lenient: true` skips invalid operations and commits the rest as one transaction. Each committed apply, undo, and redo increments a session `revision`. `changesSince(since)` returns compact slices; a window older than the retained 500 slices returns `truncated: true`. `describe({ since })` lists items created, last written, or removed after that revision. `load()` and `clear()` reset the session.

`createBoard({ agentName })` labels the visiting cursor when `apply` omits `agentName`. `agentHistory: 'hidden'` keeps `agent:` work off ordinary undo. `reveal: 'fit'` and `agentReveal` pan to created items that are off-screen on the current page. `agentPresence` accepts `{ maxStops, durationScale }`. `agentPlaceGap` sets the default `place.gap` for `agent:` origins.

`export('jpeg' | 'webp')` uses the same SVG path as PNG, with `maxSide`, `maxBytes`, and `quality`. The Export menu offers PNG, SVG, and optional AnnieDoc.

`ui.pages: false` hides page chips. Library chrome sizes in CSS pixels. `anniedrawing/fellow` is `createFellowBoard` with embed defaults (`agentHistory: 'hidden'`, `agentReveal: 'fit'`, `agentPlaceGap: 120`, a short visiting cursor, no global hook, no unfurl, no menu/export/pages).

Operation input accepts kind aliases `rectangle` → `rect` and `arrow` → `connector`, color name aliases such as `black` → `ink`, and string connector endpoints. The document stores AnnieDrawing kinds, tokens, and `{ item, side }` endpoints. `query({ kind: 'rectangle' | 'arrow' })` matches those stored kinds.

The default editor gzip budget is 100 KiB, including styles. Optional entries stay outside that total.
