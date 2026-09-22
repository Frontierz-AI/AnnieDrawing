import { expect, test } from '@playwright/test';

async function prepare(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    window.__anniedrawing?.forEach((board) => board.destroy());
    document.body.innerHTML = '<main id="stage-fixture" style="position:fixed;inset:0"></main>';
    const modulePath = '/src/stage/stage.ts';
    const { Stage } = await import(modulePath);
    const stylePath = '/src/stage/style.css';
    await import(stylePath);
    const fixture = new Stage(document.querySelector('#stage-fixture'));
    const doc = {
      format: 'anniedrawing',
      version: 2,
      meta: { title: 'Renderer fixture' },
      pages: [
        {
          id: 's_main',
          name: 'Main',
          items: [
            {
              id: 'i_a',
              kind: 'rect',
              x: 80,
              y: 80,
              w: 180,
              h: 100,
              text: { value: 'Hello, world' },
              style: { fill: 'teal', fillMode: 'tint' },
            },
            { id: 'i_b', kind: 'ellipse', x: 500, y: 80, w: 180, h: 100 },
            {
              id: 'i_c',
              kind: 'connector',
              x: 0,
              y: 0,
              w: 0,
              h: 0,
              from: { item: 'i_a', side: 'right' },
              to: { item: 'i_b', side: 'left' },
              route: 'elbow',
              text: { value: 'connects' },
            },
          ],
        },
      ],
      media: {},
    };
    (window as any).__stageFixture = { stage: fixture, doc };
    fixture.render(doc, 's_main');
  });
}

test('draft movement reuses DOM and paints only the changed item and attached connector', async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const { stage, doc } = (window as any).__stageFixture;
    const node = stage.world.querySelector('[data-ad-id="i_a"]');
    const path = node.querySelector('path');
    const text = node.querySelector('.ad-text').firstChild;
    const connector = stage.world.querySelector('[data-ad-id="i_c"] path').getAttribute('d');
    const untouched = stage.world.querySelector('[data-ad-id="i_b"]').outerHTML;
    stage.render(doc, 's_main', new Map([['i_a', { x: 140, y: 120 }]]));
    const transform = node.style.transform;
    const same =
      node === stage.world.querySelector('[data-ad-id="i_a"]') &&
      path === node.querySelector('path') &&
      text === node.querySelector('.ad-text').firstChild;
    const changedConnector =
      connector !== stage.world.querySelector('[data-ad-id="i_c"] path').getAttribute('d');
    const unchanged = untouched === stage.world.querySelector('[data-ad-id="i_b"]').outerHTML;
    stage.render(doc, 's_main', new Map());
    return { same, transform, changedConnector, unchanged, restored: node.style.transform };
  });
  expect(result.same).toBe(true);
  expect(result.unchanged).toBe(true);
  expect(result.changedConnector).toBe(true);
  expect(result.transform).toContain('140px, 120px');
  expect(result.restored).toContain('80px, 80px');
});

test('a short diamond centers its label vertically', async ({ page }) => {
  await prepare(page);
  const delta = await page.evaluate(() => {
    const { stage, doc } = (window as any).__stageFixture;
    const next = {
      ...doc,
      pages: [
        {
          ...doc.pages[0],
          items: [
            ...doc.pages[0].items,
            {
              id: 'i_d',
              kind: 'diamond',
              x: 40,
              y: 240,
              w: 420,
              h: 120,
              text: { value: 'Second human review needed?' },
            },
          ],
        },
      ],
    };
    stage.render(next, 's_main');
    const item = stage.world.querySelector('[data-ad-id="i_d"]');
    const range = document.createRange();
    range.selectNodeContents(item.querySelector('.ad-text'));
    const textBox = range.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    return textBox.top + textBox.height / 2 - (itemBox.top + itemBox.height / 2);
  });
  expect(Math.abs(delta)).toBeLessThan(2);
});

test('selection has eight usable resize handles and a rotation handle', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => (window as any).__stageFixture.stage.setSelection(['i_a']));
  await expect(page.locator('[data-ad-handle]')).toHaveCount(9);
  await expect(page.locator('[data-ad-handle="se"]')).toHaveCSS('pointer-events', 'all');
  await expect(page.locator('[data-ad-id="i_a"]')).toHaveAttribute(
    'aria-label',
    'Rectangle: Hello, world',
  );
  const southeast = await page.locator('[data-ad-handle="se"]').boundingBox();
  expect(southeast!.x + southeast!.width / 2).toBeCloseTo(260, 0);
  expect(southeast!.y + southeast!.height / 2).toBeCloseTo(180, 0);
  await page.locator('[data-ad-id="i_a"]').focus();
  await expect(page.locator('[data-ad-id="i_a"]')).toBeFocused();
});

