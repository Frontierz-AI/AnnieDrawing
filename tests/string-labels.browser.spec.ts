import { expect, test } from '@playwright/test';

test('a browser board stores and measures labels sent as plain strings', async ({ page }) => {
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.length);
  const stored = await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    await board.ready;
    board.clear();
    const created = board.apply(
      [
        { op: 'add', item: { id: 'title', kind: 'text', text: 'A heading for the plan' } },
        { op: 'add', item: { id: 'box', kind: 'rect', x: 0, y: 200, text: 'Start' } },
      ],
      { origin: 'agent:planner', reveal: 'none' },
    );
    const width = board.get('title')!.w;
    const patched = board.apply(
      [{ op: 'set', id: 'title', patch: { text: 'A much longer heading for the whole plan' } }],
      { origin: 'agent:planner' },
    );
    return {
      ok: created.ok && patched.ok,
      title: board.get('title')!.text,
      box: board.get('box')!.text,
      grew: board.get('title')!.w > width,
      label: document.querySelector('[data-ad-id="box"] .ad-text')?.textContent,
    };
  });
  expect(stored).toEqual({
    ok: true,
    title: { value: 'A much longer heading for the whole plan' },
    box: { value: 'Start' },
    grew: true,
    label: 'Start',
  });
});
