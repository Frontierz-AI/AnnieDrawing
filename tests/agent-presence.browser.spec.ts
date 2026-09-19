import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.length);
  await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    await board.ready;
    board.clear();
    board.stage.lens.set({ x: 0, y: 0, zoom: 1 });
  });
}

async function place(page: Page, id = 'idea', agentName?: string) {
  return page.evaluate(
    ({ id, agentName }) => {
      const board = window.__anniedrawing![0];
      const result = board.apply(
        [
          {
            op: 'add',
            item: {
              id,
              kind: 'rect',
              x: 300,
              y: 240,
              w: 180,
              h: 110,
              style: { fill: 'teal', opacity: 0.45 },
              text: { value: 'An idea' },
            },
          },
        ],
        { origin: 'agent:planner', label: 'Place an idea', agentName },
      );
      return {
        result,
        visibility: getComputedStyle(board.stage.world.querySelector(`[data-ad-id="${id}"]`)!)
          .visibility,
      };
    },
    { id, agentName },
  );
}

test('AI placement commits immediately, enters from outside and reveals only after arrival', async ({
  page,
}, info) => {
  await ready(page);
  await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    board.apply([
      { op: 'add', item: { id: 'mine', kind: 'ellipse', x: 580, y: 340, w: 90, h: 90 } },
    ]);
    board.select(['mine']);
    board.focus();
  });
  const { result, visibility } = await place(page);
  expect(result.ok).toBe(true);
  expect(visibility).toBe('hidden');
  const item = page.locator('[data-ad-id="idea"]');
  const cursor = page.locator('.ad-agent-cursor');
  await expect(cursor).toHaveCount(1);
  await expect(cursor.locator('span')).toHaveCount(0);
  await expect(cursor).toHaveAttribute('aria-hidden', 'true');
  await expect(cursor).toHaveCSS('pointer-events', 'none');
  expect(
    await cursor.evaluate((element) => {
      const origin = new DOMMatrix((element as HTMLElement).style.transform);
      const root = element.parentElement!;
      return (
        origin.e + 7 < 0 ||
        origin.f + 7 < 0 ||
        origin.e > root.clientWidth ||
        origin.f > root.clientHeight
      );
    }),
  ).toBe(true);
  const committed = await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    return {
      item: board.get('idea'),
      selection: board.selection,
      view: board.stage.lens.state,
      svg: await board.export('svg'),
      focused: document.activeElement === board.stage.root,
    };
  });
  expect(committed.item?.text?.value).toBe('An idea');
  expect(committed.selection).toEqual(['mine']);
  expect(committed.view).toEqual({ x: 0, y: 0, zoom: 1 });
  expect(committed.focused).toBe(true);
  expect(committed.svg).toContain('An idea');
  expect(committed.svg).not.toContain('ad-agent');
  await page.waitForFunction(() => {
    const cursor = document.querySelector('.ad-agent-cursor');
    if (!cursor) return false;
    const rect = cursor.getBoundingClientRect();
    return rect.x > 20 && rect.y > 20 && document.querySelector('.ad-agent-pending');
  });
  await page.screenshot({ path: info.outputPath('agent-arriving.png') });
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('[data-ad-id="idea"]')!).visibility === 'visible',
  );
  const landing = await cursor.boundingBox();
  expect(landing!.x + 7).toBeCloseTo(390, 0);
  expect(landing!.y + 7).toBeCloseTo(295, 0);
  const settling = await item.boundingBox();
  expect(settling!.x + settling!.width / 2).toBeCloseTo(390, 0);
  expect(settling!.y + settling!.height / 2).toBeCloseTo(295, 0);
  await expect(cursor).toHaveCount(0);
  await expect(item).toHaveCSS('opacity', '0.45');
  await expect(item).toHaveCSS('scale', 'none');
  await page.evaluate(() => window.__anniedrawing![0].undo());
  await expect(item).toHaveCount(0);
  await expect(page.locator('[data-ad-id="mine"]')).toBeVisible();
});

test('an apply can label the visiting cursor, and markup in the name stays text', async ({
  page,
}) => {
  await ready(page);
  await place(page, 'named', 'Anita');
  const cursor = page.locator('.ad-agent-cursor');
  await expect(cursor.locator('span')).toHaveText('Anita');
  await expect(cursor).toHaveCount(0);
  await page.evaluate(() =>
    window.__anniedrawing![0].apply(
      [{ op: 'add', item: { id: 'escaped', kind: 'rect', x: 300, y: 240, w: 100, h: 80 } }],
      { origin: 'agent:planner', agentName: '<b>Hack</b>' },
    ),
  );
  await expect(page.locator('.ad-agent-cursor span')).toHaveText('<b>Hack</b>');
  await expect(page.locator('.ad-agent-cursor span b')).toHaveCount(0);
});

