import { test, expect, type Page } from '@playwright/test';
const ready = async (page: Page) => {
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  await page.evaluate(async () => {
    const b = window.__anniedrawing![0];
    await b.ready;
    b.clear();
    b.setGrid(false);
    b.stage.lens.set({ x: 0, y: 0, zoom: 1 });
  });
};
const count = async (page: Page, kind: string) =>
  page.evaluate((kind) => window.__anniedrawing![0].query({ kind }).length, kind);
const drag = async (page: Page, x: number, y: number, dx: number, dy: number) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
};

test('creates every drawing tool with pointer input and edits text', async ({ page }) => {
  await ready(page);
  for (const [kind, shortcut] of [
    ['rect', 'r'],
    ['ellipse', 'o'],
    ['diamond', 'd'],
    ['line', 'l'],
    ['path', 'p'],
  ]) {
    await page.locator('.ad-root').press(shortcut);
    await drag(page, 400, 250, 160, 110);
    expect(await count(page, kind)).toBe(1);
    await page.locator('.ad-root').press('Escape');
  }
  await page.locator('.ad-root').press('t');
  await page.mouse.click(740, 400);
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Edit text' }).fill('Hello from a person');
  await page.keyboard.press('ControlOrMeta+Enter');
  expect(
    await page.evaluate(() => window.__anniedrawing![0].query({ kind: 'text' })[0].text?.value),
  ).toBe('Hello from a person');
  await page.locator('.ad-root').press('n');
  await page.mouse.click(740, 250);
  await page.getByRole('textbox', { name: 'Edit text' }).fill('A sticky thought');
  await page.keyboard.press('ControlOrMeta+Enter');
  expect(await count(page, 'note')).toBe(1);
});

test('move drafts stay out of JSON, undo is one step, resize, rotate and cancel work', async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => {
    const b = window.__anniedrawing![0];
    b.apply([
      {
        op: 'add',
        item: {
          id: 'i_box',
          kind: 'rect',
          x: 400,
          y: 250,
          w: 160,
          h: 100,
          style: { fill: 'teal' },
        },
      },
    ]);
    b.select(['i_box']);
  });
  await page.mouse.move(480, 300);
  await page.mouse.down();
  await page.mouse.move(530, 340, { steps: 5 });
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_box')?.x)).toBe(400);
  expect(
    await page.evaluate(
      () => window.__anniedrawing![0].read({ includeDrafts: true }).pages[0].items[0].x,
    ),
  ).toBe(450);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_box')?.x)).toBe(450);
  await page.locator('.ad-root').press('ControlOrMeta+z');
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_box')?.x)).toBe(400);
  const resize = page.locator('[data-ad-handle="se"]');
  await expect(resize).toHaveAttribute('x', '556');
  const box = await resize.boundingBox();
  await drag(page, box!.x + 4, box!.y + 4, 60, 30);
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_box')?.w)).toBeCloseTo(220, 0);
  const rotate = await page.locator('[data-ad-handle="rotate"]').boundingBox();
  await drag(page, rotate!.x + 4, rotate!.y + 4, 100, 80);
  expect(
    Math.abs(await page.evaluate(() => window.__anniedrawing![0].get('i_box')?.rotation ?? 0)),
  ).toBeGreaterThan(10);
  const before = await page.evaluate(() => window.__anniedrawing![0].get('i_box'));
  await page.mouse.move(480, 300);
  await page.mouse.down();
  await page.mouse.move(550, 340);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_box'))).toEqual(before);
});

test('connectors attach to shapes, follow drafts and survive target deletion', async ({ page }) => {
  await ready(page);
  await page.evaluate(() =>
    window.__anniedrawing![0].apply([
      {
        op: 'add',
        item: { id: 'i_a', kind: 'rect', x: 400, y: 250, w: 140, h: 100, style: { fill: 'moss' } },
      },
      {
        op: 'add',
        item: {
          id: 'i_b',
          kind: 'ellipse',
          x: 740,
          y: 250,
          w: 140,
          h: 100,
          style: { fill: 'violet' },
        },
      },
    ]),
  );
  await page.locator('.ad-root').press('a');
  await drag(page, 470, 300, 340, 0);
  const connector = await page.evaluate(
    () => window.__anniedrawing![0].query({ kind: 'connector' })[0],
  );
  expect(connector.from).toMatchObject({ item: 'i_a' });
  expect(connector.to).toMatchObject({ item: 'i_b' });
  const path = page.locator(`[data-ad-id="${connector.id}"] .ad-shape path`).first();
  const before = await path.getAttribute('d');
  await page.evaluate(() =>
    window.__anniedrawing![0].apply([{ op: 'set', id: 'i_a', patch: { y: 400 } }]),
  );
  await expect(path).not.toHaveAttribute('d', before!);
  await page.evaluate(() => window.__anniedrawing![0].apply([{ op: 'remove', id: 'i_a' }]));
  expect(
    await page.evaluate((id) => window.__anniedrawing![0].get(id)?.from, connector.id),
  ).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
});

