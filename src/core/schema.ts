import * as v from 'valibot';
export const LIMITS = {
  maxBatch: 1000,
  maxItems: 50000,
  maxCoordinate: 1000000,
  maxTextLength: 100000,
  maxDepth: 32,
  maxPoints: 100000,
  maxMediaLength: 20000000,
  maxHistory: 100,
  maxSessionLog: 500,
  maxJsonDepth: 104,
} as const;
const finite = v.pipe(v.number(), v.finite());
const coordinate = v.pipe(
  finite,
  v.minValue(-LIMITS.maxCoordinate),
  v.maxValue(LIMITS.maxCoordinate),
);
const dimension = v.pipe(finite, v.minValue(0), v.maxValue(LIMITS.maxCoordinate));
const id = v.pipe(v.string(), v.minLength(1), v.maxLength(160));
const text = v.pipe(v.string(), v.maxLength(LIMITS.maxTextLength));
export const PointSchema = v.object({ x: coordinate, y: coordinate });
export const BoxSchema = v.object({ x: coordinate, y: coordinate, w: dimension, h: dimension });
export const StyleSchema = v.object({
  stroke: v.optional(v.string()),
  strokeWidth: v.optional(v.pipe(dimension, v.maxValue(1000))),
  dash: v.optional(v.picklist(['solid', 'dashed', 'dotted'])),
  fill: v.optional(v.string()),
  fillMode: v.optional(v.picklist(['solid', 'tint', 'hatch'])),
  corner: v.optional(dimension),
  opacity: v.optional(v.pipe(finite, v.minValue(0), v.maxValue(1))),
});
export const TextSchema = v.object({
  value: text,
  align: v.optional(v.picklist(['start', 'center', 'end'])),
  valign: v.optional(v.picklist(['top', 'middle', 'bottom'])),
  size: v.optional(
    v.union([v.picklist(['s', 'm', 'l', 'xl']), v.pipe(finite, v.minValue(1), v.maxValue(1000))]),
  ),
  font: v.optional(v.picklist(['sans', 'serif', 'mono', 'hand'])),
});
const record = v.record(v.string(), v.unknown());
export const EndpointSchema = v.union([
  id,
  v.object({
    item: id,
    side: v.optional(v.picklist(['auto', 'top', 'right', 'bottom', 'left'])),
    anchor: v.optional(
      v.tuple([
        v.pipe(finite, v.minValue(0), v.maxValue(1)),
        v.pipe(finite, v.minValue(0), v.maxValue(1)),
      ]),
    ),
  }),
  PointSchema,
]);
export const ItemSchema: v.GenericSchema = v.lazy(() =>
  v.looseObject({
    id: v.optional(id),
    kind: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
    x: v.optional(coordinate),
    y: v.optional(coordinate),
    w: v.optional(dimension),
    h: v.optional(dimension),
    rotation: v.optional(coordinate),
    style: v.optional(StyleSchema),
    text: v.optional(TextSchema),
    locked: v.optional(v.boolean()),
    hidden: v.optional(v.boolean()),
    name: v.optional(text),
    data: v.optional(record),
    children: v.optional(v.array(ItemSchema)),
    points: v.optional(
      v.pipe(
        v.array(
          v.tupleWithRest([coordinate, coordinate], v.pipe(finite, v.minValue(0), v.maxValue(1))),
        ),
        v.maxLength(LIMITS.maxPoints),
      ),
    ),
    from: v.optional(EndpointSchema),
    to: v.optional(EndpointSchema),
    route: v.optional(v.picklist(['straight', 'elbow', 'curve'])),
    heads: v.optional(
      v.object({
        start: v.optional(v.picklist(['none', 'arrow', 'dot'])),
        end: v.optional(v.picklist(['none', 'arrow', 'dot'])),
      }),
    ),
    waypoints: v.optional(v.array(v.tuple([coordinate, coordinate]))),
    closed: v.optional(v.boolean()),
    autoWidth: v.optional(v.boolean()),
    media: v.optional(id),
    crop: v.optional(BoxSchema),
    href: v.optional(text),
    description: v.optional(text),
    html: v.optional(text),
    mount: v.optional(id),
  }),
);
export const PatchSchema = v.looseObject({
  x: v.optional(coordinate),
  y: v.optional(coordinate),
  w: v.optional(dimension),
  h: v.optional(dimension),
  rotation: v.optional(coordinate),
  style: v.optional(StyleSchema),
  text: v.optional(v.partial(TextSchema)),
  href: v.optional(text),
  description: v.optional(text),
  data: v.optional(record),
  from: v.optional(EndpointSchema),
  to: v.optional(EndpointSchema),
});
export const PlacementSchema = v.object({
  rightOf: v.optional(id),
  leftOf: v.optional(id),
  above: v.optional(id),
  below: v.optional(id),
  inside: v.optional(id),
  near: v.optional(id),
  gap: v.optional(dimension),
  align: v.optional(v.picklist(['start', 'middle', 'end'])),
});
export const MediaSchema = v.object({
  mime: v.pipe(v.string(), v.regex(/^image\/(png|jpeg|gif|webp|avif|svg\+xml)$/)),
  w: dimension,
  h: dimension,
  src: v.pipe(v.string(), v.maxLength(LIMITS.maxMediaLength)),
});
export const PageSchema = v.object({
  id,
  name: text,
  background: v.optional(v.string()),
  items: v.array(ItemSchema),
});
export const DocumentSchema = v.object({
  format: v.literal('anniedrawing'),
  version: v.literal(2),
  meta: v.looseObject({ title: text, modified: v.optional(v.string()) }),
  pages: v.pipe(v.array(PageSchema), v.minLength(1)),
  media: v.record(v.string(), MediaSchema),
});
export const OpSchema = v.variant('op', [
  v.object({
    op: v.literal('add'),
    item: ItemSchema,
    page: v.optional(id),
    parent: v.optional(id),
    index: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
    place: v.optional(PlacementSchema),
  }),
  v.object({ op: v.literal('set'), id, patch: PatchSchema }),
  v.object({ op: v.literal('remove'), id }),
  v.object({
    op: v.literal('order'),
    id,
    to: v.union([
      v.picklist(['front', 'back', 'forward', 'backward']),
      v.pipe(v.number(), v.integer(), v.minValue(0)),
    ]),
  }),
  v.object({
    op: v.literal('reparent'),
    id,
    parent: v.nullable(id),
    index: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  }),
  v.object({
    op: v.literal('page.add'),
    index: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
    page: v.object({
      id: v.optional(id),
      name: text,
      background: v.optional(v.string()),
      items: v.optional(v.array(ItemSchema)),
    }),
  }),
  v.object({
    op: v.literal('page.set'),
    id,
    patch: v.object({ name: v.optional(text), background: v.optional(v.string()) }),
  }),
  v.object({ op: v.literal('page.remove'), id }),
  v.object({
    op: v.literal('meta.set'),
    patch: v.looseObject({ title: v.optional(text), modified: v.optional(v.string()) }),
  }),
  v.object({ op: v.literal('media.set'), id, media: MediaSchema }),
  v.object({ op: v.literal('media.remove'), id }),
]);
export const OpsSchema = v.pipe(v.array(OpSchema), v.maxLength(LIMITS.maxBatch));
export const QuerySchema = v.object({
  kind: v.optional(v.union([v.string(), v.array(v.string())])),
  /** JSON tools send a string; the JavaScript Query type also accepts RegExp. */
  text: v.optional(v.string()),
  within: v.optional(BoxSchema),
  connectedTo: v.optional(id),
  direction: v.optional(v.picklist(['in', 'out', 'both'])),
  inside: v.optional(id),
  data: v.optional(record),
  hidden: v.optional(v.boolean()),
  locked: v.optional(v.boolean()),
  page: v.optional(id),
});
export const DescribeSchema = v.object({
  scope: v.optional(v.picklist(['doc', 'page', 'selection', 'viewport'])),
  detail: v.optional(v.picklist(['brief', 'normal', 'full'])),
  relations: v.optional(v.boolean()),
  freeSpace: v.optional(v.boolean()),
  maxItems: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10000))),
  selection: v.optional(v.array(id)),
  page: v.optional(id),
  since: v.optional(v.pipe(v.number(), v.finite())),
});
export function schemaError(schema: v.GenericSchema, value: unknown): string | undefined {
  const result = v.safeParse(schema, value);
  return result.success
    ? undefined
    : result.issues
        .map((issue) => `${issue.path?.map((p) => p.key).join('.') ?? 'value'}: ${issue.message}`)
        .join('; ');
}
