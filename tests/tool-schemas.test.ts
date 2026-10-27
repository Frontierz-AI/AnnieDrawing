import { toJsonSchema } from '@valibot/to-json-schema';
import { describe, expect, it } from 'vitest';
import { createDoc } from '../src/core';
import { runTool, toolDefs } from '../src/agent';
import { toolSchemas } from '../src/agent/toolDefs';

describe('generated agent input schemas', () => {
  it('publishes the complete JSON Schema of every runtime validator', () => {
    expect(toolDefs.map((tool) => tool.name)).toEqual(Object.keys(toolSchemas));
    for (const tool of toolDefs) {
      const schema = toolSchemas[tool.name as keyof typeof toolSchemas];
      expect(tool.inputSchema, tool.name).toEqual(toJsonSchema(schema, { errorMode: 'ignore' }));
    }
  });

  it('advertises the defaults that snapshot dispatch actually uses', async () => {
    const calls: unknown[][] = [];
    const board = Object.assign(createDoc(), {
      export: (...args: unknown[]) => {
        calls.push(args);
        return 'data:image/png;base64,';
      },
    });
    await runTool(board, 'board_snapshot');
    const schema = toolDefs.find((tool) => tool.name === 'board_snapshot')!.inputSchema;
    const properties = schema.properties as Record<string, { default: unknown }>;
    const defaults = Object.fromEntries(
      Object.entries(properties).map(([key, property]) => [key, property.default]),
    );
    expect(calls).toEqual([['png', defaults]]);
    await runTool(board, 'board_snapshot', {
      scope: 'page',
      scale: 1,
      labels: false,
      colors: 16,
      maxBytes: 32768,
    });
    expect(calls[1]).toEqual([
      'png',
      { scope: 'page', scale: 1, labels: false, colors: 16, maxBytes: 32768 },
    ]);
  });
});
