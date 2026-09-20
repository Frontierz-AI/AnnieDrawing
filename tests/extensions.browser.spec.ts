import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.length);
  await page.evaluate(() => {
    for (const board of [...(window.__anniedrawing ?? [])]) board.destroy();
    document.body.innerHTML = '<main id="extension-fixture" style="position:fixed;inset:0"></main>';
  });
});

test('Tab follows reading order while paint order stays in document order', async ({ page }) => {
  await page.evaluate(async () => {
    const path = '/src/board.ts';
    const { createBoard } = await import(path);
    const board = createBoard(document.querySelector('#extension-fixture'), {
      ui: false,
      exposeGlobal: true,
    });
    board.apply([
      {
        op: 'add',
        item: {
          id: 'i_bottom',
          kind: 'rect',
          x: 120,
          y: 280,
          w: 150,
          h: 120,
          style: { fill: 'teal' },
        },
      },
      {
        op: 'add',
        item: { id: 'i_top', kind: 'rect', x: 90, y: 80, w: 300, h: 300, style: { fill: 'moss' } },
      },
    ]);
    board.stage.lens.set({ x: 0, y: 0, zoom: 1 });
    board.focus();
  });
  await expect(page.locator('.ad-item')).toHaveCount(2);
  expect(
    await page
      .locator('.ad-item')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.adId)),
  ).toEqual(['i_top', 'i_bottom']);
  expect(
    await page.evaluate(
      () => document.elementFromPoint(150, 300)?.closest<HTMLElement>('[data-ad-id]')?.dataset.adId,
    ),
  ).toBe('i_top');
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-ad-id="i_top"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-ad-id="i_bottom"]')).toBeFocused();
});

test('text color uses the selected stroke while shape labels retain readable ink', async ({
  page,
}) => {
  const svg = await page.evaluate(async () => {
    const path = '/src/board.ts';
    const { createBoard } = await import(path);
    const board = createBoard(document.querySelector('#extension-fixture'), {
      ui: false,
      exposeGlobal: true,
    });
    board.apply([
      {
        op: 'add',
        item: {
          id: 'i_text',
          kind: 'text',
          x: 300,
          y: 200,
          w: 200,
          h: 80,
          text: { value: 'Purple thought' },
          style: { stroke: 'violet' },
        },
      },
      {
        op: 'add',
        item: {
          id: 'i_rect',
          kind: 'rect',
          x: 300,
          y: 400,
          w: 200,
          h: 80,
          text: { value: 'Readable label' },
          style: { stroke: 'violet' },
        },
      },
    ]);
    board.stage.lens.set({ x: 0, y: 0, zoom: 1 });
    return board.export('svg');
  });
  await expect(page.locator('[data-ad-id="i_text"] .ad-text')).toHaveCSS(
    'color',
    'rgb(143, 147, 249)',
  );
  await expect(page.locator('[data-ad-id="i_rect"] .ad-text')).toHaveCSS(
    'color',
    'rgb(16, 54, 57)',
  );
  expect(svg).toContain('fill="#8F93F9"><tspan');
  expect(svg).toContain('fill="#103639"><tspan');
});

