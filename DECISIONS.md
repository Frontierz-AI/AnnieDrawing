# Design decisions

## 2026-11-13: A same-batch `place` is a hint

A model that chains `place: { rightOf: <previous> }` on every node of a diagram it also connects with arrows turned the batch layout off, because a node with `place` skipped it, and a schema cannot stop a model from sending that `place`. In an `agent:` batch with the layout on, a `place` on an unpositioned layout node whose single relation (`rightOf`, `leftOf`, `above`, `below`, or `near`) names another add of the same batch is therefore stored as a hint, and the node joins the batch layout. Hints are resolved after all the batch's operations, so their order inside the batch does not matter and a forward reference commits.

Arrows win: a hint between two nodes that any arrow path already joins is ignored, so the chained flow lays out exactly like the flow without `place`. Otherwise the hint is an adjacency. Groups joined only by hints form a cluster; the first group with existing neighbors, or else the first in batch order, is laid out normally, and each other group is placed beside its hint partner by per-node placement, on the stated side, with the gap and alignment that were sent, or the one-line text gap, or `agentPlaceGap`. A group of nodes related only by hints therefore comes out as chained per-node placement lays it out: a title with ten text lines chained `below` stays a column, and several nodes placed beside one node stack beside each other. A hinted chain is not ranked or wrapped.

A reference in the batch that is itself pinned (sent with `x`/`y`, placed beside existing work, or not a layout node) keeps per-node placement, run after the operations for a forward reference. A reference that is neither on the page nor among the batch's adds, or that names the node itself, is rejected with the same message as before. When the referenced add is skipped in lenient mode, removed later in the batch, or lands on another page, the hint is dropped and the node is laid out as a plain node, without a warning. A `place` beside an item that existed before the batch, `inside`, explicit `x`/`y`, `layout: 'none'`, and non-agent origins are unchanged.

Rejected: treating a hint as a directed arrow in the ranked layout, which would add ranks and crossings to flows that already have arrows and has no meaning for `above` and `below` in a left-to-right flow; ignoring hints entirely, which breaks lesson boards that chain text lines and notes in one batch; and keeping the attach-and-follow of 0.8.0 for same-batch references, which was the reported problem. This amends "2026-11-13: Agent batches get a layout pass": its sentence about explicit `place` pinning a node now applies to a `place` beside an item that existed before the batch, or beside a pinned item of the batch, and to items that are not layout nodes.

## 2026-11-13: Diagonal elbows leave straight neighbors their sides

A wrapped flow's row change runs between two boxes that are apart on both axes. The vote of their straight neighbors gave it the horizontal axis, so it used the left side of the last node of the row and the right side of the first node of the next. Those sides already held the straight arrows to the neighbors, and spreading two ends along each side bent both neighbors.

The attachment pre-pass has one more linear step. Every automatic end of a connector whose boxes are apart on exactly one axis claims its side, marked as leaving or arriving. After all claims are known, an automatic end of a connector whose boxes are apart on both axes keeps its side unless a straight connector flowing the other way claims it. Then it takes the side that faces its other end on the other axis if nothing claims that side, else the side opposite that one, else it keeps the first side and shares as before. Claims are collected before any end moves, so the result does not depend on the order of unrelated connectors. The flow direction is what separates a row change from a fan-in: inputs arriving on one side are all arriving and still share it.

When the facing side on the other axis is also taken, the request asked for the left side of the next row's first node. The only straight connector that can hold that top in a wrapped flow comes down from the node above, so a route into the left side must cross it or go around the whole second row. The connector takes the bottom instead: one detour under the row and no crossing. Mixed ends needed one more rule: when the start leaves across the channel axis and the end leaves along it, the default channel is the end's exit, so the route is an L. Explicit sides, anchors, waypoints, rotated nodes, and kinds with a custom outline neither claim nor move. This refines "2026-11-13: Elbows face their neighbors, share sides in order, and labels avoid lines".

## 2026-11-13: A whole-item highlight is a band around the item

A `highlight` without a phrase filled its target's box with the mark color at 70% and multiplied it over the fill. Agent nodes always have a tint, so the normal case turned a teal box olive, and a dark mark color turned it brown and took most of the label's contrast. The node stopped looking like its row.

A highlight that covers a whole item is now a closed band 8 px wide whose center line runs 6 px outside the item's outline, shaped for rectangles, ellipses, and diamonds. Nothing is drawn over the item, so its fill and its label contrast are exactly what they were, for any tint and any mark color. A phrase highlight stays a marker band, because it covers only that text, and so does a highlight on a whole `text` item, which has no fill to protect. The band is one more shape from the same headless function, so the stage, the exports, bounds, and `describe()` agree, and it is never hit-tested, like the fill it replaces. Rejected: a lighter fill overlay, which still shifts every tint and needs a contrast rule per color pair; and reusing the `box` mark's thin stroke, which would make two mark types look alike.

## 2026-11-13: Text on the strong accent has its own token

`.annie-primary:hover` changes the background to the strong accent and kept the accent's foreground color. A host picks `--ad-ui-accent-fg` for contrast against the accent, so with a light accent and dark text the hover became dark text on a dark background. `--ad-ui-accent-strong-fg` is read wherever the library puts content on the strong accent, today only that hover, and falls back to `--ad-ui-accent-fg`. It is an input the library never declares, like the other tokens.

