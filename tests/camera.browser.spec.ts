import { expect, test, type Page } from '@playwright/test';

/** The Founderz mount: createFellowBoard with its own header options, motion on. */
async function mount(page: Page, options: Record<string, unknown> = {}) {
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  await page.evaluate(async (options) => {
    for (const board of [...(window.__anniedrawing ?? [])]) board.destroy();
    document.body.innerHTML = '<main id="camera-fixture" style="position:fixed;inset:0"></main>';
    const { createFellowBoard } = await import('/src/fellow.ts' as string);
    const board = createFellowBoard(document.querySelector('#camera-fixture')!, {
      fellowName: 'Annie',
      theme: 'light',
      ui: { menu: false, export: ['png', 'svg'], pages: false },
      exposeGlobal: true,
      ...options,
    });
    const log: { view: unknown[]; follow: boolean[]; presented: unknown[] } = {
      view: [],
      follow: [],
      presented: [],
    };
    board.on('view', (event: unknown) => log.view.push(event));
    board.on('follow', (value: boolean) => log.follow.push(value));
    board.on('presented', (event: unknown) => log.presented.push(event));
    (window as unknown as { cameraLog: typeof log }).cameraLog = log;
    await board.ready;
  }, options);
}

type Log = {
  view: { x: number; y: number; zoom: number; cause: string }[];
  follow: boolean[];
  presented: { ids: string[]; origin: string }[];
};
const log = (page: Page) =>
  page.evaluate(() => (window as unknown as { cameraLog: Log }).cameraLog);
const resetLog = (page: Page) =>
  page.evaluate(() => {
    const log = (window as unknown as { cameraLog: Log }).cameraLog;
    log.view.length = log.follow.length = log.presented.length = 0;
  });

/** Wait for the arrival to end and the camera to rest. */
async function settle(page: Page) {
  await expect(page.locator('.annie-agent-cursor, .annie-agent-pending')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            const board = window.__anniedrawing![0];
            const before = JSON.stringify(board.stage.lens.state);
            setTimeout(() => resolve(JSON.stringify(board.stage.lens.state) === before), 400);
          }),
      ),
    )
    .toBe(true);
}

/** True when the item's bounds lie inside the visible page box. */
const inView = (page: Page, id: string) =>
  page.evaluate((id) => {
    const board = window.__anniedrawing![0],
      view = board.view.viewport,
      box = board.boundsOf([id]);
    return (
      box.x >= view.x - 0.5 &&
      box.y >= view.y - 0.5 &&
      box.x + box.w <= view.x + view.w + 0.5 &&
      box.y + box.h <= view.y + view.h + 0.5
    );
  }, id);

/** `gap` overrides the one-line default between stacked text items, to put a line out of view. */
const addLine = (page: Page, id: string, value: string, below?: string, gap?: number) =>
  page.evaluate(
    ({ id, value, below, gap }) =>
      window.__anniedrawing![0].apply(
        [
          {
            op: 'add',
            item: { id, kind: 'text', text: { value } },
            ...(below ? { place: { below, ...(gap === undefined ? {} : { gap }) } } : {}),
          },
        ],
        { origin: 'agent:fellow' },
      ),
    { id, value, below, gap },
  );

/** Adds each line in its own batch and returns the resting zoom after each reveal. */
async function addLines(page: Page, count: number) {
  const zooms: number[] = [];
  for (let index = 1; index <= count; index++) {
    const result = await addLine(
      page,
      `line${index}`,
      `Line ${index}: a sentence the tutor writes`,
      index > 1 ? `line${index - 1}` : undefined,
    );
    expect(result.ok).toBe(true);
    await settle(page);
    zooms.push(await page.evaluate(() => window.__anniedrawing![0].view.zoom));
  }
  return zooms;
}

