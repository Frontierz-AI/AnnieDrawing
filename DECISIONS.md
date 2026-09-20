# Design decisions

## 2026-09-20: Public unfurl hosts

Unfurl is a same-browser GET of a user-pasted URL, not a metadata proxy. `isPublicHttpUrl` is a hostname check: it rejects loopback, RFC1918, link-local, ULA, IPv4-mapped IPv6, NAT64, multicast, and names that start with a private IPv4. It does not look up DNS. Preview images from Open Graph go through the same check so a public page cannot point the card at a private URL. The local Vite `/__ad-unfurl` plugin additionally resolves A/AAAA records and refuses private answers. Hosts that need stricter policy pass `unfurl: false` or their own function.

## 2026-09-20: Indexed PNG for vision snapshots

Vision models need a raster of the screen, not SVG markup. `board_snapshot` writes a labeled viewport PNG. It defaults to a 32-color indexed encoding and a 240 KiB budget so ID labels stay sharp without JPEG ringing. The same defaults apply to `board.export('png', { labels: true })`. The tool schema advertises those defaults. The Export control and unlabeled `export('png')` stay truecolor. Pass `colors` (2–256) for a different palette. PNG `maxBytes` without `colors` tries 32 colors before shrinking the scale.

## 2026-09-20: Agent duplicate create ids

An `agent:` `apply` that creates an item id already in the document, or repeated in the same batch, stores `id_1` then `_2` instead of failing the batch. Same-batch `place`, parent, and connector refs follow the stored ids. `ID_REMAPPED` is a warning. `result.created` is the stored ids; `get` with the id you sent returns the older item. User and API origins still reject duplicates so a host that supplies ids gets a hard error.

## 2026-09-20: Public contacts and safer host defaults

Security and community reports go to pau@frontierz.com. `package.json` records the GitHub repository, issues URL, and that mailbox. `createBoard` does not register `window.__anniedrawing` unless `exposeGlobal` is true; the local demo opts in. `sanitizeHTML` is probed at create time so identity functions fail closed. Further npm releases remain a maintainer action.

## 2026-09-20: Session revision, not catalog version

`revision` counts committed session transactions (`apply`, `undo`, `redo`). It is not `CATALOG_VERSION`, not a history index, and not a field in compact `.annie` JSON. `changesSince(since)` reads a 500-slice session log so hosts can poll without re-reading the scene. `kindsSince` still answers “what can I create that I did not know about.” `load()` and `clear()` reset the session counter, stamps, and log.

## 2026-09-20: Hidden agent history

`agentHistory: 'hidden'` makes default `undo` / `redo` and `canUndo` / `canRedo` walk only non-`agent:` entries. Origin-specific `undo({ origin })` still targets that origin. Agent batches emit `change`, increment `revision`, and appear in `changesSince`. Ordinary keyboard undo follows the default walk.

## 2026-09-20: Host vocabulary aliases

`rectangle` and `arrow`, a small set of English color names, and string connector ends are accepted on `apply`. The document stores `rect`, `connector`, palette tokens, and `{ item, side }` endpoints. Aliases are not catalog kinds and not format fields. `query` expands the same kind aliases.

## 2026-09-19: Kind catalog version, not per-item revisions

When a built-in kind is added or its create/read contract changes, increment `CATALOG_VERSION` and set that kind's `since` to the new number. `kindsSince(since?)` returns those entries. Omit `since` or pass `0` to list every built-in kind. This is the check for "what can I create that I did not know about." It does not stamp a version on every item in a drawing. The current board is `describe`, `read`, `get`, and `query`. The `.annie` format version stays a document-schema number.

## 2026-09-19: Independent DOM and SVG editor

Build from AnnieDrawing's own requirements with standard TypeScript, DOM, SVG, and Pointer Events. The document is a readable tree. The renderer derives its output from that tree. No other drawing editor's implementation is used.

## 2026-09-19: Page coordinates and atomic edits

All item positions use page coordinates, including nested children. Array order defines stacking. A single validated operation batch is the write boundary and the undo unit. This keeps tool calls compact and prevents an agent from leaving half a requested change behind.

## 2026-09-19: Five direct runtime dependencies

Use signals, pressure strokes, a spatial index, validation, and short IDs. The schema converter is installed during development and bundled into the separate agent entry point. HTML sanitization is supplied by the application. CI checks dependency licenses and the main bundle budget.

## 2026-09-19: 100 KiB gzipped default bundle

The default `anniedrawing` editor plus its CSS stays under 100 KiB gzipped. Optional entry points, async chunks, and peer sanitizers stay outside that total. The check is `scripts/check-size.mjs`.

## 2026-09-19: Frontierz color and typography

Use the Frontierz palette so the demo matches the rest of the family. Use Nunito in the demo chrome and rounded system fallbacks in the library. The project does not depend on the brand's commercial font. The font is self-hosted and attributed under OFL 1.1. Board text defaults to the handwritten Comic Sans-like stack (`hand`).

## 2026-09-19: Demo without a backend

The demo works without a backend or account. The development server uses Vite's default port 5173. Portable JSON files are the durable exchange format. Browser autosave does not synchronize users or devices.

## 2026-09-19: Live agent integration is explicit

Readable summaries, precise JSON, labeled snapshots, and small operation batches are the integration surfaces. Browser inspection is available through a removable global hook. The separate MCP package uses stdio and an explicitly attached, token-authenticated localhost bridge. It does not synchronize multiple users.

## 2026-09-19: Pages and versioned migration