## 2026-11-13: Agent batches get a layout pass

Greedy placement put each coordinate-free node right of its first placed source. Hubs, trees, fan-ins, and lanes came out as tall columns with arrows wrapped around them, unreadable at the zoom that fits the page. A voice agent cannot fix geometry in a second call, so one synchronous `apply` has to produce a readable diagram.

After the batch's operations run, the nodes an `agent:` batch sent without `x`, `y`, or `place` are laid out once, with the batch's arrows and the connectors to nodes already on the page. Running after the operations, not per node, means the layout sees removals, skipped operations in lenient mode, and the final graph. The stored `add` operations are rewritten with the final coordinates, and pushed existing items are recorded as `set` operations with inverses, so history, redo, `changesSince`, and undo agree.

The layout is hand-written and small. Ranks are longest paths from the sources, and a depth-first pass marks arrows back to the current path as feedback edges that do not rank. Long arrows pass through placeholders, one per rank. Ranks are ordered by sweeping toward neighbor positions and keeping the order with the fewest crossings. Positions across the flow come from alternating sweeps that solve a weighted isotonic regression per rank, which keeps the order and the spacing exactly; the last sweep moves toward the children, so parents end centered on them. Nodes on every longest path that are alone in their rank form the trunk and are weighted so others yield to them. A layout engine was not imported: it would exceed the size and dependency budgets, and a force-directed layout is slower and harder to keep deterministic.

Shapes are recognized before the ranked layout. A pure cycle of 3 to 16 nodes is a ring. One node linked to 4 to 40 others that share no arrows, all pointing the same way, is a hub, laid out around it, or in two columns when a ring of spokes would be too tall to read. Chains found in arrow order, at least two of them with three nodes, linked by at least one rung between their middles, keep their rows. A branch that rejoins has no such rung and stays symmetric. `layout: { direction, shape }` skips the detection.

Spacing follows `agentPlaceGap` (G): G between ranks, grown to fit an arrow label; 0.4 G between nodes of one rank, but never less than 32 or G, whichever is smaller, and half as much again between children of different parents; 1.5 G between separate diagrams; G in grids. Left to right is preferred; top down is chosen when it reads at least 20% larger; a long flow wraps into rows only when neither fits at zoom 0.6. The viewport is an explicit input, so the headless document stays deterministic (1280×760 by default) and the board passes its own size.

Existing nodes may move only along the flow, through the same room-making walk as an inserted step, and only when an agent made the last change to their position or size. That is tracked per session at commit time and not stored in the document, so a loaded document starts with every node fixed. The record keeps each item's recent positions with the origin that set them, and an item that returns to an earlier position returns to that origin, so a node is agent-placed again after a person undoes their drag. Locked items and items in locked groups never move. Explicit `x`/`y` and explicit `place` keep their meaning and pin the node; an item placed beside a node that the layout moves follows that node. A new diagram that links to nothing goes below or right of the page content, whichever reads larger, never into a hole in it. Existing nodes outside the linked group are avoided by sliding new nodes across the flow afterwards; they do not take part in ordering.

`layout: 'none'` and `agentLayout: 'none'` keep the per-node placement of 0.7. The kinds the layout treats as nodes are those per-node placement accepts, minus hidden items, so a derived kind is excluded in one place.

This supersedes "2026-09-22: Agent diagrams need no coordinates": its rule that the arrows pick one relation for a coordinate-free node now applies only under `layout: 'none'`. It also replaces the "without a graph layout pass" premise of "2026-09-20: Elbows miss boxes; place does not stack"; the slide rule for directional `place` stands.

Rejected: per-node layout inside the operation loop, which cannot see later arrows, removals, or skipped operations; laying out before the operations run, which would have to guess their effect; re-laying out the whole existing diagram on a second batch, which is too disruptive; persisting "agent placed" in the document, which would change the format; and storing waypoints for long edges, since routing stays derived.

## 2026-11-13: Elbows face their neighbors, share sides in order, and labels avoid lines

Automatic elbows choose an axis before routing, in a linear pre-pass inside the existing ordered lane pass. Two boxes that are apart on exactly one axis face along it. When they are apart on both axes, each node's unambiguous connectors vote for an axis and the sum of both ends decides; without votes, the wider gap decides. That is what makes a fan-in arrive on one side and a tree enter its children from the top. A connector whose facing gap contains another node, or that runs from B to A after an earlier A to B, takes the other axis and starts on the bottom (or right) side of both ends, so loops go under the row. Rejected: keeping the first-clear-side rule and only spreading ports (a fan-in still used four sides), and reserving a slot on the facing side for a connector that routes around (it pushed straight neighbors 14 px off center).

Connectors that share a node side are sorted by the far end's coordinate along that side, then by document order, and get slots at (k + 1) / (n + 1) of the side. Ellipses and diamonds use the middle 60% and put the point on the outline. Rotated nodes and kinds with a custom outline keep one centered port. Only the first-choice side is spread; a connector that falls back to another side attaches at that side's center, and automatic ends are not spread around explicit `side` ends.