test('a created reveal frames a single title at zoom 1, not 1.5', async ({ page }) => {
  await mount(page);
  const result = await addLine(page, 'title', 'How a request is approved');
  expect(result.ok).toBe(true);
  await settle(page);
  const zoom = await page.evaluate(() => window.__anniedrawing![0].view.zoom);
  expect(zoom).toBeCloseTo(1, 5);
  expect(await inView(page, 'title')).toBe(true);
  const causes = (await log(page)).view.map((event) => event.cause);
  expect(causes.length).toBeGreaterThan(0);
  expect(new Set(causes)).toEqual(new Set(['agent']));
});

test('eleven stacked lines keep the newest line readable', async ({ page }) => {
  test.setTimeout(90000);
  await mount(page);
  const zooms = await addLines(page, 11);
  const state = await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    return { zoom: board.view.zoom, follow: board.view.follow };
  });
  expect(state.zoom).toBeGreaterThanOrEqual(0.6);
  expect(state.zoom).toBeLessThanOrEqual(1);
  expect(state.follow).toBe(true);
  expect(await inView(page, 'line11')).toBe(true);
  // No reveal ever rested above 1 or below the 0.6 floor.
  expect(Math.max(...zooms)).toBeLessThanOrEqual(1);
  expect(Math.min(...zooms)).toBeGreaterThanOrEqual(0.6 - 1e-9);
});

/** Center on the line through the API (follow stays on), then zoom in on it with the wheel. */
async function zoomInWithWheelOn(page: Page, id: string) {
  const point = await page.evaluate((id) => {
    const board = window.__anniedrawing![0],
      line = board.boundsOf([id]);
    board.view.center = { x: line.x + line.w / 2, y: line.y + line.h / 2 };
    const box = board.view.toScreen(line),
      host = board.stage.root.getBoundingClientRect();
    return { x: host.left + box.x + box.w / 2, y: host.top + box.y + box.h / 2 };
  }, id);
  await resetLog(page);
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down('Control');
  for (let step = 0; step < 4; step++) await page.mouse.wheel(0, -8);
  await page.keyboard.up('Control');
  await expect
    .poll(() => page.evaluate(() => window.__anniedrawing![0].view.zoom))
    .toBeGreaterThan(1.1);
}

test('a learner who zoomed in with the wheel keeps the camera when a line arrives', async ({
  page,
}) => {
  test.setTimeout(60000);
  await mount(page);
  await addLines(page, 6);
  await resetLog(page);
  await zoomInWithWheelOn(page, 'line2');
  const before = await page.evaluate(() => window.__anniedrawing![0].stage.lens.state);
  const afterWheel = await log(page);
  expect(afterWheel.follow).toEqual([false]);
  expect(afterWheel.view.every((event) => event.cause === 'user')).toBe(true);
  await resetLog(page);
  expect((await addLine(page, 'line7', 'Line 7: added at the bottom', 'line6', 900)).ok).toBe(true);
  await settle(page);
  const after = await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    return { state: board.stage.lens.state, follow: board.view.follow };
  });
  expect(after.state).toEqual(before);
  expect(after.follow).toBe(false);
  const quiet = await log(page);
  expect(quiet.view).toEqual([]);
  expect(quiet.presented.map((event) => event.ids)).toEqual([['line7']]);
  expect(await inView(page, 'line7')).toBe(false);
});

test('turning follow back on flies to the newest line', async ({ page }) => {
  test.setTimeout(60000);
  await mount(page);
  await addLines(page, 6);
  await zoomInWithWheelOn(page, 'line2');
  expect((await addLine(page, 'line7', 'Line 7: added at the bottom', 'line6', 900)).ok).toBe(true);
  await settle(page);
  expect(await inView(page, 'line7')).toBe(false);
  await resetLog(page);
  await page.evaluate(() => {
    window.__anniedrawing![0].view.follow = true;
  });
  await settle(page);
  const state = await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    return { zoom: board.view.zoom, follow: board.view.follow };
  });
  expect(state.follow).toBe(true);
  expect(state.zoom).toBeLessThanOrEqual(1);
  expect(state.zoom).toBeGreaterThanOrEqual(0.6);
  expect(await inView(page, 'line7')).toBe(true);
  const events = await log(page);
  expect(events.follow).toEqual([true]);
  expect(events.view.length).toBeGreaterThan(0);
  expect(events.view.every((event) => event.cause === 'agent')).toBe(true);
});