test('one cursor visits sequential batches and groups reveal their children together', async ({
  page,
}) => {
  await ready(page);
  await place(page, 'first');
  await page.evaluate(() =>
    window.__anniedrawing![0].apply(
      [
        {
          op: 'add',
          item: {
            id: 'group',
            kind: 'group',
            x: 550,
            y: 230,
            w: 200,
            h: 150,
            children: [
              {
                id: 'child',
                kind: 'note',
                x: 550,
                y: 230,
                w: 200,
                h: 150,
                text: { value: 'Together' },
              },
            ],
          },
        },
      ],
      { origin: 'agent:another' },
    ),
  );
  const first = page.locator('[data-ad-id="first"]');
  const child = page.locator('[data-ad-id="child"]');
  await expect(first).toBeVisible();
  await expect(child).toBeHidden();
  await expect(page.locator('.ad-agent-cursor')).toHaveCount(1);
  await expect(child).toBeVisible();
  await expect(page.locator('[data-ad-id="group"]')).toBeVisible();
  await expect(page.locator('.ad-agent-cursor')).toHaveCount(0);
  await expect(page.locator('.ad-agent-pending')).toHaveCount(0);
});

test('immediate fit uses the new camera; a later pan cancels presentation without hiding items', async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    board.apply(
      [{ op: 'add', item: { id: 'far', kind: 'rect', x: 12000, y: 9000, w: 200, h: 130 } }],
      { origin: 'agent:planner' },
    );
    board.view.fit();
  });
  await expect(page.locator('.ad-agent-cursor')).toHaveCount(1);
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('[data-ad-id="far"]')!).visibility === 'visible',
  );
  const landing = await page.locator('.ad-agent-cursor').boundingBox();
  const target = await page.evaluate(() =>
    window.__anniedrawing![0].stage.lens.toScreen({ x: 12100, y: 9065 }),
  );
  expect(landing!.x + 7).toBeCloseTo(target.x, 0);
  expect(landing!.y + 7).toBeCloseTo(target.y, 0);
  await page.evaluate(() => window.__anniedrawing![0].stage.lens.set({ x: 0, y: 0, zoom: 1 }));
  await expect(page.locator('.ad-agent-cursor')).toHaveCount(0);
  await place(page);
  await expect(page.locator('.ad-agent-cursor')).toHaveCount(1);
  await page.mouse.wheel(0, 40);
  await expect(page.locator('.ad-agent-cursor')).toHaveCount(0);
  await expect(page.locator('[data-ad-id="idea"]')).toBeVisible();
});

test('human input, undo, removal and page changes clear every pending visual', async ({ page }) => {
  await ready(page);
  await place(page, 'click');
  await page.mouse.click(700, 470);
  await expect(page.locator('.ad-agent-cursor,.ad-agent-pending')).toHaveCount(0);
  await expect(page.locator('[data-ad-id="click"]')).toBeVisible();
  await place(page, 'undo');
  await page.evaluate(() => window.__anniedrawing![0].undo());
  await expect(page.locator('[data-ad-id="undo"],.ad-agent-pending,.ad-agent-cursor')).toHaveCount(
    0,
  );
  await place(page, 'removed');
  await page.evaluate(() => window.__anniedrawing![0].apply([{ op: 'remove', id: 'removed' }]));
  await expect(
    page.locator('[data-ad-id="removed"],.ad-agent-pending,.ad-agent-cursor'),
  ).toHaveCount(0);
  await place(page, 'page-switch');
  await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    board.apply([{ op: 'page.add', page: { id: 'second', name: 'Next' } }]);
    board.setPage('second');
  });
  await expect(page.locator('.ad-agent-pending,.ad-agent-cursor')).toHaveCount(0);
  await page.evaluate(() =>
    window.__anniedrawing![0].setPage(window.__anniedrawing![0].read().pages[0].id),
  );
  await expect(page.locator('[data-ad-id="page-switch"]')).toBeVisible();
});

test('reduced motion is immediate and changing that preference finishes a running arrival', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  expect((await place(page)).visibility).toBe('visible');
  await expect(page.locator('.ad-agent-cursor')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await place(page, 'second');
  await expect(page.locator('.ad-agent-cursor')).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.ad-agent-pending,.ad-agent-cursor')).toHaveCount(0);
  await expect(page.locator('[data-ad-id="second"]')).toBeVisible();
});