The default channel is the midpoint of the two exits, clamped so it never lies behind an exit. Candidate routes are ranked by node hits plus reversals, then crossings plus crowding (a parallel lane of an earlier connector closer than 12 px, or a segment closer than 16 px to a node that is not an endpoint), then length with a small penalty for moving away from the midpoint. Candidate channels sit 16 px outside nearby nodes and 12 px beside nearby lanes. Every collinear run is merged, so even a fallback route shows no spur. Earlier connectors are penalized but are still not hard obstacles, so routing cannot cycle. This supersedes the elbow paragraph of "2026-09-20: Elbows miss boxes; place does not stack".

Nodes, reserved lanes, and placed labels sit in R-trees (`rbush`, already a dependency), so the work per connector depends on what lies near it. The per-call lookup check from "2026-09-22: Paints are colors, lanes route once" is kept and now allocates nothing per item. It is still proportional to the items per call; `routePage` checks once for a whole page.

A label box is measured without a DOM: 0.62 em per character plus 16 px and half an em, at most 240 px wide, 1.25 line height, 3 px vertical padding. Labels are placed in document order; each takes the first position, longest segment first and sliding out from each segment's middle, that overlaps no node, earlier label, or segment of another connector, and otherwise the least covered position. Routes never move for labels; the layout pass grows rank gaps for long labels instead. The stage centers the label on that box and caps its width at the box width, and SVG export draws the same box and lines, so board and exports agree. A long label in wide capitals can render taller than its box.

SVG export used every page's items as its routing lookup, so nodes on other pages changed exported routes. It now routes against the pages that hold the exported items, like the stage.

## 2026-11-13: Images can wait for their picture and take its shape

An image whose `w` or `h` was derived from its media, or a pending image sent without both, stores `fitMedia: true`. It is an ordinary optional item field, so `toJSON()`, `load()`, and undo keep it, and 0.7.0 readers keep it as an unknown field. A later `media.set` on its key with a different aspect ratio keeps `w` and sets `h`, and a `set` that changes `media` on such an image does the same, so a pending image sent without a size takes the picture's shape when resolved. Any explicit `w` or `h` in a `set`, such as a person's resize, clears it. The heights a `media.set` changes are extra `set` operations in the same batch and history entry; they are not reported in `result.moved`. Rejected: keeping the marker in `data`, which belongs to the host, and a session-only marker, which would not survive reload or undo.

The derived size applies to every origin. `board.addImage()` and paste already send explicit sizes. The fit box is the 480×360 cap `addImage()` uses, small pictures are not enlarged, and media with a zero side falls back to the kind default. Only top-level `add` items are sized this way.

A pending image may omit `media` only while `pending` is true. `progress` is a finite number from 0 to 1 and is left in place after the image resolves. A pending image renders a skeleton until `pending` is false, even when it has media. The skeleton's shimmer animates `transform` only and stops under reduced motion, and the item has `aria-busy="true"`. A document with a pending image cannot be loaded by 0.7.0; that is the cost of letting the item exist before its picture.

Raster export inlines remote pictures in `board.export()` before the SVG is written, from the document's media table only, so no new origins load. Fetch uses CORS with default credentials. Media that cannot be fetched is left out of the export copy, the SVG writer draws a labeled placeholder, and `onWarning` reports each item. The fetched bytes are not decoded first, so a host that answers with a non-image body leaves an empty area. The inlining code is a separate chunk loaded only when an exported item uses a remote picture. SVG export keeps remote `href`s unless `embedImages: true`; the synchronous SVG writer itself never fetches.

The `media` event carries both the item id and the media key, because one key can serve several items and hosts track items. It fires per item view whenever its picture finishes, including after a swap or theme repaint. Events from a picture that has since been replaced are dropped.

## 2026-11-13: Reveal what an agent created, and let the person keep the camera