test('a batch fully inside the viewport causes no view event', async ({ page }) => {
  await mount(page);
  await addLine(page, 'title', 'Inside the view');
  await settle(page);
  await resetLog(page);
  const result = await page.evaluate(() => {
    const board = window.__anniedrawing![0],
      center = board.view.center;
    return board.apply(
      [
        {
          op: 'add',
          item: {
            id: 'near',
            kind: 'rect',
            x: center.x - 60,
            y: center.y + 60,
            w: 120,
            h: 70,
            text: { value: 'Near' },
          },
        },
        { op: 'add', item: { id: 'link', kind: 'arrow', from: 'title', to: 'near' } },
      ],
      { origin: 'agent:fellow' },
    );
  });
  expect(result.ok).toBe(true);
  await settle(page);
  expect(await inView(page, 'near')).toBe(true);
  const events = await log(page);
  expect(events.view).toEqual([]);
  expect(events.presented).toHaveLength(1);
});

test('each camera input path reports its cause and user input turns follow off', async ({
  page,
}) => {
  await mount(page);
  await addLine(page, 'title', 'Camera causes');
  await settle(page);
  const root = page.locator('.annie-root');
  const box = (await root.boundingBox())!;
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const check = async (name: string, act: () => Promise<void>, cause: string) => {
    await page.evaluate(() => {
      window.__anniedrawing![0].view.follow = true;
    });
    await settle(page);
    await resetLog(page);
    await act();
    await expect
      .poll(async () => (await log(page)).view.length, { message: name })
      .toBeGreaterThan(0);
    const events = await log(page);
    expect(new Set(events.view.map((event) => event.cause)), name).toEqual(new Set([cause]));
    const follow = await page.evaluate(() => window.__anniedrawing![0].view.follow);
    expect(follow, name).toBe(cause !== 'user');
    expect(events.follow, name).toEqual(cause === 'user' ? [false] : []);
  };
  await check(
    'wheel pan',
    async () => {
      await page.mouse.move(middle.x, middle.y);
      await page.mouse.wheel(40, 30);
    },
    'user',
  );
  await check(
    'ctrl wheel zoom',
    async () => {
      await page.mouse.move(middle.x, middle.y);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -20);
      await page.keyboard.up('Control');
    },
    'user',
  );
  await check(
    'pinch',
    () =>
      page.evaluate(() => {
        const root = window.__anniedrawing![0].stage.root;
        const send = (type: string, id: number, x: number) =>
          root.dispatchEvent(
            new PointerEvent(type, {
              pointerId: id,
              pointerType: 'touch',
              clientX: x,
              clientY: 300,
              button: 0,
              buttons: type === 'pointerup' ? 0 : 1,
              bubbles: true,
              cancelable: true,
            }),
          );
        send('pointerdown', 11, 500);
        send('pointerdown', 12, 700);
        send('pointermove', 11, 450);
        send('pointermove', 12, 750);
        send('pointerup', 11, 450);
        send('pointerup', 12, 750);
      }),
    'user',
  );
  await check(
    'hand tool drag',
    async () => {
      await page.evaluate(() => window.__anniedrawing![0].setTool('hand'));
      await page.mouse.move(middle.x, middle.y);
      await page.mouse.down();
      await page.mouse.move(middle.x + 60, middle.y + 40, { steps: 4 });
      await page.mouse.up();
      await page.evaluate(() => window.__anniedrawing![0].setTool('select'));
    },
    'user',
  );
  await check(
    'space drag',
    async () => {
      await page.evaluate(() => window.__anniedrawing![0].focus());
      await page.mouse.move(middle.x + 300, middle.y + 200);
      await page.keyboard.down('Space');
      await page.mouse.down();
      await page.mouse.move(middle.x + 240, middle.y + 150, { steps: 4 });
      await page.mouse.up();
      await page.keyboard.up('Space');
    },
    'user',
  );
  for (const key of ['Equal', 'Minus', 'Digit1', 'Digit2'])
    await check(
      `key ${key}`,
      async () => {
        await page.evaluate((key) => {
          const board = window.__anniedrawing![0];
          if (key === 'Digit1') board.stage.lens.set({ zoom: 0.8 });
          board.focus();
        }, key);
        await resetLog(page);
        await page.keyboard.press(key);
      },
      'user',
    );
  await check(
    'fit control',
    async () => {
      await page.evaluate(() => window.__anniedrawing![0].stage.lens.set({ zoom: 0.5 }));
      await resetLog(page);
      await page.getByRole('button', { name: 'Fit drawing' }).click();
    },
    'user',
  );
  await check(
    'zoom control',
    async () => {
      await page.getByRole('button', { name: 'Zoom controls' }).click();
      await page.getByRole('button', { name: 'Zoom in' }).click();
      await page.keyboard.press('Escape');
    },
    'user',
  );
  await check('view.fit()', () => page.evaluate(() => window.__anniedrawing![0].view.fit()), 'api');
  await check(
    'view.flyTo()',
    () =>
      page.evaluate(() =>
        window.__anniedrawing![0].view.flyTo({ x: 2000, y: 1500, w: 300, h: 200 }),
      ),
    'api',
  );
  await check(
    'view.zoom =',
    () =>
      page.evaluate(() => {
        window.__anniedrawing![0].view.zoom = 0.7;
      }),
    'api',
  );
  await check(
    'view.center =',
    () =>
      page.evaluate(() => {
        window.__anniedrawing![0].view.center = { x: -400, y: 900 };
      }),
    'api',
  );
  await check(
    'agent reveal',
    async () => {
      await page.evaluate(() => {
        window.__anniedrawing![0].apply(
          [{ op: 'add', item: { id: 'far', kind: 'rect', x: 9000, y: 7000, w: 140, h: 90 } }],
          { origin: 'agent:fellow' },
        );
      });
    },
    'agent',
  );
  await check(
    'host resize',
    () =>
      page.evaluate(() => {
        document.querySelector<HTMLElement>('#camera-fixture')!.style.right = '200px';
      }),
    'resize',
  );
});