test('custom kinds validate fields, keep mounted DOM, use outlines, and export custom SVG', async ({
  page,
}) => {
  const setup = await page.evaluate(async () => {
    const boardPath = '/src/board.ts',
      kindPath = '/src/kinds/index.ts',
      schemaPath = '/node_modules/valibot/dist/index.mjs';
    const [{ createBoard }, { defineKind }, v] = await Promise.all([
      import(boardPath),
      import(kindPath),
      import(schemaPath),
    ]);
    let mounts = 0;
    const kind = defineKind({
      kind: 'badge',
      defaults: { w: 120, h: 80, score: 1, style: { fill: 'teal' } },
      schema: v.object({ score: v.pipe(v.number(), v.minValue(0)) }),
      outline: (item: any) => ({
        points: [
          { x: 0, y: 0 },
          { x: item.w, y: 0 },
          { x: 0, y: item.h },
        ],
        closed: true,
      }),
      mount: (view: any) => {
        mounts++;
        const label = document.createElement('span');
        label.className = 'custom-mount';
        view.element.querySelector('.ad-auxiliary').append(label);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        view.shape.append(path);
        return () => {
          (window as any).__customUnmounted = ((window as any).__customUnmounted ?? 0) + 1;
        };
      },
      paint: (view: any, item: any) => {
        view.element.querySelector('.custom-mount').textContent = `Score ${item.score}`;
        const path = view.shape.querySelector('path');
        path.setAttribute('d', `M0 0H${item.w}L0 ${item.h}Z`);
        path.setAttribute('fill', '#05D9AB');
      },
      toSVG: (item: any) =>
        `<path data-custom-export="true" d="M0 0H${item.w}L0 ${item.h}Z" fill="#05D9AB"/>`,
      summarize: (item: any) => `Badge with score ${item.score}`,
      handles: (item: any) => [
        { id: 'score', x: item.score * 10, y: item.h / 2, label: 'Change score' },
      ],
      dragHandle: (_item: any, _handle: string, point: any) => ({
        score: Math.max(0, Math.round(point.x / 10)),
      }),
    });
    const board = createBoard(document.querySelector('#extension-fixture'), {
      ui: false,
      exposeGlobal: true,
      kinds: [kind],
    });
    const added = board.apply([
      { op: 'add', item: { id: 'i_custom', kind: 'badge', x: 400, y: 200 } },
    ]);
    const rejected = board.apply([{ op: 'set', id: 'i_custom', patch: { score: -1 } }]);
    board.stage.lens.set({ x: 0, y: 0, zoom: 1 });
    await new Promise(requestAnimationFrame);
    const node = board.stage.world.querySelector('.custom-mount');
    board.apply([{ op: 'set', id: 'i_custom', patch: { score: 3 } }]);
    await new Promise(requestAnimationFrame);
    return {
      added: added.ok,
      rejected: rejected.ok,
      mounts,
      same: node === board.stage.world.querySelector('.custom-mount'),
      width: board.get('i_custom').w,
      svg: await board.export('svg'),
    };
  });
  expect(setup).toMatchObject({ added: true, rejected: false, mounts: 1, same: true, width: 120 });
  expect(setup.svg).toContain('data-custom-export="true"');
  await expect(page.locator('.custom-mount')).toHaveText('Score 3');
  await expect(page.locator('[data-ad-id="i_custom"]')).toHaveAttribute(
    'aria-label',
    'Badge with score 3',
  );
  await page.mouse.click(510, 270);
  expect(await page.evaluate(() => window.__anniedrawing![0].selection)).toEqual([]);
  await page.mouse.click(420, 220);
  expect(await page.evaluate(() => window.__anniedrawing![0].selection)).toEqual(['i_custom']);
  await page.evaluate(() =>
    window.__anniedrawing![0].apply([{ op: 'set', id: 'i_custom', patch: { rotation: 90 } }]),
  );
  await expect(page.locator('[data-ad-id="i_custom"]')).toHaveAttribute('style', /rotate\(90deg\)/);
  const handle = await page.locator('[data-ad-custom-handle="score"]').boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2 + 50, {
    steps: 5,
  });
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_custom')?.score)).toBe(3);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_custom')?.score)).toBe(8);
  await page.evaluate(() => window.__anniedrawing![0].undo());
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_custom')?.score)).toBe(3);
  expect(
    await page.evaluate(() => {
      window.__anniedrawing![0].destroy();
      return (window as any).__customUnmounted;
    }),
  ).toBe(1);
});

