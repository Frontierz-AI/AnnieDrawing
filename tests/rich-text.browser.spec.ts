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

const lesson = '# Plan\n- First **bold** step\n- Second *quiet* step\n\nPlain close';

test('md labels render as lines and runs, export, and round-trip', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async (value) => {
    const board = window.__anniedrawing![0];
    board.apply(
      [
        {
          op: 'add',
          item: { id: 'card', kind: 'rect', x: 80, y: 80, text: { value, format: 'md' } },
        },
      ],
      { origin: 'agent:fellow', reveal: 'none' },
    );
    await new Promise<void>((done) => board.stage.whenPresentationIdle(done));
    const read = () => {
      const label = board.stage.world.querySelector<HTMLElement>(
        '[data-ad-id="card"] .annie-text',
      )!;
      const lines = [...label.querySelectorAll<HTMLElement>(':scope > .annie-line')];
      const base = parseFloat(getComputedStyle(label).fontSize);
      const heading = getComputedStyle(lines[0]);
      const strong = label.querySelector('strong')!;
      const em = label.querySelector('em')!;
      return {
        kinds: lines.map((line) => line.dataset.adLine),
        markers: [...label.querySelectorAll('.annie-marker')].map((m) => m.textContent),
        headingScale: parseFloat(heading.fontSize) / base,
        headingWeight: Number(heading.fontWeight),
        strong: [strong.textContent, Number(getComputedStyle(strong).fontWeight)],
        em: [em.textContent, getComputedStyle(em).fontStyle],
        listDisplay: getComputedStyle(lines[1]).display,
        shown: label.innerText,
        overflowX: label.scrollWidth - label.clientWidth,
        overflowY: label.scrollHeight - label.clientHeight,
        color: getComputedStyle(label).color,
        aria: label.parentElement!.getAttribute('aria-label'),
      };
    };
    const light = read();
    const png = (await board.export('png')) as Blob;
    const svg = (await board.export('svg', { labels: true })) as string;
    const saved = board.toJSON();
    board.clear();
    board.load(saved);
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const reloaded = read();
    board.setTheme('dark');
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const dark = read();
    return {
      light,
      reloaded,
      dark,
      png: [png.type, png.size],
      svg,
      text: board.get('card')!.text,
    };
  }, lesson);
  const { light } = result;
  expect(light.kinds).toEqual(['h1', 'ul', 'ul', 'p', 'p']);
  expect(light.markers).toEqual(['•', '•']);
  expect(light.headingScale).toBeCloseTo(1.5, 2);
  expect(light.headingWeight).toBeGreaterThanOrEqual(700);
  expect(light.strong[0]).toBe('bold');
  expect(light.strong[1]).toBeGreaterThanOrEqual(700);
  expect(light.em).toEqual(['quiet', 'italic']);
  expect(light.listDisplay).toBe('flex');
  expect(light.shown).not.toContain('**');
  expect(light.shown).not.toContain('# ');
  expect(light.shown).not.toMatch(/^- /m);
  expect(light.overflowX).toBeLessThanOrEqual(1);
  expect(light.overflowY).toBeLessThanOrEqual(1);
  expect(light.aria).toBe('Rectangle: Plan\n• First bold step\n• Second quiet step\n\nPlain close');
  expect(result.png[0]).toBe('image/png');
  expect(result.png[1]).toBeGreaterThan(1000);
  expect(result.svg).toContain('<tspan font-weight="700">bold</tspan>');
  expect(result.svg).toContain('>card</text>');
  expect(result.text).toEqual({ value: lesson, format: 'md' });
  expect({ ...result.reloaded, color: '' }).toEqual({ ...light, color: '' });
  expect(result.dark.kinds).toEqual(light.kinds);
  expect(result.dark.color).not.toBe(light.color);
});