test('fit reveals on createBoard also respect follow', async ({ page }) => {
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  const result = await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    await board.ready;
    board.clear();
    board.view.follow = false;
    const before = board.stage.lens.state;
    board.apply([{ op: 'add', item: { id: 'far', kind: 'rect', x: 9000, y: 7000 } }], {
      reveal: 'fit',
    });
    const held = board.stage.lens.state;
    board.view.follow = true;
    return { before, held, after: board.stage.lens.state };
  });
  expect(result.held).toEqual(result.before);
  expect(result.after).not.toEqual(result.before);
});

test('presented fires once per agent batch, overlapping or not', async ({ page }) => {
  await mount(page);
  const results = await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    const first = board.apply(
      [
        { op: 'add', item: { id: 'a', kind: 'rect', text: { value: 'First' } } },
        { op: 'add', item: { id: 'b', kind: 'rect', text: { value: 'Second' } } },
        { op: 'add', item: { id: 'ab', kind: 'arrow', from: 'a', to: 'b' } },
      ],
      { origin: 'agent:fellow' },
    );
    const animating = document.querySelectorAll('.annie-agent-pending').length > 0;
    const second = board.apply(
      [{ op: 'add', item: { id: 'c', kind: 'rect', text: { value: 'Third' } } }],
      { origin: 'agent:other' },
    );
    // None of these create anything through an agent batch.
    board.apply([{ op: 'add', item: { id: 'dry', kind: 'rect' } }], {
      origin: 'agent:fellow',
      dryRun: true,
    });
    board.apply([{ op: 'remove', id: 'missing' }], { origin: 'agent:fellow' });
    board.apply([{ op: 'set', id: 'a', patch: { text: { value: 'First!' } } }], {
      origin: 'agent:fellow',
    });
    board.apply([{ op: 'add', item: { id: 'api', kind: 'rect', x: 0, y: 400 } }]);
    return { first: first.created, second: second.created, animating };
  });
  expect(results.animating).toBe(true);
  await settle(page);
  await page.waitForTimeout(300);
  // Arrivals share one cursor walk, so the order between batches is not fixed.
  const events = (await log(page)).presented.sort((a, b) => a.origin.localeCompare(b.origin));
  expect(events).toEqual([
    { ids: results.first, origin: 'agent:fellow' },
    { ids: results.second, origin: 'agent:other' },
  ]);
});

