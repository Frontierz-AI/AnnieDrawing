# Extensions

Custom kinds extend the built-in renderer. They do not appear in `kindsSince` until they are added to the built-in catalog. Applications that embed HTML must pass an explicit sanitizer.

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

The host and its custom callbacks remain responsible for rendering policy. A sanitizer is not a sandbox. For agent-origin changes, the model runs the supplied sanitizer before committing HTML. Without one it escapes markup. The renderer runs the supplied sanitizer again at the DOM boundary. Mount IDs from agent changes are removed. Keep interactive embeds narrow. Do not store executable callbacks in `.annie` JSON.

Built-in `video` and `link` items are not HTML. They store an `href` and optional title, description, and preview media. The renderer builds the YouTube or Vimeo iframe and the link card. Pasting those URLs into an `html` item does not produce the same result.

## Custom kinds

```ts
import { createBoard, defineKind, registerKind } from 'anniedrawing';

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

Kind names must start with a letter and contain only letters, digits, `_`, or `-`. Kind callbacks are trusted application code. Escape user text with `context.escape` when composing SVG strings. Use DOM `textContent` in the browser. Shape callbacks have `element`, `shape`, `text`, and the current document. Implement `toSVG` for anything that must survive portable SVG export. Unknown kinds remain saved and render as placeholders when the application has not registered them.

`defineKind` returns the definition. Pass it in `createBoard({ kinds })` or `createDoc({ kinds })` for that instance. `registerKind` installs a default for boards created afterward and returns an uninstall function:

```ts
import { registerKind } from 'anniedrawing';
const uninstall = registerKind(badge);
```

Custom kind `defaults` supply item properties before validation. A kind may also provide a Valibot `schema` for its extra fields. That schema runs during imports and operation validation. Pass the same kind definitions to `createDoc(..., { kinds })` for headless validation.

A local-coordinate `outline(item)` supplies one or more `{ points: [{ x, y }], closed }` shapes for hit testing and attached connector routing in the live board, exports, and headless deletion. Explicit normalized connector anchors stay exact. Automatic and named-side endpoints meet the custom outline. `summarize(item)` supplies the accessible item label.

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

Keep custom schemas and callbacks in trusted application code. The document stores the kind name and JSON fields. Opening a file does not import a module or run an embedded callback.

## Mount, paint, and handles

`mount(view)` creates custom content once and may return a cleanup function. Cleanup runs when the kind changes or the view is destroyed. Custom `mount` and `paint` callbacks own the shape, text, and auxiliary content. The stage owns the wrapper's position, size, opacity, and accessible label. `paint(view, item, changed)` receives a set containing the changed groups: `transform`, `geometry`, `style`, `text`, or `content`.

A custom handle uses unrotated coordinates inside the item. Return a patch from `dragHandle`. The editor previews it as a draft and commits one undoable operation on release.

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
