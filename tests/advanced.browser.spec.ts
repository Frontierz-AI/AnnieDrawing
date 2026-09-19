import { test, expect, type Page } from '@playwright/test';
const setup = async (page: Page) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  await page.evaluate(async () => {
    const b = window.__anniedrawing![0];
    await b.ready;
    b.clear();
    b.stage.lens.set({ x: 0, y: 0, zoom: 1 });
  });
};

test('plain text paste creates medium text', async ({ page }) => {
  await setup(page);
  const item = await page.evaluate(async () => {
    const b = window.__anniedrawing![0];
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', 'A pasted thought');
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: clipboard });
    b.stage.root.dispatchEvent(event);
    const started = Date.now();
    while (!b.query({ kind: 'text' }).length && Date.now() - started < 1000)
      await new Promise((resolve) => setTimeout(resolve, 20));
    return b.query({ kind: 'text' })[0];
  });
  expect(item.text).toMatchObject({ value: 'A pasted thought', size: 'm' });
});

test('pasted video, image and website URLs create card items', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    const send = (text: string) => {
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', text);
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: clipboard });
      board.stage.root.dispatchEvent(event);
    };
    send('https://www.youtube.com/watch?v=ihe1QbeGt7U&list=RDihe1QbeGt7U');
    send(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgvBn6PwAE+QKJBZFmAAAAAElFTkSuQmCC',
    );
    send('https://example.com/notes');
    const started = Date.now();
    while (
      (!board.query({ kind: 'image' }).length ||
        !board.stage.world.querySelector('iframe') ||
        !board.stage.world.querySelector('.ad-link-open')) &&
      Date.now() - started < 2000
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    const video = board.query({ kind: 'video' })[0];
    const image = board.query({ kind: 'image' })[0];
    const link = board.query({ kind: 'link' })[0];
    const videoEl = board.stage.world.querySelector<HTMLElement>(`[data-ad-id="${video.id}"]`);
    return {
      video: { href: video.href, src: videoEl?.querySelector('iframe')?.getAttribute('src') },
      image: !!image.media,
      link: { href: link.href, title: link.text?.value, host: link.name },
      radius: getComputedStyle(videoEl!.querySelector('.ad-auxiliary')!).borderRadius,
      open: !!board.stage.world.querySelector('.ad-link-open'),
    };
  });
  expect(result.video.href).toBe('https://www.youtube.com/watch?v=ihe1QbeGt7U&list=RDihe1QbeGt7U');
  expect(result.video.src).toContain('youtube-nocookie.com/embed/ihe1QbeGt7U');
  expect(result.image).toBe(true);
  expect(result.link).toMatchObject({
    href: 'https://example.com/notes',
    title: 'example.com',
    host: 'example.com',
  });
  expect(result.radius).toBe('16px');
  expect(result.open).toBe(true);
});

test('clipboard remaps group ids and internal connectors without corrupting originals', async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const b = window.__anniedrawing![0];
    b.apply([
      {
        op: 'add',
        item: {
          kind: 'group',
          id: 'i_group',
          x: 350,
          y: 200,
          w: 400,
          h: 200,
          children: [
            { id: 'i_a', kind: 'rect', x: 350, y: 200, w: 100, h: 100 },
            { id: 'i_b', kind: 'rect', x: 600, y: 200, w: 100, h: 100 },
            { id: 'i_c', kind: 'connector', from: { item: 'i_a' }, to: { item: 'i_b' } },
          ],
        },
      },
    ]);
    b.select(['i_group']);
    const clipboard = new DataTransfer();
    for (const type of ['copy', 'paste']) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: clipboard });
      b.stage.root.dispatchEvent(event);
    }
    return b.read();
  });
  const groups = result.pages[0].items;
  expect(groups).toHaveLength(2);
  expect(groups[0].id).toBe('i_group');
  const children = groups[1].children!;
  expect(new Set(children.map((i) => i.id)).size).toBe(3);
  expect(children[2].from).toMatchObject({ item: children[0].id });
  expect(children[2].to).toMatchObject({ item: children[1].id });
});

test('image paste, JSON scope and selected group export preserve content', async ({ page }) => {
  await setup(page);
  const output = await page.evaluate(async () => {
    const b = window.__anniedrawing![0];
    const bytes = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgvbn6PwAE+QKJBZFmYAAAAABJRU5ErkJggg==',
      ),
      (c) => c.charCodeAt(0),
    );
    await b.addImage(new File([bytes], 'pixel.png', { type: 'image/png' }));
    b.apply([
      {
        op: 'add',
        item: {
          kind: 'group',
          id: 'i_g',
          children: [
            {
              kind: 'rect',
              id: 'i_child',
              x: 400,
              y: 300,
              w: 100,
              h: 100,
              text: { value: 'Inside' },
            },
          ],
        },
      },
    ]);
    b.select(['i_g']);
    return {
      image: b.query({ kind: 'image' })[0],
      selection: b.read('selection'),
      svg: await b.export('svg', { scope: 'selection' }),
      describe: b.describe({ scope: 'selection' }),
    };
  });
  expect(output.image.media).toBeTruthy();
  expect(output.selection.media).toEqual({});
  expect(output.selection.pages[0].items[0].children).toHaveLength(1);
  expect(output.svg).toContain('Inside');
  expect(output.describe).toContain('i_g');
});

