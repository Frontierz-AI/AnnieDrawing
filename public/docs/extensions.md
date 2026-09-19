# Application extensions

Custom kinds extend the built-in renderer. Applications that embed HTML must provide an explicit sanitizer.

## Sanitized HTML

```ts
import DOMPurify from 'dompurify';
const board = createBoard(host, {
  sanitizeHTML: (html) =>
    DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['iframe', 'form'],
    }),
});
```

Applications must explicitly provide a sanitizer. The host and its custom callbacks remain responsible for their rendering policy; a sanitizer is not a sandbox. For agent-origin changes, the model applies the supplied sanitizer before committing HTML. Without one it conservatively escapes markup. The renderer applies the supplied sanitizer again at the DOM boundary; mount IDs from agent changes are removed. Keep interactive embeds narrow and never store executable callbacks in `.annie` JSON.

Built-in `video` and `link` items are not HTML. They store an `href` and optional title, description and preview media. The renderer constructs the YouTube or Vimeo iframe and the link card itself; do not paste those URLs into an `html` item to get the same result.

## Custom kinds

```ts
import { createBoard, defineKind } from 'anniedrawing';

const badge = defineKind({
  kind: 'badge',
  summarize: (item) => `Badge: ${item.text?.value ?? item.name ?? item.id}`,
  paint(view, item) {
    view.shape.innerHTML = '';
    view.element.style.border = '2px solid #8F93F9';
    view.element.style.borderRadius = '999px';
    view.element.style.background = '#8F93F91a';
    view.text.textContent = item.text?.value ?? 'Badge';
  },
  toSVG(item, context) {
    return `<rect x="0" y="0" width="${item.w}" height="${item.h}" rx="${item.h / 2}" fill="#8F93F91a" stroke="#8F93F9"/>`;
  },
});
const board = createBoard(host, { kinds: [badge] });
board.apply([
  {
    op: 'add',
    item: {
      kind: 'badge',
      x: 40,
      y: 40,
      w: 140,
      h: 60,
      text: { value: 'Ready' },
    },
  },
]);
```

Kind callbacks are trusted application code. Escape user text with `context.escape` when composing SVG strings; use DOM `textContent` in the browser. Shape callbacks have access to `element`, `shape`, `text` and the current document. Implement portable `toSVG` output for anything you need to export. Unknown kinds remain saved and render as placeholders when the application has not registered them.

Custom kind `defaults` supply item properties before validation. A kind may also provide a Valibot `schema` for its extra fields, applied during both imports and operation validation. Pass the same kind definitions to `createDoc(..., { kinds })` for headless validation. A local-coordinate `outline(item)` supplies one or more `{ points: [{ x, y }], closed }` shapes for exact hit testing and attached connector routing in the live board, exports and headless deletion. Explicit normalized connector anchors remain exact; automatic and named-side endpoints meet the custom outline. `summarize(item)` provides the accessible item label.

```ts
import * as v from 'valibot';

const ratedBadge = defineKind({
  ...badge,
  kind: 'rated-badge',
  defaults: { w: 140, h: 60, rating: 3 },
  schema: v.looseObject({
    kind: v.literal('rated-badge'),
    rating: v.pipe(v.number(), v.minValue(1), v.maxValue(5)),
  }),
  outline: (item) => ({
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: item.w, y: 0 },
      { x: item.w, y: item.h },
      { x: 0, y: item.h },
    ],
  }),
});
```

Keep custom schemas and callbacks in trusted application code. The document stores the kind name and JSON fields only; opening a file never imports a module or executes an embedded callback.

### Custom content lifecycle and handles

`mount(view)` creates custom content once and may return a cleanup function. Cleanup runs when the kind changes or its view is destroyed. Custom `mount`/`paint` callbacks own the shape, text and auxiliary content; the Stage owns the wrapper's position, size, opacity and accessible label. `paint(view, item, changed)` receives a set containing the changed groups: `transform`, `geometry`, `style`, `text` or `content`.

A custom handle uses unrotated coordinates inside the item. Return a patch from `dragHandle`; the editor previews it as a draft and commits one undoable operation on release.

```ts
const adjustableBadge = defineKind({
  ...badge,
  kind: 'adjustable-badge',
  handles: (item) => [
    {
      id: 'width',
      x: item.w,
      y: item.h / 2,
      label: 'Badge width',
      cursor: 'ew-resize',
    },
  ],
  dragHandle: (item, handleId, point, { shift }) => {
    if (handleId !== 'width') return {};
    const width = Math.max(40, point.x);
    return shift ? { w: width, h: (item.h * width) / Math.max(1, item.w) } : { w: width };
  },
});
```

Custom controls expose `data-ad-custom-handle` with the handle ID and `data-ad-handle="custom:<id>"` for inspection. Canceling a drag discards the draft and leaves the document unchanged.