test('presented fires at once under reduced motion and with agentPresence false', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(page);
  const reduced = await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    const log = (window as unknown as { cameraLog: Log }).cameraLog;
    const result = board.apply([{ op: 'add', item: { id: 'r', kind: 'note', text: 'Quick' } }], {
      origin: 'agent:fellow',
    });
    const sync = log.presented.length;
    await Promise.resolve();
    return { sync, after: [...log.presented], created: result.created };
  });
  expect(reduced.sync).toBe(0);
  expect(reduced.after).toEqual([{ ids: reduced.created, origin: 'agent:fellow' }]);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await mount(page, { agentPresence: false });
  const off = await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    const log = (window as unknown as { cameraLog: Log }).cameraLog;
    const result = board.apply(
      [
        { op: 'add', item: { id: 'p', kind: 'rect', text: 'One' } },
        { op: 'add', item: { id: 'q', kind: 'rect', text: 'Two' } },
      ],
      { origin: 'agent:fellow' },
    );
    await Promise.resolve();
    return { after: [...log.presented], created: result.created };
  });
  expect(off.after).toEqual([{ ids: off.created, origin: 'agent:fellow' }]);
  await page.waitForTimeout(300);
  expect((await log(page)).presented).toHaveLength(1);
});

test('toScreen and toPage round-trip, and viewport matches the host box', async ({ page }) => {
  await mount(page);
  const checks = await page.evaluate(() => {
    const board = window.__anniedrawing![0],
      host = board.stage.root;
    const out: { point: boolean; box: boolean; viewport: boolean; scale: boolean }[] = [];
    for (const [zoom, center] of [
      [1, { x: 0, y: 0 }],
      [0.37, { x: 1234.5, y: -987.25 }],
      [2.6, { x: -40, y: 310 }],
      [6.1, { x: 77777, y: 13 }],
    ] as const) {
      board.view.zoom = zoom;
      board.view.center = center;
      const p = { x: 123.25, y: -45.5 },
        b = { x: 10, y: 20, w: 300, h: 140 };
      const near = (a: number, c: number) => Math.abs(a - c) < 1e-6;
      const back = board.view.toScreen(board.view.toPage(p)),
        backBox = board.view.toScreen(board.view.toPage(b)),
        screenBox = board.view.toScreen(b),
        view = board.view.viewport,
        w = host.clientWidth / zoom,
        h = host.clientHeight / zoom;
      out.push({
        point: near(back.x, p.x) && near(back.y, p.y) && !('w' in back),
        box: (['x', 'y', 'w', 'h'] as const).every((key) => near(backBox[key], b[key])),
        scale: near(screenBox.w, b.w * zoom) && near(screenBox.h, b.h * zoom),
        viewport:
          near(view.x, center.x - w / 2) &&
          near(view.y, center.y - h / 2) &&
          near(view.w, w) &&
          near(view.h, h),
      });
    }
    return out;
  });
  for (const check of checks)
    expect(check).toEqual({ point: true, box: true, viewport: true, scale: true });
});
