# Design decisions

## 2026-09-19 — Independent DOM and SVG editor

Build from AnnieDrawing's own requirements with standard TypeScript, DOM, SVG and Pointer Events. The document is a readable tree and the renderer derives its output from that tree. No other drawing editor's implementation is used.

## 2026-09-19 — Page coordinates and atomic edits

All item positions use page coordinates, including nested children. Array order defines stacking. A single validated operation batch is the write boundary and the undo unit. This keeps tool calls compact and prevents an agent from leaving half a requested change behind.

## 2026-09-19 — Five direct runtime dependencies

Use signals, pressure strokes, a spatial index, validation and short IDs. The schema converter is installed during development and bundled into the separate agent entry point; HTML sanitization is supplied explicitly by the application. CI checks dependency licenses and the main bundle budget.

## 2026-09-19 — Frontierz color, friendly typography

Use the Frontierz palette for a recognizable family identity. Use Nunito in the demo chrome and rounded system fallbacks in the library; the project does not depend on the brand's commercial font. The font is self-hosted and attributed under OFL 1.1. Board text defaults to the handwritten Comic Sans-like stack (`hand`).

## 2026-09-19 — Local-first demonstration

The demo works without a backend or account. The development server uses Vite's default port 5173. Portable JSON files are the durable exchange format; browser autosave is a convenience and does not synchronize users or devices.

## 2026-09-19 — Live agent integration is explicit

Readable summaries, precise JSON, labeled snapshots and small operation batches are the integration surfaces. Browser inspection is available through a removable global hook. The separate MCP package uses stdio and an explicitly attached, token-authenticated localhost bridge; it is not a collaboration server.

## 2026-09-19 — Pages and versioned migration

Version 2 uses pages in the document, scopes and editing API. Version 1 documents migrate at load time, preserving content and IDs; new saves use the current format. Page creation and switching live in bottom tabs, with overflow and contextual rename/delete actions. Manual alignment and distribution remain ordinary undoable editing actions.

## 2026-09-19 — A small visible surface

Keep primary drawing tools on the sidebar: eraser after hand, image after sticky note, and line and arrow inside Shapes. Do not hide those tools behind a More overflow. On phones, hand stays in the board menu so the bottom bar remains tappable. The selection inspector is vertically centered like the tool sidebar. Export is a format menu that always downloads the current page. The AnnieDrawing control opens the same kind of menu for document, appearance and agent actions. Show item-specific style controls only when something is selected, with palettes opened on demand and compact line and text controls visible beside the selection. The inspector does not repeat the selected kind as a title. Page management and agent tools remain available through their dedicated controls and the board menu. Positioning and rotation follow the user's pointer directly; Shift constrains the move axis or resize proportions.

## 2026-09-19 — OSS preparation without speculative publication

Provide MIT licensing, dependency attribution, DCO checks, contribution and agent guides, verification workflows and release steps. Keep repository URLs, package ownership, private security contacts and publication claims unset until the maintainer confirms real destinations.

## 2026-09-19 — Direct controls and ordinary groups

Use anchored context menus for element and page actions, keep the active page visible when tabs overflow, and put opacity and locking directly in the inspector. Only groups own children. Retired frames convert on import into groups containing ordinary rectangle and text items plus their original children. Preserve IDs and bindings; remove clipping so no hidden outside content is lost.

## 2026-09-19 — Selectable locks

Locking protects interactive editing while leaving selection and unlocking accessible. Disable editing for an entire selection if any part is locked; protect group descendants and group operations that would affect a locked child. Unlock clears the locks affecting the selection in one undoable action. Browser operations labeled `user` reject protected item mutations atomically with `LOCKED`; explicit unlock patches are allowed. Programmatic API and headless operations retain their existing ability to edit locked items, so this is an editing aid, not authorization. A newly applied lock cancels an active pointer or text edit.

## 2026-09-19 — A visiting AI cursor

Show browser agent additions through one lilac cursor that enters from the nearest edge, gently curves to each placement and leaves after the reveal. Reuse the native cursor silhouette, keep the overlay below controls and ignore pointer events. The cursor has no name by default; `apply` may pass `agentName` to show one. A 220 ms opacity and 97–100% scale reveal adds a small settling motion; connectors use opacity alone to preserve path geometry.

Keep the document authoritative and synchronous. The arrival is an optional renderer presentation after a successful agent-origin `apply`, with no new history entries, schema fields or delays for agents. Group descendants arrive together; after eight visible stops, the remaining batch arrives together. Never pan on behalf of the animation. Reduced motion, hidden tabs, human input, document replacement and navigation clear pending effects. This keeps ordinary editing usable even while an agent is adding content.

## 2026-09-19 — Pasted videos and link cards

Paste classifies a single URL locally. YouTube and Vimeo become a `video` item whose iframe `src` is built from a parsed video id, using youtube-nocookie.com or player.vimeo.com. Other http(s) URLs become a `link` card; image URLs become `image` items. These are first-class kinds, not stored HTML, so they do not depend on a sanitizer.

A pasted link card appears immediately from the URL. The browser may then fetch that same URL, without credentials, to fill title, description and image. That fetch is a user-initiated paste, not a background integration; hosts can pass `unfurl: false` or their own function. Do not send pasted URLs to a third-party metadata service. Agents do not unfurl.

Notes, images, videos and link cards share one 16px corner and one soft shadow so media on the board reads as one family. Video players keep pointer events off until a double-click, matching HTML items, so a clip can be moved without hitting play.
