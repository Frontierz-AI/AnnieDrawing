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
    'Read a deterministic text description of the board, item IDs, connections, marks, and layout. Start here before editing. ", by agent" marks items an agent created this session; a table prints as columns x rows plus its first row; a pending image prints as "image (pending)".',
  board_read: 'Read a deep JSON copy of the drawing. Use item IDs in subsequent operations.',
  board_query:
    'Find items by kind, text, bounds, parent, metadata, or connected endpoint. Filters combine with AND.',
  board_apply:
    'Atomically apply drawing operations. Supply IDs when later operations reference new items. Relative placement avoids coordinate guessing; at a taken slot an agent add is inserted before the node it flows into (downstream nodes move over; result.moved lists them), goes past a node it follows, or stacks beside an unconnected one. A place object on the item is used when the operation omits place. Labeled nodes that would cover a similar label are placed to its right so flowchart steps do not stack. Nodes sent without x, y, or place are laid out together from the batch arrows, including arrows to nodes already on the board, so diagrams need no coordinates: flows in ranks, trees, a hub with its spokes around it, a cycle as a ring, linked chains on their own rows, unconnected nodes in a grid, and a first unconnected text as the title above the diagram. A new diagram goes below or right of existing content; a step inserted into an existing flow can move agent-placed nodes along it (result.moved lists them). Pass layout "none" for node-by-node placement, or a hint such as { "direction": "down" } or { "shape": "radial" }. Agent creates grow labeled boxes and titles to fit text (standalone text defaults to 600 wide; without h it stores the height of its lines). Two text items placed relative to each other sit one line apart. Labels on rect, ellipse, diamond, note, and text accept text { value, format: "md" } for **bold**, *italic*, "- " and "1. " lists, and "# " / "## " headings. A table is { kind: "table", rows: [[...]], header: true } with no w or h; edit cells with set { cells: { "row,column": "text" } }, counted from 0. An image add without w and h is sized from its media; pending: true adds an image placeholder before its media exists, resolved later with media.set plus set { media, pending: false }. A mark { kind: "mark", target, mark: "highlight" | "underline" | "circle" | "box", match? } emphasizes an item or a phrase of its text, follows it, and is removed with it; send no coordinates for it. Omitted fills on rect, ellipse, diamond, and note store a varied palette tint. An omitted connector route stores elbow; automatic elbows attach on the sides where their nodes face each other. The result lists created, updated, and removed ids (plus moved). reveal "created" moves the camera to new items; presentation.durationMs sets how long their arrival takes. Use dryRun to validate before editing. Pass expectedRevision from a prior read to reject the whole batch with STALE_REVISION if the document changed.',
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
    if (name === 'board_describe')
      return board.describe({ overflowHint: true, ...args } as DescribeOptions);
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
          layout: args.layout,
          dryRun: args.dryRun,
          expectedRevision: args.expectedRevision,
          reveal: args.reveal,
          presentation: args.presentation,
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