test('dry runs, rejected operations, user edits and other pages do not animate', async ({
  page,
}) => {
  await ready(page);
  const results = await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    const operation = {
      op: 'add' as const,
      item: { id: 'item', kind: 'rect', x: 300, y: 230, w: 100, h: 100 },
    };
    const dry = board.apply([operation], { origin: 'agent:planner', dryRun: true });
    const user = board.apply([operation], { origin: 'user' });
    const invalid = board.apply([operation], { origin: 'agent:planner' });
    board.apply([{ op: 'page.add', page: { id: 'other', name: 'Other' } }]);
    const other = board.apply(
      [{ ...operation, page: 'other', item: { ...operation.item, id: 'elsewhere' } }],
      { origin: 'agent:planner' },
    );
    return [dry.ok, user.ok, invalid.ok, other.ok];
  });
  expect(results).toEqual([true, true, false, true]);
  await expect(page.locator('.ad-agent-cursor,.ad-agent-pending')).toHaveCount(0);
  await expect(page.locator('[data-ad-id="item"]')).toBeVisible();
  await page.evaluate(() =>
    window.__anniedrawing![0].apply(
      [{ op: 'add', item: { id: 'offscreen', kind: 'rect', x: 20000, y: 20000, w: 100, h: 100 } }],
      { origin: 'agent:planner' },
    ),
  );
  await expect(page.locator('.ad-agent-pending')).toHaveCount(0);
  await expect(page.locator('.ad-agent-cursor')).toHaveCount(0);
});

test('opt out and destroy preserve the normal lifecycle, and no animation state is serialized', async ({
  page,
}) => {
  await ready(page);
  const immediate = await page.evaluate(async () => {
    const { createBoard } = await import('/src/board.ts' as string);
    window.__anniedrawing![0].destroy();
    const board = createBoard(document.getElementById('app')!, { agentPresence: false, ui: false });
    board.apply(
      [{ op: 'add', item: { id: 'plain', kind: 'rect', x: 300, y: 220, w: 100, h: 100 } }],
      { origin: 'agent:planner' },
    );
    return {
      visibility: getComputedStyle(board.stage.world.querySelector('[data-ad-id="plain"]')!)
        .visibility,
      json: JSON.stringify(board.read()),
    };
  });
  expect(immediate.visibility).toBe('visible');
  expect(immediate.json).not.toContain('presence');
  await expect(page.locator('.ad-agent-cursor')).toHaveCount(0);
  await ready(page);
  await place(page);
  await expect(page.locator('.ad-agent-cursor')).toHaveCount(1);
  await page.evaluate(() => window.__anniedrawing![0].destroy());
  await expect(page.locator('.ad-root,.ad-agent-cursor')).toHaveCount(0);
});

test('mobile and dark mode keep a small distinct cursor inside the board without scrolling', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    board.setTheme('dark');
    board.apply(
      [
        {
          op: 'add',
          item: {
            id: 'mobile',
            kind: 'note',
            x: 90,
            y: 340,
            w: 190,
            h: 140,
            text: { value: 'One little idea' },
          },
        },
      ],
      { origin: 'agent:planner' },
    );
  });
  await expect(page.locator('[data-ad-id="mobile"]')).toBeVisible();
  await page.screenshot({ path: info.outputPath('mobile-agent-arrival.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(page.locator('.ad-agent-cursor')).toHaveCSS('width', '36px');
  await expect(page.locator('.ad-agent-cursor svg')).toHaveCSS('filter', 'none');
  await expect(page.locator('.ad-agent-cursor')).toHaveCount(0);
});

test('large batches stay brief, skip offscreen stops and preserve connector geometry', async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    board.apply(
      [
        ...Array.from({ length: 10 }, (_, i) => ({
          op: 'add' as const,
          item: {
            id: `outside-${i}`,
            kind: 'rect',
            x: 20000,
            y: 20000,
            w: 50,
            h: 50,
          },
        })),
        ...Array.from({ length: 40 }, (_, i) => ({
          op: 'add' as const,
          item: {
            id: `batch-${i}`,
            kind: 'rect',
            x: 250 + (i % 6) * 25,
            y: 210 + Math.floor(i / 6) * 25,
            w: 50,
            h: 50,
          },
        })),
        {
          op: 'add',
          item: {
            id: 'link',
            kind: 'connector',
            from: { item: 'batch-0', side: 'right' },
            to: { item: 'batch-39', side: 'left' },
            route: 'curve',
            style: { opacity: 0.6 },
          },
        },
      ],
      { origin: 'agent:planner' },
    );
  });
  const cursor = page.locator('.ad-agent-cursor');
  await expect(cursor).toHaveCount(1);
  await expect(page.locator('[data-ad-id="batch-0"]')).toBeVisible();
  await expect(page.locator('[data-ad-id="batch-39"]')).toBeHidden();
  const geometry = await page.locator('[data-ad-id="link"] .ad-shape').innerHTML();
  await expect(page.locator('[data-ad-id="batch-39"]')).toBeVisible({ timeout: 8000 });
  await expect(cursor).toHaveCount(0);
  await expect(page.locator('[data-ad-id="link"]')).toHaveCSS('transform', 'none');
  await expect(page.locator('[data-ad-id="link"]')).toHaveCSS('opacity', '0.6');
  expect(await page.locator('[data-ad-id="link"] .ad-shape').innerHTML()).toBe(geometry);
  await expect(page.locator('.ad-agent-pending')).toHaveCount(0);
});