test('the md size heuristic holds the browser layout of every labeled kind', async ({ page }) => {
  await ready(page);
  const values = [
    lesson,
    '## Steps\n1. Open the **inbox** and sort what arrived overnight into folders\n2. Reply to *urgent* threads first\n10. Archive the rest',
    '- A long list item that wraps across several rows so the hanging indent matters a lot\n- **Bold text that is also long enough to wrap in the box**',
    '# A heading that is long enough to wrap',
  ];
  const sizes = await page.evaluate(async (values) => {
    const board = window.__anniedrawing![0];
    const kinds = ['rect', 'ellipse', 'diamond', 'note', 'text'];
    const ops = values.flatMap((value, row) =>
      kinds.map((kind, column) => ({
        op: 'add' as const,
        item: {
          id: `${kind}_${row}`,
          kind,
          x: column * 700,
          y: row * 700,
          text: { value, format: 'md' as const },
        },
      })),
    );
    // Zoom out so no item is culled; layout sizes below do not depend on zoom.
    board.stage.lens.set({ x: 0, y: 0, zoom: 0.25 });
    board.apply(ops, { origin: 'agent:fellow', reveal: 'none' });
    await new Promise<void>((done) => board.stage.whenPresentationIdle(done));
    return ops.map(({ item }) => {
      const label = board.stage.world.querySelector<HTMLElement>(
        `[data-ad-id="${item.id}"] .annie-text`,
      )!;
      const content = [...label.querySelectorAll<HTMLElement>('.annie-line')].reduce(
        (sum, line) => sum + line.offsetHeight,
        0,
      );
      const stored = board.get(item.id)!;
      const box = label.parentElement!.getBoundingClientRect();
      const lines = [...label.querySelectorAll('.annie-line')].map((line) =>
        line.getBoundingClientRect(),
      );
      // Page px at zoom 0.25.
      const outside =
        4 *
        Math.max(
          ...lines.map((line) =>
            Math.max(
              box.left - line.left,
              line.right - box.right,
              box.top - line.top,
              line.bottom - box.bottom,
            ),
          ),
        );
      return {
        id: item.id,
        kind: item.kind,
        overflowX: label.scrollWidth - label.clientWidth,
        overflowY: label.scrollHeight - label.clientHeight,
        outside,
        content,
        h: stored.h,
      };
    });
  }, values);
  for (const size of sizes) {
    expect(size.content, size.id).toBeGreaterThan(0);
    expect(size.outside, size.id).toBeLessThanOrEqual(1);
    // Ellipse padding is a percentage of the width on every side, which the plain heuristic does
    // not model either; Firefox reports that as scroll overflow for plain and md labels alike.
    if (size.kind === 'ellipse') continue;
    expect(size.overflowX, size.id).toBeLessThanOrEqual(1);
    expect(size.overflowY, size.id).toBeLessThanOrEqual(1);
    // The estimate is generous, not wildly so.
    expect(size.h, size.id).toBeLessThan(size.content * 3 + 80);
  }
});

test('editing an md item shows the raw source and re-renders on commit', async ({ page }) => {
  await ready(page);
  await page.evaluate((value) => {
    const board = window.__anniedrawing![0];
    board.apply([
      {
        op: 'add',
        item: {
          id: 'card',
          kind: 'rect',
          x: 200,
          y: 160,
          w: 300,
          h: 220,
          text: { value, format: 'md' },
        },
      },
    ]);
  }, lesson);
  const card = page.locator('[data-ad-id="card"]');
  const box = (await card.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const editor = page.getByRole('textbox', { name: 'Edit text' });
  await expect(editor).toBeVisible();
  expect(await editor.evaluate((node) => node.textContent)).toBe(lesson);
  expect(await editor.locator('.annie-line').count()).toBe(0);
  await page.keyboard.press('Escape');
  await expect(card.locator('.annie-line')).toHaveCount(5);

  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(editor).toBeVisible();
  await editor.fill('## Done\n- **one**');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(card.locator('.annie-line[data-ad-line="h2"]')).toHaveText('Done');
  await expect(card.locator('.annie-line[data-ad-line="ul"] strong')).toHaveText('one');
  expect(await page.evaluate(() => window.__anniedrawing![0].get('card')!.text)).toEqual({
    value: '## Done\n- **one**',
    format: 'md',
  });
  expect(await card.locator('.annie-text').innerText()).not.toContain('**');
});

test('autoWidth text measures md structure', async ({ page }) => {
  await ready(page);
  const size = await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    board.apply(
      [
        {
          op: 'add',
          item: {
            id: 't',
            kind: 'text',
            x: 40,
            y: 40,
            text: { value: '# Big title\n- **Bold** item', format: 'md' },
          },
        },
        {
          op: 'add',
          item: { id: 'p', kind: 'text', x: 40, y: 300, text: '# Big title\n- **Bold** item' },
        },
      ],
      { origin: 'agent:fellow', reveal: 'none' },
    );
    await new Promise<void>((done) => board.stage.whenPresentationIdle(done));
    const label = board.stage.world.querySelector<HTMLElement>('[data-ad-id="t"] .annie-text')!;
    return {
      md: board.get('t')!,
      plain: board.get('p')!,
      overflowX: label.scrollWidth - label.clientWidth,
      overflowY: label.scrollHeight - label.clientHeight,
    };
  });
  expect(size.overflowX).toBeLessThanOrEqual(1);
  expect(size.overflowY).toBeLessThanOrEqual(1);
  expect(size.md.h).toBeGreaterThan(size.plain.h);
});

test('eleven text lines stacked below each other stay under 600 px', async ({ page }) => {
  await ready(page);
  const height = await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    board.apply([{ op: 'add', item: { id: 'l0', kind: 'text', text: 'Line 0' } }], {
      origin: 'agent:fellow',
      reveal: 'none',
    });
    for (let index = 1; index < 11; index++)
      board.apply(
        [
          {
            op: 'add',
            item: { id: `l${index}`, kind: 'text', text: `Line ${index}` },
            place: { below: `l${index - 1}` },
          },
        ],
        { origin: 'agent:fellow', reveal: 'none' },
      );
    const lines = Array.from({ length: 11 }, (_, index) => board.get(`l${index}`)!);
    return lines[10].y + lines[10].h - lines[0].y;
  });
  expect(height).toBeLessThan(600);
});