test('readonly boards reject writes', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const { createBoard } = await import('/src/board.ts' as string);
    const host = document.createElement('div');
    document.body.append(host);
    const b = createBoard(host, { readonly: true, ui: false, exposeGlobal: false });
    const result = b.apply([{ op: 'add', item: { kind: 'rect' } }], { origin: 'user' });
    b.destroy();
    host.remove();
    return result;
  });
  expect(result.ok).toBe(false);
});

test('JSON, SVG and PNG exports work; pages and autosave survive reload', async ({ page }) => {
  await ready(page);
  await page.evaluate(() =>
    window.__anniedrawing![0].apply(
      [
        {
          op: 'add',
          item: {
            id: 'i_saved',
            kind: 'note',
            x: 400,
            y: 200,
            w: 180,
            h: 160,
            text: { value: 'Keep this idea' },
          },
        },
      ],
      { origin: 'user' },
    ),
  );
  const result = await page.evaluate(async () => {
    const b = window.__anniedrawing![0];
    return {
      json: await b.export('json'),
      svg: await b.export('svg', { labels: true }),
      png: ((await b.export('png')) as Blob).size,
    };
  });
  expect(JSON.parse(result.json as string).pages[0].items[0].id).toBe('i_saved');
  expect(result.svg).toContain('<svg');
  expect(result.svg).toContain('i_saved');
  expect(result.png).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Add page', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Page 2', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    await new Promise<void>((resolve) => {
      const stop = board.on('save', (event) => {
        if (event.status === 'saved') {
          stop();
          resolve();
        }
      });
      board.apply([{ op: 'add', item: { kind: 'rect', x: 100, y: 100 }, page: board.pageId }]);
    });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__anniedrawing?.[0]?.read().pages.length === 2);
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_saved')?.text?.value)).toBe(
    'Keep this idea',
  );
});

test('grouping, arrangement and appearance are usable', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const b = window.__anniedrawing![0];
    b.apply([
      {
        op: 'add',
        item: { id: 'i_a', kind: 'rect', x: 400, y: 250, w: 140, h: 100, style: { fill: 'moss' } },
      },
      {
        op: 'add',
        item: {
          id: 'i_b',
          kind: 'rect',
          x: 660,
          y: 400,
          w: 140,
          h: 100,
          style: { fill: 'violet' },
        },
      },
    ]);
    b.select(['i_a', 'i_b']);
    b.align('top');
    b.group();
  });
  expect(await count(page, 'group')).toBe(1);
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_b')?.y)).toBe(250);
  await page.locator('.ad-root').press('ControlOrMeta+Shift+g');
  expect(await count(page, 'group')).toBe(0);
  await page.getByRole('button', { name: 'Board menu' }).click();
  await page.getByRole('button', { name: 'Dark appearance' }).click();
  await expect(page.locator('.ad-root')).toHaveAttribute('data-theme', 'dark');
});

test('mobile tools, touch and pen preserve a usable viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.locator('.ad-root').dispatchEvent('pointerdown', {
    pointerId: 7,
    pointerType: 'touch',
    clientX: 80,
    clientY: 250,
    button: 0,
    buttons: 1,
    isPrimary: true,
  });
  await page.locator('.ad-root').dispatchEvent('pointermove', {
    pointerId: 7,
    pointerType: 'touch',
    clientX: 210,
    clientY: 360,
    button: 0,
    buttons: 1,
    isPrimary: true,
  });
  await page.locator('.ad-root').dispatchEvent('pointerup', {
    pointerId: 7,
    pointerType: 'touch',
    clientX: 210,
    clientY: 360,
    button: 0,
    isPrimary: true,
  });
  expect(await count(page, 'rect')).toBe(1);
  await page.evaluate(() => window.__anniedrawing![0].setTool('path'));
  await expect(page.getByRole('complementary', { name: 'Selection style' })).toBeHidden();
  await drag(page, 90, 440, 140, 65);
  expect(await count(page, 'path')).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button', { name: 'Board menu', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Board menu', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: 'Board menu', exact: true })).toHaveCount(0);
});

