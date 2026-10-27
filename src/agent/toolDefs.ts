import * as v from 'valibot';
import inputSchemas from './toolInputSchemas.generated.json';
import { toolSchemas } from './toolSchemas';
export { toolSchemas } from './toolSchemas';
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
import { VISION_PNG } from '../core/schema';
const descriptions: Record<keyof typeof toolSchemas, string> = {
  board_describe:
    'Read a deterministic text description of the board, item IDs, connections, and layout. Start here before editing.',
  board_read: 'Read a deep JSON copy of the drawing. Use item IDs in subsequent operations.',
  board_query:
    'Find items by kind, text, bounds, parent, metadata, or connected endpoint. Filters combine with AND.',
  board_apply:
    'Atomically apply drawing operations. Supply IDs when later operations reference new items. Relative placement avoids coordinate guessing; at a taken slot an agent add is inserted before the node it flows into (downstream nodes move over; result.moved lists them), goes past a node it follows, or stacks beside an unconnected one. A place object on the item is used when the operation omits place. Labeled nodes that would cover a similar label are placed to its right so flowchart steps do not stack. A node sent without x, y, or place is placed from the batch arrows (right of its source, or left of its target) and an unconnected one goes right of existing content, so diagrams need no coordinates. Agent creates grow labeled boxes and titles to fit text (standalone text defaults to 600 wide). Omitted fills on rect, ellipse, diamond, and note store a varied palette tint. An omitted connector route stores elbow; automatic elbows prefer lanes around boxes and earlier connectors, and may pick another attachment side. Use dryRun to validate before editing. Pass expectedRevision from a prior read to reject the whole batch with STALE_REVISION if the document changed.',
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
export const toolDefs: ToolDefinition[] = Object.keys(toolSchemas).map((name) => {
  const key = name as keyof typeof toolSchemas;
  return {
    name,
    description: descriptions[key],
    inputSchema: inputSchemas[key],
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
