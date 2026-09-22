import * as v from 'valibot';
import { toJsonSchema } from '@valibot/to-json-schema';
import type {
  AnnieDoc,
  ApplyOptions,
  DescribeOptions,
  DocModel,
  ExportOptions,
  Op,
  Query,
  Scope,
} from '../core/types';
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
const SnapshotSchema = v.object({
  scope: v.optional(v.picklist(['doc', 'page', 'selection', 'viewport']), 'viewport'),
  scale: v.optional(v.pipe(v.number(), v.minValue(0.1), v.maxValue(4)), 2),
  labels: v.optional(v.boolean(), true),
  colors: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(2), v.maxValue(256)),
    VISION_PNG.colors,
  ),
  maxBytes: v.optional(v.pipe(v.number(), v.minValue(1)), VISION_PNG.maxBytes),
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
const descriptions: Record<keyof typeof toolSchemas, string> = {
  board_describe:
    'Read a deterministic text description of the board, item IDs, connections, and layout. Start here before editing.',
  board_read: 'Read a deep JSON copy of the drawing. Use item IDs in subsequent operations.',
  board_query:
    'Find items by kind, text, bounds, parent, metadata, or connected endpoint. Filters combine with AND.',
  board_apply:
    'Atomically apply drawing operations. Supply IDs when later operations reference new items. Relative placement avoids coordinate guessing; at a taken slot an agent add is inserted before the node it flows into (downstream nodes move over; result.moved lists them), goes past a node it follows, or stacks beside an unconnected one. A place object on the item is used when the operation omits place. Labeled nodes that would cover a similar label are placed to its right so flowchart steps do not stack. Place a new node beside the node it connects to, with its arrow in the same batch. Agent creates grow labeled boxes and titles to fit text (standalone text defaults to 600 wide). Omitted fills on rect, ellipse, diamond, and note store a varied palette tint. An omitted connector route stores elbow; automatic elbows prefer lanes around boxes and earlier connectors, and may pick another attachment side. Use dryRun to validate before editing. Pass expectedRevision from a prior read to reject the whole batch with STALE_REVISION if the document changed.',
  board_snapshot:
    'Export a labeled PNG of a live browser board for vision models. Defaults to the viewport, item ID labels, a 32-color indexed PNG, and a 240 KiB budget. Requires a board with export support.',
  board_view_fit:
    'Fit the live board camera to all content or the supplied item IDs. Requires a live browser board.',
};
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export const toolDefs: ToolDefinition[] = Object.entries(toolSchemas).map(([name, schema]) => {
  const inputSchema = toJsonSchema(schema, { errorMode: 'ignore' }) as unknown as Record<
    string,
    unknown
  >;
  if (name === 'board_snapshot') {
    const properties = (inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
    properties.scope = { ...properties.scope, default: 'viewport' };
    properties.scale = { ...properties.scale, default: 2 };
    properties.labels = { ...properties.labels, default: true };
    properties.colors = { ...properties.colors, default: VISION_PNG.colors };
    properties.maxBytes = { ...properties.maxBytes, default: VISION_PNG.maxBytes };
  }
  return {
    name,
    description: descriptions[name as keyof typeof toolSchemas],
    inputSchema,
  };
});
export interface AgentBoard {
  get: DocModel['get'];
  query: DocModel['query'];
  describe: DocModel['describe'];
  apply: DocModel['apply'];
  agentName?: string;
  toJSON?: () => AnnieDoc;
  read?: (scope?: Scope) => AnnieDoc;
  export?: (
    format: 'png' | 'jpeg' | 'webp',
    options?: ExportOptions,
  ) => Promise<Blob | string> | Blob | string;
  view?: {
    fit: (ids?: string[]) => unknown;
  };
}
export async function runTool(
  board: AgentBoard,
  name: string,
  input: unknown = {},
): Promise<unknown> {
  if (!Object.hasOwn(toolSchemas, name))
    return {
      ok: false,
      error: {
        code: 'UNKNOWN_TOOL',
        message: `Unknown tool ${name}. Available tools: ${toolDefs.map((t) => t.name).join(', ')}.`,
      },
    };
  const schema = toolSchemas[name as keyof typeof toolSchemas],
    result = v.safeParse(schema, input);
  if (!result.success)
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: result.issues.map((issue) => issue.message).join('; '),
      },
    };
  const args = result.output as Record<string, unknown>;
  try {
    if (name === 'board_describe') return board.describe(args as DescribeOptions);
    if (name === 'board_read') {
      if (board.read) return board.read(args.scope as Scope | undefined);
      if (args.scope && args.scope !== 'doc')
        return {
          ok: false,
          error: {
            code: 'UNSUPPORTED_SCOPE',
            message:
              'Headless documents support doc scope. Use query with page or inside for narrower results.',
          },
        };
      return board.toJSON?.();
    }
    if (name === 'board_query') return board.query(args as Query);
    if (name === 'board_apply')
      return board.apply(
        args.ops as Op[],
        {
          origin:
            typeof args.origin === 'string' && args.origin.startsWith('agent:')
              ? args.origin
              : 'agent:tool',
          label: args.label,
          dryRun: args.dryRun,
          expectedRevision: args.expectedRevision,
          reveal: args.reveal,
          ...(board.agentName ? {} : { agentName: args.agentName }),
        } as ApplyOptions,
      );
    if (name === 'board_snapshot') {
      if (!board.export)
        return {
          ok: false,
          error: {
            code: 'BROWSER_REQUIRED',
            message:
              'PNG snapshots require a live browser board. Use board_read or board_describe for a headless document.',
          },
        };
      return await board.export('png', {
        scope: (args.scope as Scope) ?? 'viewport',
        scale: (args.scale as number) ?? 2,
        labels: args.labels !== false,
        colors: (args.colors as number) ?? VISION_PNG.colors,
        maxBytes: (args.maxBytes as number) ?? VISION_PNG.maxBytes,
      });
    }
    if (name === 'board_view_fit') {
      if (!board.view)
        return {
          ok: false,
          error: {
            code: 'BROWSER_REQUIRED',
            message: 'Camera controls require a live browser board.',
          },
        };
      board.view.fit(args.ids as string[] | undefined);
      return { ok: true };
    }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'TOOL_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
