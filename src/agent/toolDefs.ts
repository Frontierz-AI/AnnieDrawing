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
import { DescribeSchema, OpsSchema, QuerySchema } from '../core/schema';
const scope = v.optional(v.picklist(['doc', 'page', 'selection', 'viewport']));
const ReadSchema = v.object({ scope });
const ApplySchema = v.object({
  ops: OpsSchema,
  origin: v.optional(v.string()),
  label: v.optional(v.string()),
  dryRun: v.optional(v.boolean()),
  agentName: v.optional(v.string()),
});
const SnapshotSchema = v.object({
  scope,
  scale: v.optional(v.pipe(v.number(), v.minValue(0.1), v.maxValue(4))),
  labels: v.optional(v.boolean()),
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
    'Atomically apply drawing operations. Supply IDs when later operations reference new items. Relative placement avoids coordinate guessing. Use dryRun to validate before editing.',
  board_snapshot:
    'Export a PNG image of a live browser board. Item ID labels let a vision model refer back to the document. Requires a board with export support.',
  board_view_fit:
    'Fit the live board camera to all content or the supplied item IDs. Requires a live browser board.',
};
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export const toolDefs: ToolDefinition[] = Object.entries(toolSchemas).map(([name, schema]) => ({
  name,
  description: descriptions[name as keyof typeof toolSchemas],
  inputSchema: toJsonSchema(schema, { errorMode: 'ignore' }) as unknown as Record<string, unknown>,
}));
export interface AgentBoard {
  get: DocModel['get'];
  query: DocModel['query'];
  describe: DocModel['describe'];
  apply: DocModel['apply'];
  toJSON?: () => AnnieDoc;
  read?: (scope?: Scope) => AnnieDoc;
  export?: (format: 'png', options?: ExportOptions) => Promise<Blob | string> | Blob | string;
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
          agentName: args.agentName,
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