Version 2 uses pages in the document, scopes, and editing API. Version 1 documents migrate at load time, preserving content and IDs. New saves use the current format. Page creation and switching live in bottom tabs, with overflow and contextual rename and delete actions. Manual alignment and distribution remain ordinary undoable editing actions.

## 2026-09-19: Host chrome options

`createBoard` appearance is `'light'`, `'dark'`, or `'auto'` for the system. The AnnieDrawing header menu and the Export control are independent `ui` flags. An imported board shows the menu and offers PNG and SVG. AnnieDoc (`json`) is opt-in. The repository demo passes all three formats. Programmatic `board.export` is not limited by the Export menu.

## 2026-09-19: Toolbar and inspector layout

Keep primary drawing tools on the sidebar: eraser after hand, image after sticky note, and line and arrow inside Shapes. Do not hide those tools behind a More overflow. On phones, including landscape, and on short tablet-width hosts, the tools move to a bottom bar and hand stays in the board menu so that bar remains tappable, unless a host hides that menu. A short desktop host keeps the tool sidebar and inspector vertically centered and tightens chrome padding and icons instead of pinning those bars to the top. The selection inspector is vertically centered like the tool sidebar. Export downloads the current page. An imported board offers PNG and SVG; AnnieDoc is opt-in through `ui.export`. The local demo offers all three. The AnnieDrawing control opens the same kind of menu for document, appearance, documentation, and GitHub, with the package version at the bottom, and hosts may hide it. Show item-specific style controls only when something is selected, with palettes opened on demand and compact line and text controls visible beside the selection. The inspector does not repeat the selected kind as a title. Page management remains in the bottom bar. Positioning and rotation follow the user's pointer. Shift constrains the move axis or resize proportions.

## 2026-09-19: MIT licensing and the named package

Provide MIT licensing, dependency attribution, DCO checks, contribution and agent guides, verification workflows, and release steps. The npm package name is `anniedrawing`.

## 2026-09-19: Direct controls and ordinary groups

Use anchored context menus for element and page actions, keep the active page visible when tabs overflow, and put opacity and locking directly in the inspector. Only groups own children. Retired frames convert on import into groups containing ordinary rectangle and text items plus their original children. Preserve IDs and bindings. Remove clipping so no hidden outside content is lost.

## 2026-09-19: Selectable locks

Locking protects interactive editing while leaving selection and unlocking accessible. Disable editing for an entire selection if any part is locked. Protect group descendants and group operations that would affect a locked child. Unlock clears the locks affecting the selection in one undoable action. Browser operations labeled `user` reject protected item mutations atomically with `LOCKED`. Explicit unlock patches are allowed. Programmatic API and headless operations retain their existing ability to edit locked items, so this is an editing aid, not authorization. A newly applied lock cancels an active pointer or text edit.

## 2026-09-19: Agent origin cursor

Show browser agent additions through one lilac cursor that enters from the nearest edge, curves to each placement, and leaves after the reveal. Reuse the native cursor silhouette, keep the overlay below controls, and ignore pointer events. The cursor has no name by default. `apply` may pass `agentName` to show one. A 220 ms opacity and 97-100% scale reveal adds a small settling motion. Connectors use opacity alone to preserve path geometry.

Keep the document authoritative and synchronous. The arrival is an optional renderer presentation after a successful agent-origin `apply`, with no new history entries, schema fields, or delays for agents. Group descendants arrive together. The cursor visits the first eight on-screen non-connector placements, then the remaining batch arrives together, including connectors and off-screen items held back until that dump. Never pan on behalf of the animation; sample the camera each frame so a person's pan and zoom stay in sync. After the cursor leaves, fit created ids on the current page when any sit outside the viewport. Consecutive batches share one cursor and one recen­ter. Pending items are not hittable, so a person can keep selecting and editing visible work. Reduced motion, hidden tabs, document replacement, page changes, and destruction clear pending effects. Removing a pending item drops it from the walk without revealing the rest.

## 2026-09-19: Pasted videos and link cards

Paste classifies a single URL locally. YouTube and Vimeo become a `video` item whose iframe `src` is built from a parsed video id, using youtube-nocookie.com or player.vimeo.com. Other `http(s)` URLs become a `link` card. Image URLs become `image` items. These are first-class kinds, not stored HTML, so they do not depend on a sanitizer.

A pasted link card appears immediately from the URL. The browser may then fetch that same URL, without credentials, to fill title, description, and image. That fetch is a user-initiated paste. Hosts can pass `unfurl: false` or their own function. Do not send pasted URLs to a third-party metadata service. Agents do not unfurl.

The inspector and context menu can change that stored href later. The item kind stays the same: a video still requires a YouTube or Vimeo URL. A link card resets to a hostname fallback, then unfurls when the host allows it, using the same user-initiated fetch as paste.

Notes, images, videos, and link cards share one 12px corner and one soft shadow so media on the board reads as one family. Video players keep pointer events off until a double-click, matching HTML items, so a clip can be moved without hitting play.

Portable SVG and PNG cannot keep a live player or a working Open control. Export those items as still cards: a video still with provider, title, and URL; a link card with preview, title, URL, and description. SVG wraps the card in a safe `http(s)` link. Do not write iframes, foreignObject, or a raw user URL into `iframe.src`.

## 2026-09-19: Publish-facing library surface

Package entry points export the documented API, not every helper in a folder. Host page chrome (`html`, `body`, `#app`) belongs in the demo stylesheet; `anniedrawing/style.css` styles the editor host only. Draft merges, copies, translation, and connector detach share one implementation. Comments mark non-obvious contracts. Tests cover invariants, not restated implementation.