`'fit'` keeps its meaning and stays the `createBoard` default, so existing hosts see no change. `createFellowBoard` moves to `'created'`, because a tutor adds a few items at a time and a whole-page fit made a growing lesson unreadable (zoom 0.32 after eleven lines in one host's session). For boards that choose `'created'`, this replaces the reveal paragraph of "2026-09-21: Agent diagram defaults and routing".

`'created'` frames the created ids plus the endpoints of created connectors, so a new arrow and the node it reaches share one frame. It does not frame neighbors reached only by older connectors, which would grow the frame with every batch. Zoom stays between `agentRevealMinZoom` and 1. When the frame does not fit at the floor, an axis that does not fit aligns to its start and one that fits stays centered. "Already in view" also requires zoom at most 1; otherwise a camera left at 1.5 by the empty-page fit never moved for a visible title. The empty-page startup camera itself is unchanged. `'created'` animates for 280 ms, instantly under reduced motion or in a hidden tab; `'fit'` stays instant.

Whether the person moved the camera is an explicit `follow` flag, not a comparison of camera states or timestamps. Every camera write carries its cause, and only `user` turns follow off. The built-in zoom and fit controls and keys count as user input. Host API calls never change it; a host that moves the camera for the person sets `view.follow = false`. A suppressed reveal still records its target, and turning follow back on goes there. Rejected: inferring user input from timing or from a camera that differs from the last reveal, which misreads host fits and resizes.

`presented` is per batch. Each enqueued batch keeps its own elements and completes once each has finished arriving, was removed, or the presentation was cleared. The board emits the event in a microtask, so it always arrives after `apply` returns and a listener can call `apply` again. Ordering between overlapping batches follows the cursor walk, not apply order.

`view.toScreen` and `view.toPage` take a point or a box and return the same shape, in pixels from the board's top-left corner, so a host can anchor its own controls, such as actions beside the selection, without reading internals. A slot for such actions in the built-in UI was considered and not built.

## 2026-11-13: Labels are written by revealing, not retyping

`agentPresence.write` shows a label being written. The label element always holds the full text from the document; writing sets a `clip-path` that shows every line above the current one and the current line up to the reveal edge. Line boxes are measured once per item from `Range.getClientRects()`, before the item becomes visible, and the clip and pen are then driven per frame with no further layout reads. Rejected: assigning partial strings, which would make the DOM disagree with the document, shift layout, and let screen readers read fragments; and per-character spans, which add DOM and change the rich-text structure.

The pen moves at constant speed along the summed line widths. Each frame checks that the item has not been edited, moved, resized, or refilled; any change ends that item's writing on the current state. Camera moves do not. Written items are always cursor stops and do not count toward `maxStops`. `durationScale` multiplies writing durations too. Rotated items, off-screen items, and connector labels fade as before. The pen artwork is an inline SVG drawn for this project and is added to the cursor only when `write` is on.

`presentation.durationMs` is a deadline for one batch, measured from when the cursor walk reaches it. The remaining time is split over the batch's remaining stops by characters written, or 12 for a stop that writes nothing, so without `write` it stretches or shortens the existing walk. It is presentation only and ignored by the headless document. A written element completes its arrival when its writing ends, so `presented` follows the last label.

`createFellowBoard` merges a host `agentPresence` object over its own pace instead of replacing it, so `{ write: true }` alone keeps the Fellow timing. `false` and `true` behave as before.

## 2026-11-13: Theme tokens are inputs the library never declares

The board's DOM is `host > .annie-root[data-theme]`. Defaults used to be declared on `.annie-root`, so any value inherited from the host lost to them and a host had to write `body .annie-root { --ad-ui-accent: ... }`. The library now never declares `--ad-ui-accent`, `--ad-ui-accent-soft`, `--ad-ui-accent-strong`, `--ad-ui-accent-fg`, `--ad-focus`, or the header insets. It reads them with `var()` fallbacks into private `--annie-*` properties, so a value set on the host element wins in every theme. Setting them on `.annie-root` keeps working. Only these tokens are the contract; other `--ad-*` variables are still declared per theme. Rejected: defaults on the host element with `:where()`, which touches host attributes, and aliasing every `--ad-ui-*` token per theme, which would apply one host value to both themes.

The default look stays as in 0.7. The old palette is not one `color-mix()` of the accent, so soft uses mix the accent at each site's original alpha, and strong uses fall back to their old literals unless the host sets an accent, in which case strong is the accent mixed 80% with black. In the dark theme the canvas focus color defaults to the accent itself, so a host accent stays visible. The header insets use logical properties, so in a right-to-left layout the start inset applies to the right edge.

## 2026-11-13: Rich text is a small Markdown subset with one parser

`text.format: 'md'` renders bold, italic, `- ` and `1. ` list items, and `# ` / `## ` headings. A full Markdown implementation would need a dependency or several KiB, and agents need only these for lesson boards. Anything outside the subset is shown literally, including `### `, `* item`, indented markers, links, code, and HTML. A run of three or more `*` stays literal, and lists do not nest.

One headless parser turns the value into lines and styled runs. The stage, SVG export, and the size estimate all read that structure, so they agree on what is bold, which line is a heading, and where list items wrap. Inline markers are matched with a delimiter stack in linear time, so hostile input renders literally without stalling. The stage builds DOM nodes and never assigns markup. Headings are bold and sized in `em`, so they follow `text.size`. Connector labels stay plain: they are short and placed at a point. SVG export keeps the hanging indent for start-aligned lists only. `.annie-line` turns on font synthesis because the default hand font has no italic face.

Two `text` items placed relative to each other default to one line of the larger text apart, for any origin, and only when the caller sent the `place`. Automatic placement keeps `agentPlaceGap`, because two text items one line apart side by side read as one sentence. An agent `text` sent without `h` stores the height of its lines; before, headless creates kept 48 while the browser stored the measured height, so the same batch gave different geometry. The wrapping estimate gained a small epsilon so a line exactly as wide as the box is one row. This extends "labels accept strings" from 2026-09-22: a string `set` patch still changes only `value`, so `format` stays.

## 2026-11-13: Tables are a built-in kind with one headless layout

One headless function lays a table out: column widths, row heights, cell edges, total size, and wrapped lines. Stored size, the stage, SVG export, and the cell editor's hit test all call it. The stage paint and SVG markup are a built-in kind definition, so the item view and the exporter needed no table branches. Cells use the label estimate (0.62 em per glyph, 0.68 for the bold header), 16 px text, 10 px and 6 px padding, and column text from 24 to 240 px. The browser wraps inside each computed box and real glyphs are narrower than the estimate, so the board never needs more lines than the stored height. SVG export writes the estimate's lines, so exported cells can wrap a little earlier inside the same columns.

An omitted size is the natural size for every origin. A larger explicit size is spread over columns and rows in proportion; a narrower one narrows columns, never below the minimum, and the text wraps more. Height never goes below what the text needs. After a `set`, a side that was at its natural size follows the text, and a side the patch or a person set keeps its value unless the text needs more. Agent edits to cells widen the table to its natural width, as agent label edits grow boxes. Size changes go into the same history entry.

`cells` is operation vocabulary, like a string `text`: it is applied to the current rows before the inverse is computed, and only `rows` is stored or logged. A key outside the table rejects the operation with a message that names the table's size, rather than silently growing the grid. Cells are plain text, with no Markdown, per-cell style, or merged cells. Agent-created tables get a paper background, not the varied tint. There is no toolbar control to create a table or add rows; tables come from `apply` or from loaded documents.

New item fields are typed on every kind, as `media`, `points`, and `html` already were: `rows`, `header`, `pending`, `progress`, `fitMedia`, `target`, `mark`, `match`, and `text.format`. A host custom kind that stored a different shape under one of these names now fails validation. The format stays version 2; 0.7.0 shows `table` and `mark` as unknown kinds.

## 2026-11-13: Marks take their geometry from a target

A mark stores `target`, `mark`, and `match` next to the ordinary fields, and its `x`, `y`, `w`, and `h` are always 0: an `add` zeroes them, a `set` drops them and `rotation`, and compact JSON omits them as for connectors. One function computes what a mark draws from its target, and bounds, hit testing, presence, the stage, and the SVG exporter all call it. A mark is drawn in its target's frame, so moves and rotation need no re-measuring.

Phrase boxes come from two sources through that one function. Headless and in exports they follow the exporter's own text layout, and a unit test checks them against the exporter's rows. On a live board the stage measures the phrase in the rendered label with `Range.getClientRects()` and hands the boxes in through the outline resolver, so the mark sits on the words the browser draws. Measurements are cached per mark under the target's kind, size, text, the phrase, and a font epoch; pans and zooms read nothing.

When the phrase is missing the mark covers the whole item and keeps its `match`, so it returns when the text does. Removing a target removes its marks in the same operation, unlike connectors, which detach; the inverse re-adds the target first. A `set` that replaces a group's `children` and drops a target does not cascade, and that mark draws nothing until it gets a target. Documents with a mark whose target is missing still load (invariant 6); `describe()` prints `(target missing)`. A new mark, or a `set` that changes `target`, must name an existing item on its page that is not a mark or a connector, and a connector cannot attach to a mark. The rule covers every mark an operation introduces, including one nested in a group's `children`, in a `set` that replaces `children`, or in a new page; a nested mark may target an item in the same tree. Pasting a copied mark without its target therefore fails that paste.

Marks never take space. One predicate excludes them from placement, layout, overlap warnings, routing obstacles, group bounds, `view.fit()`, and the free-space line. A highlight never hit-tests; an underline, circle, or box hit-tests on its stroke. The circle's wobble is seeded by the mark id, so stage, export, and repaints draw the same loop.

## 2026-11-13: Apply results list updated and removed ids; describe marks creators

Agents diffed `query()` before and after a batch to report what changed. `removed` is every id present before the batch and absent after it, including descendants of a removed group, children dropped by a `set` of `children`, and marks removed with their target. `updated` is ids that existed before and still exist and that a `set`, `order`, or `reparent` in the batch named, including connectors detached from a removed target and images resized by a `media.set`. A `set` that leaves the item unchanged is not listed; `order` and `reparent` subjects always are. Items moved only to make room stay in `moved`. `created` now lists only ids that exist after the batch. Dry runs compute the same arrays, and failed batches return empty ones.

`, by agent` meant the last writer was an agent, so an item a person created and an agent nudged read as the agent's. Each item now records the origin that created it in this session, and the mark means that origin was an agent. Edits keep it; an item restored by undo or redo keeps the creator it had; an item that predates the session stays unmarked even when it is removed and comes back. `describe()` also prints `stroke` and `dash` when they differ from the defaults. The overflow line no longer names calls the reader may not have; `overflowHint: true` restores the hint, and the `board_describe` tool, whose users do have `board_query`, sets it.

## 2026-11-13: Approve 0BSD for an optional build dependency

Vite 8.3.8's Rolldown lists an optional WebAssembly fallback that depends on `tslib` under 0BSD. It is a development-only optional package, installed only on platforms without a native binding, and never shipped. 0BSD grants use without conditions, so it is compatible with the MIT package. It is on the approved list in `scripts/check-licenses.mjs`, and NOTICE records it.

## 2026-10-27: Generate tool schemas at build time and reduce runtime dependencies

`nanoid` was used only to generate six-character item, page, and media IDs. A small independently implemented Web Crypto generator preserves the alphabet and prefixes, rejects bytes outside a complete set of alphabet-sized buckets to avoid modulo bias, and reads crypto only when called. The runtime dependency count drops from five to four. The transitive Nano ID used by PostCSS remains build tooling.

`@valibot/to-json-schema` previously ran on import and was bundled into the agent entry. The build now generates a versioned JSON artifact from the same Valibot schemas used by `runTool`. `check:schemas` rejects stale artifacts; parity tests compare every public input schema with the converter output, including snapshot defaults. Run `npm run generate:schemas` after changing a tool validator. Valibot's declared minimum is now 1.5.0, as required by the converter already in the lockfile. The exported API and document format do not change.

The host supplies a `sanitizeHTML` callback, not a particular sanitizer package. DOMPurify therefore remains a development dependency and documented example, but no longer an optional peer. Audit checks include development dependencies because they run in CI and tests. The Forge script selects Node.js 24.22.1 by default; the package and Node types continue to target the supported 22.12 floor.

Terser stays: a same-source comparison produced 72.85 KiB gzipped with Terser and 80.40 KiB with Vite's default minifier. The signals, geometry, spatial index, validation, font, and WebSocket server packages have active uses and remain. Updates follow compatible parent ranges rather than forcing new transitive majors.

## 2026-10-08: Unfurl checks every redirect hop

`unfurlPage` used `redirect: 'follow'` and checked only the final URL, so a public link could redirect the request to a private address before the check ran. It now uses `redirect: 'manual'` and checks each `Location` with `isPublicHttpUrl` before requesting it, up to five hops. In a browser a cross-origin redirect is an opaque response, so those links keep the fallback card; that is the cost of never sending the request. The demo proxy does the same with its DNS check. The `<meta>` and `<title>` patterns stop at the next `<`, which keeps parsing linear on hostile pages.

## 2026-10-08: Editor classes use the annie- prefix

Ad blockers ship generic rules that hide elements with ad-like class names. With one active in Firefox the board showed blank: `.ad-root { display: none !important }` came from the extension, ahead of the page's own styles, so the page could not override it. The editor's classes now use `annie-`, a prefix with no ad meaning. The `--ad-*` custom properties stay, since selectors cannot match them and hosts may theme with them. The `data-ad-*` attributes stay because browser agents read them (`AGENTS.md`); the reported failure came from class rules. The events stay so host listeners keep working.

## 2026-10-04: Node types follow the engines floor, CI runs once per change

`@types/node` now tracks Node.js 22, the `engines` floor, instead of 24. Newer types would let TypeScript accept Node APIs that fail on 22.12, and the node-floor CI job would only catch them where tests reach that code. Dependabot ignores major `@types/node` updates; raise them together with `engines`. Minor and patch development updates, MCP example updates, and GitHub Actions updates arrive as one grouped pull request each.

CI ran on every push and again for the pull request, so each pull request ran the browser suites twice. Push runs are now limited to `main`. Checkouts no longer persist the token, since no step pushes or fetches with it. A CodeQL workflow scans the TypeScript and the workflow files on pull requests, on `main`, and weekly.

## 2026-09-28: Support Node.js 22.12 and newer

The Node.js 24 floor came with the initial import. Nothing in the code needed it, but consumer servers on Node 22 LTS got an `EBADENGINE` warning at every `npm ci`. `engines` now matches the tools' real floor: `nanoid` needs Node 22, and Vite, Vitest, and the `require()` of ESM in the CommonJS consumer path need 22.12. A git install runs `prepare`, which needs the build tools, so a single range covers development and use. CI runs the checks, the consumer smoke test, and the MCP tests on 22.12. The browser, performance, and main suites stay on Node 24. The anniedrawing.com deploy script keeps its own Node 24.

## 2026-09-22: Autosave asks before replacing, placement respects locked groups, describe quotes

Autosave kept one IndexedDB record per key and wrote it whenever the page changed. Two tabs, a late load, or opening a blank demo page silently replaced saved work. A save stamp now sits beside the record and is checked in the same readwrite transaction as the write, so the check cannot interleave with another tab. A tab that finds a newer stamp does not write; it raises a conflict and the person picks a version. Tabs without unsaved edits follow saves announced on a `BroadcastChannel`. The stored drawing keeps its old format and key, so earlier saves still load. An unreadable record is copied to a separate key before new work is saved over it; if the copy fails, autosave stops rather than risk the only copy.

Locking already protects group descendants in the editor. Placement now does the same: a group that holds locked work, or sits in a locked group, is not moved to make room, and a locked occupant makes the node stack beside it. Placement occupancy uses strict overlap, so a zero gap places boxes edge to edge. The shared `intersects` stays inclusive for hit testing and selection.

`describe()` is read by agents as text. Ids, kinds, fills, and data keys are free strings in the format, and printing them raw let a document add lines or fields. They now print as is only when they are plain tokens, and are JSON-quoted otherwise. The format keeps accepting any id so imported and unknown content survives.

## 2026-09-22: History keeps traces, dependencies stay external, labels accept strings

A history entry held the whole document before and after it, and every commit deep-copied the whole document, media data URLs included. A board with one large photo grew by the photo's size on every edit. Selective undo only compares the items, pages, metadata, and media that an entry's inverse ops name, so an entry now keeps those parts as references into committed states, which are never edited after commit. Document copies share media objects, because media is only ever replaced or removed. A data-URL media object is validated once. A merged entry keeps the earliest value of each part and re-reads the current state for its after side.

The library build imports its runtime dependencies instead of bundling them. Consumers install them anyway, so bundled copies were duplicates, and a host's own `@preact/signals-core` could not track board signals through a second runtime. The size budget measures what a consumer's bundler ships for `import 'anniedrawing'`: the editor, those dependencies, and the stylesheet. The check also fails when the package imports anything that is not a dependency or peer. The JSON Schema converter stays bundled into the agent entry because it is a development dependency.

Agents send `text: 'Start'` more often than `text: { value: 'Start' }`. That string is accepted on `add`, `page.add`, and `set`, and stored as `{ value }`. A string `set` patch changes only `value`. Like `rectangle`, it is operation vocabulary, not a format field, so `ItemSchema` and stored documents keep the object form and `CATALOG_VERSION` does not change.

## 2026-09-22: Paints are colors, lanes route once, and agent remaps follow batch order

`fill` and `stroke` stay free strings in the format so unknown values survive import. Rendering, SVG export, and the inspector swatch resolve them through one function that accepts palette tokens, named colors, hex, and CSS color functions without nesting. Anything else renders as ink. A `url(...)` paint would otherwise fetch a remote URL on render and in exports, outside `allowedImageOrigins`.

Elbow lanes are still reserved in document order from current geometry. Each route is the next step of one ordered pass over its lookup, so the pass is kept per lookup object and resumed. Every call first compares the listed items and the fields routing reads, so a refilled or mutated lookup, such as drag drafts, starts a new pass. Replaying the pass per connector made a page cubic in its connector count.

An `agent:` create that collides is remapped for the ops after it, not the ops before it. An earlier `set`, `remove`, `order`, or `reparent` still names the item on the board. A `remove`, or a `set` that replaces a group's `children`, frees those ids for later creates in the batch, so replacing an item or resending a group keeps its ids.

## 2026-09-22: Agent diagrams need no coordinates

Agents spent most of a diagram call on geometry: `place` for every node, or coordinates guessed without knowing what was already on the board. The batch's arrows already say where a node belongs, and a taken slot reads them to insert, pass, or stack. For an `agent:` add that sends neither `x` nor `y`, has no `place`, is not a child, and is not a connector, line, path, or group, the arrows now choose the relation: `rightOf` the first source already on the page, otherwise `leftOf` the first such target. The existing `placeAgentItem` path then inserts, passes, or stacks. Only nodes already on the page count, so a batch lists nodes before the arrows that reach them, as it must for bound endpoints anyway.

A node with no link to a placed node falls through to the similar-label rule, then to free space: if its default box at the origin would intersect a visible non-connector item, it moves right of the bounds of those items, top-aligned, using `agentPlaceGap`. This replaces "a free `0,0` is unchanged" from the decision below for coordinate-free agent nodes only. It is a single bounds step, not a packing search, so a new diagram lands beside a busy board rather than in the nearest hole. One sent axis counts as a position and is kept.

## 2026-09-22: Agent labels do not share one origin

Models draw flowcharts by omitting `x`/`y`, repeating one coordinate, or putting `place` on the item instead of the operation. `normalizeItem` stores omitted coordinates as `0`, and `perform` only ran `placeItem` for `op.place`, so every step landed on the same corner. Label growth then made the widest box stick out of the pile while connectors still bound.

For an `agent:` add, after the label grows: if `op.place` is absent and the item carries exactly one of `rightOf`, `leftOf`, `above`, `below`, `inside`, or `near`, that relation becomes `op.place` and is not stored. `gap` and `align` are kept when they are valid. Same-batch id remap rewrites that relation first. If there is still no `place`, and the grown item is a labeled `rect`, `ellipse`, `diamond`, `note`, or `text` covering a similar label already on the page, `place` becomes `{ rightOf: that id }`. The existing `placeItem` path then uses `agentPlaceGap`. Later steps in the batch see the moved boxes, and `nextFree` slides past a taken slot.

Two labels share a slot when the smaller area is at least 40% of the larger and the overlap is at least half the smaller box, using grown `w` and `h`. The latest match on the page wins. A crater inside a much larger shape fails the area test and stays. An explicit `op.place`, a free `0,0`, user origins, and connectors, lines, and paths are unchanged.

## 2026-09-20: Elbows miss boxes; place does not stack

Agent diagrams go wrong in two cheap ways: several `rightOf` the same node land on one point, and a straight or midpoint elbow walks through the node in between. Orthogonal routing literature (channel + obstacle) and simple packing fix both without a graph layout pass.

Elbows stay derived. The default midpoint channel is kept when it is clear. If it hits a box, try the other orientation, then a channel just outside the blocker. Waypoints and non-elbow routes are untouched. Other connectors are not obstacles, so routing cannot cycle.

`rightOf` / `leftOf` / `above` / `below` already named an axis. When that slot intersects a solid item, slide further along the same axis by the occupant plus `gap`. `near` and `inside` already searched.

An `agent:` connector that omits `route` stores `elbow`. Omitted `route` on disk stays straight.

## 2026-09-20: Agent labeled boxes grow to the text

Agents often send catalog defaults or example 200×100 boxes with a paragraph of `text`. The label then overflows. An `agent:` `add` or text `set` on `rect`, `ellipse`, `diamond`, `note`, or `text` grows stored `w`/`h` so the label fits, wrapping long lines at a comfortable width. Standalone `text` defaults to 600 wide so graph titles are not capped at the old 200. User and API origins keep the size they wrote. A larger explicit size is kept. The measurement is a headless heuristic so MCP and the browser store the same box. Browser `agent:` text also sets `autoWidth`. Kind catalog 2 records that create contract.

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

The demo works without a backend or account. The development server uses Vite's default port 5173. The same static build is published at https://anniedrawing.com from Laravel Forge. Portable JSON files are the durable exchange format. Browser autosave does not synchronize users or devices.

## 2026-09-19: Live agent integration is explicit

Readable summaries, precise JSON, labeled snapshots, and small operation batches are the integration surfaces. Browser inspection is available through a removable global hook. The separate MCP package uses stdio and an explicitly attached, token-authenticated localhost bridge. It does not synchronize multiple users.

## 2026-09-19: Pages and versioned migration

Version 2 uses pages in the document, scopes, and editing API. Version 1 documents migrate at load time, preserving content and IDs. New saves use the current format. Page creation and switching live in bottom tabs, with overflow and contextual rename and delete actions. Manual alignment and distribution remain ordinary undoable editing actions.

## 2026-09-19: Host chrome options

`createBoard` appearance is `'light'`, `'dark'`, or `'auto'` for the system. The AnnieDrawing header menu and the Export control are independent `ui` flags. An imported board shows the menu and offers PNG and SVG. AnnieDoc (`json`) is opt-in. The repository demo passes all three formats. Programmatic `board.export` is not limited by the Export menu.

## 2026-09-19: Toolbar and inspector layout

Keep primary drawing tools on the sidebar: eraser after hand, image after sticky note, and line and arrow inside Shapes. Do not hide those tools behind a More overflow. On phones, including landscape, and on short tablet-width hosts, the tools move to a bottom bar and hand stays in the board menu so that bar remains tappable, unless a host hides that menu. Pages, zoom, undo, redo, and Export live in a Board controls menu at the top right so they do not compete with that bar. A short desktop host keeps the tool sidebar and inspector vertically centered and tightens chrome padding and icons instead of pinning those bars to the top. That tighter chrome starts at 640px host height when the AnnieDrawing menu or page chips are present. Without those bars, 640px pulls the sidebar inward and uses a middle tool size; tools and buttons fully shrink at 500px. The selection inspector is vertically centered like the tool sidebar. Export downloads the current page. An imported board offers PNG and SVG; AnnieDoc is opt-in through `ui.export`. The local demo offers all three. The AnnieDrawing control opens the same kind of menu for document, appearance, documentation, and GitHub, with the package version at the bottom, and hosts may hide it. Show item-specific style controls only when something is selected, with palettes opened on demand and compact line and text controls visible beside the selection. The inspector does not repeat the selected kind as a title. Page management remains in the bottom bar. Positioning and rotation follow the user's pointer. Shift constrains the move axis or resize proportions.

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

## 2026-09-20: Human pointing and revision-checked edits

Expose pointing through the browser board as transient page-space state, separate from the animated agent cursor and document JSON. Report inside/outside and age instead of guessing that a previous pointer is still current. Hosts decide whether a historical point answers “here.”

Put optional optimistic concurrency in the shared `apply` boundary, not in each host adapter. `expectedRevision` is checked before any operation, including lenient batches and previews. This is a session guard, not a persistent document version; document replacement resets it.

## 2026-09-21: Agent diagram defaults and routing

Assign omitted agent node fills in the document transaction, using a fixed palette in page order. Store the chosen tint so rendering, exports, reloads, and undo agree without theme-dependent or random colors. Explicit styles and non-agent creates keep their existing behavior.

Automatic elbows reserve connector lanes in document order and prefer paths with fewer node collisions, then fewer crossings, then less length and fewer bends. This bounded search is a heuristic, not a planar-layout guarantee. Automatic ports may choose another side; explicit sides, anchors, routes, and waypoints retain their meaning. Recompute from current geometry without mutable-scene caches so drags and exports agree.

The post-arrival fit covers the whole current page. Fitting only the last batch can crop the rest of a diagram, and mere viewport intersection misses partially clipped shapes. Hosts retain the existing reveal opt-out. Relative placement, `arrow` aliases, and string endpoints already provide compact input without a second JSON dialect.

## 2026-09-22: Taken placement slots for agents

Sliding a directional `place` past every occupied slot sent an inserted step to the end of its row, with long crossing arrows back to its neighbors. Agents describe topology, so the document transaction resolves a taken slot from the arrows in the same batch instead of asking the agent to compute room: insert before the node the new one flows into and move that node's downstream side, pass a node the new one follows, and stack an unconnected node beside the occupant. Downstream is followed through outgoing connectors and bounded by the occupant's leading edge so unrelated content and upstream branches stay where they are. Moves are recorded as `set` operations with inverses so undo, history, and `changesSince` stay complete. API and user origins keep the predictable slide.