test('Group visibility, hidden ancestry, unknown kinds, and inert HTML survive updates', async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const { stage, doc } = (window as any).__stageFixture;
    const group = {
      id: 'i_group',
      kind: 'group',
      x: 40,
      y: 40,
      w: 220,
      h: 220,
      children: [{ id: 'i_child', kind: 'rect', x: 100, y: 100, w: 200, h: 100 }],
    };
    const next = {
      ...doc,
      pages: [
        {
          ...doc.pages[0],
          items: [
            group,
            { id: 'i_unknown', kind: 'future_kind', x: 400, y: 300, w: 120, h: 100 },
            {
              id: 'i_html',
              kind: 'html',
              x: 600,
              y: 300,
              w: 120,
              h: 100,
              html: '<img src=x onerror="window.__htmlExecuted=true"><script>window.__htmlExecuted=true</script>',
            },
          ],
        },
      ],
    };
    stage.render(next, 's_main');
    const child = stage.world.querySelector('[data-ad-id="i_child"]');
    stage.render(next, 's_main', new Map([['i_group', { hidden: true }]]));
    const hidden = child.style.display === 'none';
    stage.render(next, 's_main', new Map());
    return {
      hidden,
      restored: child.style.display !== 'none',
      unknown: stage.world.querySelector('[data-ad-id="i_unknown"]').textContent,
      scripts: stage.world.querySelector('[data-ad-id="i_html"]').querySelectorAll('script,img')
        .length,
    };
  });
  expect(result.hidden).toBe(true);
  expect(result.restored).toBe(true);
  expect(result.unknown).toContain('Unknown kind: future_kind');
  expect(result.scripts).toBe(0);
});

test('theme changes repaint shapes and SVG with labels rasterises to PNG', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { stage, doc } = (window as any).__stageFixture;
    const before = stage.world.querySelector('[data-ad-id="i_b"] path').getAttribute('stroke');
    stage.setTheme('dark');
    const after = stage.world.querySelector('[data-ad-id="i_b"] path').getAttribute('stroke');
    const svgPath = '/src/porter/svg.ts';
    const pngPath = '/src/porter/png.ts';
    const { exportSVG } = await import(svgPath);
    const { exportPNG } = await import(pngPath);
    const svg = exportSVG(doc, doc.pages[0].items, { labels: true, theme: 'dark' });
    const png = await exportPNG(svg, 1);
    return { before, after, labels: svg.includes('i_a'), type: png.type, size: png.size };
  });
  expect(result.before).not.toBe(result.after);
  expect(result.labels).toBe(true);
  expect(result.type).toBe('image/png');
  expect(result.size).toBeGreaterThan(500);
});

test('camera updates coalesce into one animation frame while coordinates stay synchronous', async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { stage } = (window as any).__stageFixture;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const before = stage.world.style.transform;
    let mutations = 0;
    let last = before;
    const observer = new MutationObserver(() => {
      const next = stage.world.style.transform;
      if (next === last) return;
      mutations++;
      last = next;
    });
    observer.observe(stage.world, { attributes: true, attributeFilter: ['style'] });
    for (let index = 0; index < 40; index++)
      stage.lens.set({ x: index, y: index * 2, zoom: 1 + index / 100 });
    const immediate = stage.world.style.transform;
    const state = stage.lens.state;
    await new Promise(requestAnimationFrame);
    await Promise.resolve();
    observer.disconnect();
    return { before, immediate, state, after: stage.world.style.transform, mutations };
  });
  expect(result.immediate).toBe(result.before);
  expect(result.state.x).toBe(39);
  expect(result.state.y).toBe(78);
  expect(result.state.zoom).toBeCloseTo(1.39);
  expect(result.after).toContain('39px, 78px');
  expect(result.mutations).toBeLessThanOrEqual(2);
});

test('moving an unbound obstacle reroutes an automatic connector and restores it on cancel', async ({
  page,
}) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const { stage, doc } = (window as any).__stageFixture;
    const next = {
      ...doc,
      pages: [
        {
          ...doc.pages[0],
          items: [
            ...doc.pages[0].items,
            { id: 'obstacle', kind: 'rect', x: 330, y: 300, w: 100, h: 100 },
          ],
        },
      ],
    };
    stage.render(next, 's_main');
    const path = () => stage.world.querySelector('[data-ad-id="i_c"] path').getAttribute('d');
    const before = path();
    stage.render(next, 's_main', new Map([['obstacle', { y: 80 }]]));
    const during = path();
    stage.render(next, 's_main', new Map());
    return { before, during, after: path() };
  });
  expect(result.during).not.toEqual(result.before);
  expect(result.after).toEqual(result.before);
});
