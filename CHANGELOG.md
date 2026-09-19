# Changelog

## 1.0.0 (unreleased)

Initial independent AnnieDrawing implementation: a framework-free HTML/SVG board, JSON document operations, headless and agent APIs, browser editing, exports, custom-kind and sanitized-HTML integrations, local demo, and a separate local MCP example.

Tool menus open beside their desktop buttons and close when pressed again. Zoom options align with the fit-view button.

Documents use format version 2 with pages. Version 1 drawings migrate on load while preserving their content. The compact inspector exposes relevant line and text controls directly. Export is a format menu that downloads the current page as PNG, SVG or an Annie document; PNG uses 2× resolution.

Page chips now live in the bottom-left bar with an overflow list and contextual rename/delete actions. Undo and redo sit beside Fit drawing in the bottom-right zoom cluster. Element actions use a compact anchored right-click menu. The inspector adds more colors, visible opacity and an icon for locking; the extra style section and text-edit button are removed. Board menu title editing and frame tooling are removed. Older frames import as groups, preserving their contents, backgrounds and labels without clipping.

The local demo opens on a blank Page 1 instead of the previous welcome drawing. `npm run dev` uses Vite's default port 5173 instead of assigning a random free port.

Board text defaults to the handwritten Comic Sans-like font (`hand`) when no `font` is set. Friendly Nunito remains available as `sans`.

The selection inspector is narrower and no longer shows a kind title such as Rectangle. Fill, line color and opacity share one row; the former Stroke control is labeled Line. Text size, alignment, font, line weight and dash pattern each use their own row of buttons. Pasted plain text defaults to medium (M) size. Sticky notes omit line color, weight and pattern controls. The AnnieDrawing control opens a dropdown menu, matching Export and Shapes. Deselect is a chevron in the right page gutter instead of a full-width close row.

The drawing toolbar puts eraser after hand, line and arrow inside Shapes, and image after sticky note. The More tools overflow is gone; on phones, hand remains in the board menu. The selection inspector is vertically centered like the tool sidebar.

Pasting a YouTube or Vimeo URL creates a `video` item with the official player; drag it like any shape, then double-click to use the play controls. Pasting a website URL creates a compact `link` card with the page title, a URL without a trailing slash, the Open Graph image when the page can be read, and an Open button. The card text shrinks instead of overlapping when you resize it. Image URLs become ordinary image items. Notes, images, videos and link cards share one 12px corner and the same soft shadow. User paste may fetch the pasted page for a preview; pass `unfurl: false` to skip that fetch.

The package declares the version intended for the first release. No publication is implied. Use the release checklist and verified test results before tagging or distributing it.

The docs site, README, API, format, agent, extension, MCP, and repository guides were rewritten as a developer manual. Those pages and `llms.txt` now match the current board: 12px card corners, `apply.merge`, query kind arrays, placement rules, image import limits, `runTool` origin rewriting, and the six agent tools.

Development now uses TypeScript 7, Vite 8 and Vitest 5, with nanoid 6 for IDs. Node.js 24 or newer is required.

Locked items remain selectable by click, touch or keyboard focus. Their editing controls and context actions are disabled, with Unlock and Deselect available. Locks prevent dragging, resizing, text edits, erasing, duplication, ordering and keyboard edits, including through groups and mixed selections.

AI additions now arrive with a lilac companion cursor: it enters from outside the viewport, visits the placement points and reveals items with a gentle fade and settling motion. The cursor has no name unless `apply` passes `agentName`. Groups arrive together and large batches use a short sequence. The document commits immediately, human input takes priority, reduced motion is respected, and integrations can disable the animation with `agentPresence: false`. A successful agent-playground edit closes its dialog to show the result and labels the cursor Julia, Samuel or Anita. The editor no longer shows toast confirmations.
