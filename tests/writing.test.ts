import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { runTool } from '../src/agent';
import { toolSchemas } from '../src/agent/toolSchemas';
import { createDoc } from '../src/core/doc';
import type { Op } from '../src/core/types';

const ops: Op[] = [
  { op: 'add', item: { id: 'title', kind: 'text', x: 0, y: 0, text: { value: 'Written later' } } },
  { op: 'add', item: { id: 'box', kind: 'rect', x: 0, y: 200, w: 160, h: 80, text: 'Box' } },
];

describe('presentation options', () => {
  it('do not change the committed document, the change log, or a dry run', () => {
    const plain = createDoc();
    const timed = createDoc();
    const a = plain.apply(ops, { origin: 'agent:tutor', label: 'Write' });
    const b = timed.apply(ops, {
      origin: 'agent:tutor',
      label: 'Write',
      presentation: { durationMs: 4200 },
    });
    expect(b).toEqual(a);
    expect(timed.toJSON()).toEqual(plain.toJSON());
    expect(timed.changesSince(0)).toEqual(plain.changesSince(0));
    const dry = timed.apply([{ op: 'remove', id: 'title' }], {
      origin: 'agent:tutor',
      dryRun: true,
      presentation: { durationMs: 1000 },
    });
    expect(dry.ok).toBe(true);
    expect(timed.get('title')).toBeDefined();
    expect(JSON.stringify(timed.toJSON())).not.toContain('durationMs');
  });

  it('pass through board_apply and are validated there', async () => {
    const schema = toolSchemas.board_apply;
    expect(v.safeParse(schema, { ops, presentation: { durationMs: 2000 } }).success).toBe(true);
    expect(v.safeParse(schema, { ops, presentation: { durationMs: -1 } }).success).toBe(false);
    expect(v.safeParse(schema, { ops, presentation: { durationMs: 60001 } }).success).toBe(false);
    const doc = createDoc();
    const seen: unknown[] = [];
    const board = {
      ...doc,
      apply: (batch: Op[], options?: Parameters<typeof doc.apply>[1]) => {
        seen.push(options?.presentation);
        return doc.apply(batch, options);
      },
    };
    const result = (await runTool(board, 'board_apply', {
      ops,
      presentation: { durationMs: 3000 },
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(seen).toEqual([{ durationMs: 3000 }]);
  });
});
