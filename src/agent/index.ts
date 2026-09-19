/** Agent tool definitions, dispatch, descriptions, queries, and placement. */
export { toolDefs, runTool } from './toolDefs';
export type { ToolDefinition, AgentBoard } from './toolDefs';
export { CATALOG_VERSION, KIND_CATALOG, kindsSince } from '../core/catalog';
export type { KindCatalogEntry, KindCatalogSnapshot } from '../core/catalog';
export { describeDoc } from './describe';
export { queryDoc } from './query';
export { placeItem } from './place';
export {
  DocumentSchema,
  ItemSchema,
  OpSchema,
  OpsSchema,
  QuerySchema,
  DescribeSchema,
  PlacementSchema,
  LIMITS,
} from '../core/schema';
export type { Op, Query, DescribeOptions, Placement, ApplyResult } from '../core/types';