test('hand, marquee, alt-duplicate and eraser work through their pointer tools', async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() =>
    window.__anniedrawing![0].apply([
      {
        op: 'add',
        item: { kind: 'rect', id: 'i_a', x: 400, y: 250, w: 100, h: 100, style: { fill: 'paper' } },
      },
      {
        op: 'add',
        item: {
          kind: 'ellipse',
          id: 'i_b',
          x: 650,
          y: 250,
          w: 100,
          h: 100,
          style: { fill: 'paper' },
        },
      },
    ]),
  );
  await drag(page, 370, 220, 420, 170);
  expect(await page.evaluate(() => window.__anniedrawing![0].selection.length)).toBe(2);
  await page.keyboard.down('Alt');
  await drag(page, 450, 300, 0, 170);
  await page.keyboard.up('Alt');
  expect(await page.evaluate(() => window.__anniedrawing![0].items.length)).toBe(4);
  await page.locator('.ad-root').press('Escape');
  await page.locator('.ad-root').press('e');
  await page.mouse.click(450, 300);
  expect(await count(page, 'rect')).toBe(1);
  await page.locator('.ad-root').press('ControlOrMeta+z');
  expect(await count(page, 'rect')).toBe(2);
  await page.locator('.ad-root').press('h');
  await drag(page, 900, 550, -120, 40);
  expect(await page.evaluate(() => window.__anniedrawing![0].stage.lens.state)).toMatchObject({
    x: -120,
    y: 40,
  });
});

test('double clicking a newly drawn shape edits its label immediately', async ({ page }) => {
  await ready(page);
  await page.locator('.ad-root').press('r');
  await drag(page, 400, 250, 180, 100);
  await page.mouse.dblclick(490, 300);
  await expect(page.getByRole('textbox', { name: 'Edit text' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Edit text' }).fill('My next idea');
  await page.keyboard.press('ControlOrMeta+Enter');
  expect(await count(page, 'text')).toBe(0);
  expect(
    await page.evaluate(() => window.__anniedrawing![0].query({ kind: 'rect' })[0].text?.value),
  ).toBe('My next idea');
});

test('agent rectangles grow so a paragraph stays inside the box', async ({ page }) => {
  await ready(page);
  const size = await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    const value =
      'Lectura:\nColumnas = etapas aproximadas.\nFilas = dimensiones (tiempo, tecnología, organización, cultura).\nEs un esquema simplificado, no una línea exacta.';
    board.apply(
      [{ op: 'add', item: { id: 'i_card', kind: 'rect', x: 80, y: 80, text: { value } } }],
      { origin: 'agent:planner', reveal: 'none' },
    );
    const item = board.get('i_card')!;
    const node = board.stage.world.querySelector<HTMLElement>('[data-ad-id="i_card"]')!;
    const label = node.querySelector<HTMLElement>('.ad-text')!;
    return {
      w: item.w,
      h: item.h,
      overflowX: label.scrollWidth - label.clientWidth,
      overflowY: label.scrollHeight - label.clientHeight,
    };
  });
  expect(size.w).toBeGreaterThan(180);
  expect(size.h).toBeGreaterThan(110);
  expect(size.overflowX).toBeLessThanOrEqual(1);
  expect(size.overflowY).toBeLessThanOrEqual(1);
});

test('agent text titles stay on one line past the old 200 width', async ({ page }) => {
  await ready(page);
  const size = await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    const value = 'Evolución humana — vista por pisos y filas';
    board.apply(
      [
        {
          op: 'add',
          item: { id: 'i_title', kind: 'text', x: 80, y: 80, w: 200, h: 48, text: { value } },
        },
      ],
      { origin: 'agent:planner', reveal: 'none' },
    );
    const item = board.get('i_title')!;
    const label = board.stage.world.querySelector<HTMLElement>('[data-ad-id="i_title"] .ad-text')!;
    const font = parseFloat(getComputedStyle(label).fontSize);
    return { w: item.w, h: item.h, scrollH: label.scrollHeight, font };
  });
  expect(size.w).toBeGreaterThan(200);
  expect(size.scrollH).toBeLessThanOrEqual(size.font * 1.35 * 2 + 2);
});
