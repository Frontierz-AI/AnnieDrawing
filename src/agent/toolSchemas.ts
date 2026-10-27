import * as v from 'valibot';
import { DescribeSchema, OpsSchema, QuerySchema, VISION_PNG } from '../core/schema';

const scope = v.optional(v.picklist(['doc', 'page', 'selection', 'viewport']));
const ReadSchema = v.object({ scope });
const ApplySchema = v.object({
  ops: OpsSchema,
  origin: v.optional(v.string()),
  label: v.optional(v.string()),
  dryRun: v.optional(v.boolean()),
  expectedRevision: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  agentName: v.optional(v.string()),
  reveal: v.optional(v.picklist(['none', 'fit'])),
});
export const snapshotDefaults = {
  scope: 'viewport',
  scale: 2,
  labels: true,
  colors: VISION_PNG.colors,
  maxBytes: VISION_PNG.maxBytes,
} as const;
const SnapshotSchema = v.object({
  scope: v.optional(v.picklist(['doc', 'page', 'selection', 'viewport']), snapshotDefaults.scope),
  scale: v.optional(v.pipe(v.number(), v.minValue(0.1), v.maxValue(4)), snapshotDefaults.scale),
  labels: v.optional(v.boolean(), snapshotDefaults.labels),
  colors: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(2), v.maxValue(256)),
    snapshotDefaults.colors,
  ),
  maxBytes: v.optional(v.pipe(v.number(), v.minValue(1)), snapshotDefaults.maxBytes),
});
const FitSchema = v.object({ ids: v.optional(v.array(v.string())) });
export const toolSchemas = {
  board_describe: DescribeSchema,
  board_read: ReadSchema,
  board_query: QuerySchema,
  board_apply: ApplySchema,
  board_snapshot: SnapshotSchema,
  board_view_fit: FitSchema,
};
