import { expect, test, type Page } from '@playwright/test';

async function mount(page: Page, options: Record<string, unknown> = {}) {
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  await page.evaluate(async (options) => {
    for (const board of [...(window.__anniedrawing ?? [])]) board.destroy();
    document.body.innerHTML = '<main id="embed-fixture" style="position:fixed;inset:0"></main>';
    const { createBoard } = await import('/src/board.ts' as string);
    createBoard(document.querySelector('#embed-fixture')!, {
      exposeGlobal: true,
      ...options,
    });
  }, options);
}

test('createBoard does not register window.__anniedrawing unless asked', async ({ page }) => {
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  const registered = await page.evaluate(async () => {
    for (const board of [...(window.__anniedrawing ?? [])]) board.destroy();
    const { createBoard } = await import('/src/board.ts' as string);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0';
    document.body.append(host);
    const board = createBoard(host, { ui: false });
    const global = window.__anniedrawing?.includes(board) ?? false;
    board.destroy();
    host.remove();
    return global;
  });
  expect(registered).toBe(false);
});

test('reveal fit pans to an off-screen create and skips a visible one', async ({ page }) => {
  await mount(page, { ui: false });
  const before = await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    board.stage.lens.set({ x: 0, y: 0, zoom: 1 });
    return { ...board.stage.lens.state };
  });
  const moved = await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    board.apply(
      [{ op: 'add', item: { id: 'far', kind: 'rect', x: 8000, y: 6000, w: 160, h: 100 } }],
      { reveal: 'fit' },
    );
    return { ...board.stage.lens.state };
  });
  expect(moved.x !== before.x || moved.y !== before.y).toBe(true);
  const held = await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    const camera = { ...board.stage.lens.state };
    const center = board.view.center;
    board.apply(
      [
        {
          op: 'add',
          item: { id: 'near', kind: 'rect', x: center.x - 40, y: center.y - 30, w: 80, h: 60 },
        },
      ],
      { reveal: 'fit' },
    );
    return {
      before: camera,
      after: { ...board.stage.lens.state },
    };
  });
  expect(held.after).toEqual(held.before);
});

test('a host agentName labels the cursor without apply.agentName', async ({ page }) => {
  await mount(page, { ui: false, agentName: 'Alex' });
  await page.evaluate(() => {
    window.__anniedrawing![0].apply(
      [{ op: 'add', item: { id: 'named', kind: 'rect', x: 240, y: 180, w: 160, h: 90 } }],
      { origin: 'agent:fellow' },
    );
  });
  const cursor = page.locator('.ad-agent-cursor span');
  await expect(cursor).toHaveText('Alex');
});

test('agentPresence maxStops dumps the rest of the batch after one stop', async ({ page }) => {
  await mount(page, { ui: false, agentPresence: { maxStops: 1 } });
  await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    board.stage.lens.set({ x: 0, y: 0, zoom: 1 });
    board.apply(
      [
        { op: 'add', item: { id: 'one', kind: 'rect', x: 80, y: 80, w: 100, h: 80 } },
        { op: 'add', item: { id: 'two', kind: 'rect', x: 220, y: 80, w: 100, h: 80 } },
        { op: 'add', item: { id: 'three', kind: 'rect', x: 360, y: 80, w: 100, h: 80 } },
      ],
      { origin: 'agent:tool' },
    );
  });
  await expect(page.locator('.ad-agent-cursor')).toHaveCount(1);
  await expect(page.locator('[data-ad-id="one"]')).toBeHidden();
  await page.waitForFunction(() => {
    const pending = document.querySelectorAll('.ad-agent-pending');
    return pending.length <= 1;
  });
  await expect(page.locator('[data-ad-id="two"]')).toBeVisible();
  await expect(page.locator('[data-ad-id="three"]')).toBeVisible();
});