test('DOMPurify sanitises HTML and double-click enables inert interactive controls', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const boardPath = '/src/board.ts',
      purifierPath = '/node_modules/dompurify/dist/purify.es.mjs';
    const [{ createBoard }, { default: DOMPurify }] = await Promise.all([
      import(boardPath),
      import(purifierPath),
    ]);
    const board = createBoard(document.querySelector('#extension-fixture'), {
      ui: false,
      exposeGlobal: true,
      sanitizeHTML: (html: string) => DOMPurify.sanitize(html),
    });
    board.apply(
      [
        {
          op: 'add',
          item: {
            id: 'i_html',
            kind: 'html',
            x: 400,
            y: 200,
            w: 300,
            h: 150,
            html: '<strong>Hello safely</strong><button onclick="window.__htmlRan=true">Try me</button><img src="missing-test-image.png" onerror="window.__htmlRan=true"><script>window.__htmlRan=true</script>',
          },
        },
      ],
      { origin: 'user' },
    );
    board.stage.lens.set({ x: 0, y: 0, zoom: 1 });
  });
  const html = page.locator('[data-ad-id="i_html"]');
  await expect(html.locator('strong')).toHaveText('Hello safely');
  await expect(html.locator('script,[onclick],[onerror]')).toHaveCount(0);
  await page.mouse.dblclick(450, 270);
  await expect(html).toHaveAttribute('data-ad-interactive', 'true');
  await html.getByRole('button', { name: 'Try me' }).click();
  expect(await page.evaluate(() => (window as any).__htmlRan)).toBeUndefined();
});

test('double-click enables a pasted video player', async ({ page }) => {
  await page.evaluate(async () => {
    const boardPath = '/src/board.ts';
    const { createBoard } = await import(boardPath);
    const board = createBoard(document.querySelector('#extension-fixture'), {
      ui: false,
      exposeGlobal: true,
    });
    board.apply(
      [
        {
          op: 'add',
          item: {
            id: 'i_video',
            kind: 'video',
            href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            x: 200,
            y: 160,
          },
        },
      ],
      { origin: 'user' },
    );
    board.stage.lens.set({ x: 0, y: 0, zoom: 1 });
  });
  const video = page.locator('[data-ad-id="i_video"]');
  await expect(video.locator('iframe')).toHaveAttribute(
    'src',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0',
  );
  await page.mouse.dblclick(280, 220);
  await expect(video).toHaveAttribute('data-ad-interactive', 'true');
});

test('custom polygon connectors match the drawn edge, exported SVG, bounds, and detached endpoint', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const boardPath = '/src/board.ts';
    const { createBoard } = await import(boardPath);
    const triangle = {
      kind: 'triangle',
      outline: (item: any) => ({
        points: [
          { x: item.w / 2, y: 0 },
          { x: item.w, y: item.h },
          { x: 0, y: item.h },
        ],
        closed: true,
      }),
      paint: (view: any, item: any) => {
        view.shape.innerHTML = `<path d="M${item.w / 2} 0L${item.w} ${item.h}L0 ${item.h}Z" fill="#05D9AB"/>`;
      },
      toSVG: (item: any) =>
        `<path d="M${item.w / 2} 0L${item.w} ${item.h}L0 ${item.h}Z" fill="#05D9AB"/>`,
    };
    const board = createBoard(document.querySelector('#extension-fixture'), {
      ui: false,
      exposeGlobal: true,
      kinds: [triangle],
    });
    board.apply([
      { op: 'add', item: { id: 'i_triangle', kind: 'triangle', x: 100, y: 100, w: 200, h: 100 } },
      { op: 'add', item: { id: 'i_target', kind: 'rect', x: 500, y: 100, w: 100, h: 100 } },
      {
        op: 'add',
        item: {
          id: 'i_link',
          kind: 'connector',
          from: { item: 'i_triangle' },
          to: { item: 'i_target' },
        },
      },
    ]);
    board.stage.lens.set({ x: 0, y: 0, zoom: 1 });
  });
  const path = page.locator('[data-ad-id="i_link"] .ad-shape path').first();
  await expect(path).toHaveAttribute('d', 'M 250 150 L 500 150');
  const exported = await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    return { svg: await board.export('svg'), bounds: board.boundsOf(['i_link']) };
  });
  expect(exported.svg).toContain('d="M 250 150 L 500 150"');
  expect(exported.bounds).toEqual({ x: 250, y: 150, w: 250, h: 0 });
  await page.evaluate(() => window.__anniedrawing![0].apply([{ op: 'remove', id: 'i_triangle' }]));
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_link')?.from)).toEqual({
    x: 250,
    y: 150,
  });
  await expect(path).toHaveAttribute('d', 'M 250 150 L 500 150');
  await page.evaluate(() => window.__anniedrawing![0].undo());
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_link')?.from)).toMatchObject({
    item: 'i_triangle',
  });
});