test('keyboard focus, delete, duplicate, lock and hidden items behave consistently', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const b = window.__anniedrawing![0];
    b.apply([
      {
        op: 'add',
        item: {
          kind: 'note',
          id: 'i_note',
          x: 400,
          y: 300,
          w: 180,
          h: 180,
          text: { value: 'Focusable note' },
        },
      },
    ]);
  });
  await page.locator('[data-ad-id="i_note"]').focus();
  await expect
    .poll(() => page.evaluate(() => window.__anniedrawing![0].selection))
    .toEqual(['i_note']);
  await expect(page.locator('[data-ad-id="i_note"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_note')!.x)).toBe(401);
  await page.keyboard.press('ControlOrMeta+d');
  expect(await page.evaluate(() => window.__anniedrawing![0].query({ kind: 'note' }).length)).toBe(
    2,
  );
  await page.keyboard.press('Backspace');
  expect(await page.evaluate(() => window.__anniedrawing![0].query({ kind: 'note' }).length)).toBe(
    1,
  );
  await page.evaluate(() =>
    window.__anniedrawing![0].apply([{ op: 'set', id: 'i_note', patch: { hidden: true } }]),
  );
  await expect(page.locator('[data-ad-id="i_note"]')).toBeHidden();
});

test('touch pinch anchors zoom and pen pressure reaches the document', async ({ page }) => {
  await setup(page);
  const values = await page.evaluate(() => {
    const b = window.__anniedrawing![0],
      root = b.stage.root;
    const dispatch = (
      type: string,
      id: number,
      x: number,
      y: number,
      pointerType = 'touch',
      pressure = 0.5,
    ) =>
      root.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          pressure,
          bubbles: true,
          cancelable: true,
        }),
      );
    dispatch('pointerdown', 1, 400, 300);
    dispatch('pointerdown', 2, 600, 300);
    dispatch('pointermove', 1, 300, 300);
    dispatch('pointermove', 2, 700, 300);
    dispatch('pointerup', 1, 300, 300);
    dispatch('pointerup', 2, 700, 300);
    const zoom = b.view.zoom;
    const center = b.stage.lens.toPage({ x: 500, y: 300 });
    b.setTool('path');
    dispatch('pointerdown', 3, 400, 400, 'pen', 0.2);
    dispatch('pointermove', 3, 450, 420, 'pen', 0.8);
    dispatch('pointermove', 3, 500, 470, 'pen', 0.4);
    dispatch('pointerup', 3, 500, 470, 'pen', 0.4);
    return { zoom, center, path: b.query({ kind: 'path' })[0] };
  });
  expect(values.zoom).toBe(2);
  expect(values.center).toEqual({ x: 500, y: 300 });
  expect(values.path.points?.some((p) => Math.abs((p[2] ?? 0) - 0.8) < 0.001)).toBe(true);
});

test('clipboard connectors are portable across pages', async ({ page }) => {
  await setup(page);
  const output = await page.evaluate(() => {
    const b = window.__anniedrawing![0];
    b.apply([
      { op: 'add', item: { kind: 'rect', id: 'i_target', x: 400, y: 200 } },
      {
        op: 'add',
        item: {
          kind: 'connector',
          id: 'i_arrow',
          from: { item: 'i_target' },
          to: { x: 700, y: 400 },
          waypoints: [[600, 220]],
        },
      },
    ]);
    b.select(['i_arrow']);
    const clipboard = new DataTransfer();
    const send = (type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: clipboard });
      b.stage.root.dispatchEvent(event);
    };
    send('copy');
    b.apply([{ op: 'page.add', page: { id: 's_other', name: 'Elsewhere' } }]);
    b.setPage('s_other');
    send('paste');
    const copied = b.query({ kind: 'connector', page: 's_other' })[0];
    b.select([copied.id]);
    b.focus();
    b.stage.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    return { before: copied, after: b.get(copied.id), original: b.get('i_arrow') };
  });
  expect(output.before.from).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  expect(output.before.waypoints![0][0]).toBe(624);
  expect((output.after!.from as { x: number }).x).toBe((output.before.from as { x: number }).x + 1);
  expect(output.after!.waypoints![0][0]).toBe(625);
  expect(output.original!.from).toMatchObject({ item: 'i_target' });
});

test('aligning a group translates descendants once and text cancellation restores content', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const b = window.__anniedrawing![0];
    b.apply([
      {
        op: 'add',
        item: {
          id: 'i_g',
          kind: 'group',
          x: 400,
          y: 400,
          w: 180,
          h: 100,
          children: [{ id: 'i_child', kind: 'rect', x: 400, y: 400, w: 180, h: 100 }],
        },
      },
      {
        op: 'add',
        item: {
          id: 'i_text',
          kind: 'text',
          x: 650,
          y: 200,
          w: 150,
          h: 60,
          text: { value: 'Original' },
          autoWidth: true,
        },
      },
    ]);
    b.select(['i_g', 'i_text']);
    b.align('top');
  });
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_child')!.y)).toBe(200);
  await page.evaluate(() => window.__anniedrawing![0].editText('i_text'));
  await page.getByRole('textbox', { name: 'Edit text' }).fill('Do not save this');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_text')!.text!.value)).toBe(
    'Original',
  );
  await expect(page.locator('[data-ad-id="i_text"] .ad-text')).toHaveText('Original');
  await page.evaluate(() => window.__anniedrawing![0].editText('i_text'));
  await page
    .getByRole('textbox', { name: 'Edit text' })
    .fill('A much longer line of measured text');
  await page.keyboard.press('ControlOrMeta+Enter');
  expect(await page.evaluate(() => window.__anniedrawing![0].get('i_text')!.w)).toBeGreaterThan(
    150,
  );
});