test('jpeg export returns a labeled image/jpeg blob', async ({ page }) => {
  await mount(page, { ui: false });
  const shot = await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    board.apply([
      {
        op: 'add',
        item: { id: 'i_label', kind: 'rect', x: 40, y: 40, w: 200, h: 120, text: { value: 'Box' } },
      },
    ]);
    const blob = (await board.export('jpeg', {
      maxSide: 1280,
      maxBytes: 245760,
      labels: true,
    })) as Blob;
    const svg = (await board.export('svg', { labels: true })) as string;
    return { type: blob.type, size: blob.size, labeled: svg.includes('i_label') };
  });
  expect(shot.type).toBe('image/jpeg');
  expect(shot.size).toBeGreaterThan(0);
  expect(shot.size).toBeLessThanOrEqual(245760);
  expect(shot.labeled).toBe(true);
});

test('ui.pages false hides page chips and setPage still works', async ({ page }) => {
  await mount(page, { ui: { menu: false, export: false, pages: false } });
  await expect(page.getByRole('navigation', { name: 'Pages' })).toHaveCount(0);
  const pageId = await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    board.apply([{ op: 'page.add', page: { id: 'p_two', name: 'Second' } }]);
    board.setPage('p_two');
    return board.pageId;
  });
  expect(pageId).toBe('p_two');
});

test('chrome hit targets stay on the 16px pixel scale when rem is 10px', async ({ page }) => {
  await mount(page);
  await page.addStyleTag({ content: 'html { font-size: 10px; }' });
  await page.evaluate(() => {
    window.__anniedrawing![0].apply([
      { op: 'add', item: { id: 'sel', kind: 'rect', x: 40, y: 40, w: 160, h: 90 } },
    ]);
    window.__anniedrawing![0].select(['sel']);
  });
  const width = await page
    .locator('.ad-style-row')
    .first()
    .evaluate((row) => {
      const columns = getComputedStyle(row).gridTemplateColumns.split(' ')[0];
      return parseFloat(columns);
    });
  expect(Math.abs(width - 57.6)).toBeLessThanOrEqual(2);
});

test('createFellowBoard applies the host embed preset', async ({ page }) => {
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  const preset = await page.evaluate(async () => {
    for (const board of [...(window.__anniedrawing ?? [])]) board.destroy();
    document.body.innerHTML = '<main id="fellow-fixture" style="position:fixed;inset:0"></main>';
    const { createFellowBoard } = await import('/src/fellow.ts' as string);
    const board = createFellowBoard(document.querySelector('#fellow-fixture')!, {
      fellowName: 'Alex',
      theme: 'dark',
    });
    board.apply([{ op: 'add', item: { id: 'taught', kind: 'rect', x: 0, y: 0, w: 80, h: 60 } }], {
      origin: 'agent:fellow',
    });
    board.apply([{ op: 'add', item: { id: 'mine', kind: 'rect', x: 200, y: 0, w: 80, h: 60 } }], {
      origin: 'user',
    });
    return {
      agentName: board.agentName,
      theme: board.theme,
      global: window.__anniedrawing?.includes(board) ?? false,
      pages: !!document.querySelector('.ad-pages'),
      menu: !!document.querySelector('[aria-label="Board menu"]'),
      canUndo: board.canUndo,
      afterUndo: (board.undo(), !!board.get('taught') && !board.get('mine')),
      gap: (() => {
        const next = createFellowBoard(document.createElement('div'), { fellowName: 'Alex' });
        next.apply([{ op: 'add', item: { id: 'a', kind: 'rect', x: 0, y: 0, w: 100, h: 80 } }]);
        next.apply(
          [{ op: 'add', item: { id: 'b', kind: 'rect', w: 100, h: 80 }, place: { rightOf: 'a' } }],
          { origin: 'agent:tool' },
        );
        const x = next.get('b')!.x;
        next.destroy();
        return x;
      })(),
    };
  });
  expect(preset).toMatchObject({
    agentName: 'Alex',
    theme: 'dark',
    global: false,
    pages: false,
    menu: false,
    canUndo: true,
    afterUndo: true,
    gap: 220,
  });
});
