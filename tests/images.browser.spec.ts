import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';

const CORS = 'http://cors.images.test';
/**
 * `page.route` adds `Access-Control-Allow-Origin` to every cross-origin response it fulfills, so
 * the image host without CORS headers is a real local server on another port.
 */
let PLAIN = '';
let server: Server;
let green: Buffer | undefined;
test.beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/green.png' && green) {
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      response.end(green);
    } else {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  PLAIN = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** Solid-color PNG bytes drawn by the browser, so the fixtures need no binary files. */
async function png(page: Page, fill: string): Promise<Buffer> {
  const data = await page.evaluate((fill) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 40;
    const context = canvas.getContext('2d')!;
    context.fillStyle = fill;
    context.fillRect(0, 0, 40, 40);
    return canvas.toDataURL('image/png');
  }, fill);
  return Buffer.from(data.split(',')[1], 'base64');
}

async function mount(page: Page) {
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  const blue = await png(page, '#0000ff');
  green ??= await png(page, '#00ff00');
  await page.route(`${CORS}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: blue,
    }),
  );
  await page.evaluate(
    async ({ CORS, PLAIN }) => {
      for (const board of [...(window.__anniedrawing ?? [])]) board.destroy();
      document.body.innerHTML = '<main id="images-fixture" style="position:fixed;inset:0"></main>';
      const { createBoard } = await import('/src/board.ts' as string);
      const board = createBoard(document.querySelector('#images-fixture')!, {
        exposeGlobal: true,
        ui: false,
        agentPresence: false,
        agentReveal: 'none',
        allowedImageOrigins: [CORS, PLAIN],
      });
      board.stage.lens.set({ x: 0, y: 0, zoom: 1 });
      (window as unknown as { mediaEvents: unknown[] }).mediaEvents = [];
      board.on('media', (event: unknown) =>
        (window as unknown as { mediaEvents: unknown[] }).mediaEvents.push(event),
      );
    },
    { CORS, PLAIN },
  );
}

test('media.set on a used key swaps the picture within one frame and keeps connectors bound', async ({
  page,
}) => {
  await mount(page);
  const red = `data:image/png;base64,${(await png(page, '#ff0000')).toString('base64')}`;
  const blue = `data:image/png;base64,${(await png(page, '#0000ff')).toString('base64')}`;
  const result = await page.evaluate(
    async ({ red, blue }) => {
      const board = window.__anniedrawing![0];
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      board.apply(
        [
          { op: 'media.set', id: 'm', media: { mime: 'image/png', w: 40, h: 40, src: red } },
          { op: 'add', item: { id: 'a', kind: 'image', media: 'm', x: 40, y: 40, w: 120, h: 120 } },
          { op: 'add', item: { id: 'b', kind: 'rect', x: 400, y: 40, w: 120, h: 120 } },
          { op: 'add', item: { id: 'c', kind: 'arrow', from: 'a', to: 'b' } },
        ],
        { origin: 'agent:fellow' },
      );
      await frame();
      const img = () => board.stage.world.querySelector<HTMLImageElement>('[data-ad-id="a"] img');
      const before = {
        src: img()?.src,
        path: board.stage.world.querySelector('[data-ad-id="c"] path')?.getAttribute('d'),
      };
      const swap = board.apply(
        [{ op: 'media.set', id: 'm', media: { mime: 'image/png', w: 40, h: 40, src: blue } }],
        { origin: 'agent:fellow' },
      );
      await frame();
      return {
        swap,
        before,
        after: {
          src: img()?.src,
          path: board.stage.world.querySelector('[data-ad-id="c"] path')?.getAttribute('d'),
        },
        connector: board.get('c'),
        ids: board.items.map((item: { id: string }) => item.id),
      };
    },
    { red, blue },
  );
  expect(result.before.src).toBe(red);
  expect(result.after.src).toBe(blue);
  expect(result.swap.ok).toBe(true);
  expect(result.swap.created).toEqual([]);
  expect(result.connector!.from).toMatchObject({ item: 'a' });
  expect(result.connector!.to).toMatchObject({ item: 'b' });
  expect(result.after.path).toBe(result.before.path);
  expect(result.ids).toEqual(['a', 'b', 'c']);
});

test('JPEG export draws data-URL and CORS images, and a labeled placeholder plus a warning otherwise', async ({
  page,
}) => {
  await mount(page);
  const red = `data:image/png;base64,${(await png(page, '#ff0000')).toString('base64')}`;
  const output = await page.evaluate(
    async ({ red, CORS, PLAIN }) => {
      const board = window.__anniedrawing![0];
      const image = (id: string, x: number, name: string) => ({
        op: 'add' as const,
        item: { id, kind: 'image', media: `m_${id}`, x, y: 0, w: 100, h: 100, name },
      });
      const added = board.apply(
        [
          { op: 'media.set', id: 'm_data', media: { mime: 'image/png', w: 40, h: 40, src: red } },
          {
            op: 'media.set',
            id: 'm_cors',
            media: { mime: 'image/png', w: 40, h: 40, src: `${CORS}/blue.png` },
          },
          {
            op: 'media.set',
            id: 'm_plain',
            media: { mime: 'image/png', w: 40, h: 40, src: `${PLAIN}/green.png` },
          },
          image('data', 0, 'Red'),
          image('cors', 200, 'Blue'),
          image('plain', 400, 'No CORS picture'),
        ],
        { origin: 'agent:fellow' },
      );
      const warnings: { code: string; id: string; media: string }[] = [];
      const blob = (await board.export('jpeg', {
        scale: 1,
        padding: 0,
        background: '#ffffff',
        onWarning: (warning: { code: string; id: string; media: string }) => warnings.push(warning),
      })) as Blob;
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const pixel = (x: number, y: number) => [
        ...context.getImageData(x, y, 1, 1).data.slice(0, 3),
      ];
      const svgWarnings: string[] = [];
      const embedded = (await board.export('svg', {
        embedImages: true,
        onWarning: (warning: { id: string }) => svgWarnings.push(warning.id),
      })) as string;
      const plain = (await board.export('svg')) as string;
      return {
        ok: added.ok,
        type: blob.type,
        size: [bitmap.width, bitmap.height],
        data: pixel(50, 50),
        cors: pixel(250, 50),
        plainCenter: pixel(450, 50),
        plainFill: pixel(450, 15),
        warnings,
        svgWarnings,
        embedded,
        plain,
      };
    },
    { red, CORS, PLAIN },
  );
  expect(output.ok).toBe(true);
  expect(output.type).toBe('image/jpeg');
  expect(output.size).toEqual([500, 100]);
  const near = (actual: number[], expected: number[], tolerance = 40) =>
    actual.every((value, index) => Math.abs(value - expected[index]) < tolerance);
  expect(near(output.data, [255, 0, 0])).toBe(true);
  expect(near(output.cors, [0, 0, 255])).toBe(true);
  // The third image is a tinted, labeled box, not the picture and not the white background.
  expect(near(output.plainFill, [0, 255, 0])).toBe(false);
  expect(near(output.plainFill, [255, 255, 255], 10)).toBe(false);
  expect(near(output.plainCenter, [0, 255, 0])).toBe(false);
  expect(output.warnings).toEqual([
    expect.objectContaining({ code: 'IMAGE_UNAVAILABLE', id: 'plain', media: 'm_plain' }),
  ]);
  expect(output.svgWarnings).toEqual(['plain']);
  expect(output.embedded).toContain('No CORS picture');
  expect(output.embedded).not.toContain(`${CORS}/blue.png`);
  expect(output.embedded).not.toContain(`${PLAIN}/green.png`);
  expect(output.embedded.match(/href="data:image\/png/g)?.length).toBe(2);
  expect(output.plain).toContain(`${CORS}/blue.png`);
  expect(output.plain).toContain(`${PLAIN}/green.png`);
});

test('a remote image that fails shows the placeholder and fires the media error event', async ({
  page,
}) => {
  await mount(page);
  await page.evaluate((PLAIN) => {
    window.__anniedrawing![0].apply(
      [
        {
          op: 'media.set',
          id: 'm_missing',
          media: { mime: 'image/png', w: 40, h: 40, src: `${PLAIN}/missing.png` },
        },
        {
          op: 'media.set',
          id: 'm_ok',
          media: { mime: 'image/png', w: 40, h: 40, src: `${PLAIN}/green.png` },
        },
        { op: 'add', item: { id: 'broken', kind: 'image', media: 'm_missing', x: 0, y: 0 } },
        { op: 'add', item: { id: 'fine', kind: 'image', media: 'm_ok', x: 300, y: 0 } },
      ],
      { origin: 'agent:fellow' },
    );
  }, PLAIN);
  await expect(page.locator('[data-ad-id="broken"] .annie-placeholder')).toHaveText(
    /Image unavailable/,
  );
  await expect(page.locator('[data-ad-id="broken"] img')).toHaveCount(0);
  await expect(page.locator('[data-ad-id="fine"] img')).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { mediaEvents: unknown[] }).mediaEvents))
    .toEqual(
      expect.arrayContaining([
        { id: 'broken', media: 'm_missing', status: 'error' },
        { id: 'fine', media: 'm_ok', status: 'loaded' },
      ]),
    );
});

test('a pending image takes an arrow in the same batch and resolves under the same id', async ({
  page,
}) => {
  await mount(page);
  const blue = `data:image/png;base64,${(await png(page, '#0000ff')).toString('base64')}`;
  const created = await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    return board.apply(
      [
        { op: 'add', item: { id: 'idea', kind: 'rect', text: 'Idea' } },
        {
          op: 'add',
          item: {
            id: 'img_1',
            kind: 'image',
            pending: true,
            name: 'Team at a whiteboard',
            w: 320,
            h: 213,
          },
        },
        { op: 'add', item: { id: 'link', kind: 'arrow', from: 'idea', to: 'img_1' } },
      ],
      { origin: 'agent:fellow' },
    );
  });
  expect(created.ok).toBe(true);
  expect(created.created).toEqual(expect.arrayContaining(['idea', 'img_1', 'link']));
  const pending = page.locator('[data-ad-id="img_1"] .annie-pending');
  await expect(pending).toContainText('Team at a whiteboard');
  await expect(page.locator('[data-ad-id="img_1"]')).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() =>
    window.__anniedrawing![0].apply([{ op: 'set', id: 'img_1', patch: { progress: 0.5 } }], {
      origin: 'agent:fellow',
    }),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (document.querySelector('[data-ad-id="img_1"] .annie-pending i') as HTMLElement).style
            .width,
      ),
    )
    .toBe('50%');
  // A normal item: the board hit-tests and selects it.
  const box = (await page.locator('[data-ad-id="img_1"]').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect(await page.evaluate(() => window.__anniedrawing![0].selection)).toEqual(['img_1']);
  const resolved = await page.evaluate((blue) => {
    const board = window.__anniedrawing![0];
    return board.apply(
      [
        { op: 'media.set', id: 'm_1', media: { mime: 'image/png', w: 1536, h: 1024, src: blue } },
        { op: 'set', id: 'img_1', patch: { media: 'm_1', pending: false } },
      ],
      { origin: 'agent:fellow' },
    );
  }, blue);
  expect(resolved.ok).toBe(true);
  expect(resolved.created).toEqual([]);
  await expect(page.locator('[data-ad-id="img_1"] img')).toHaveAttribute('src', blue);
  await expect(pending).toHaveCount(0);
  await expect(page.locator('[data-ad-id="img_1"]')).not.toHaveAttribute('aria-busy', 'true');
  const after = await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    return { image: board.get('img_1'), link: board.get('link') };
  });
  expect(after.image).toMatchObject({ id: 'img_1', media: 'm_1', w: 320, h: 213 });
  expect(after.link!.to).toMatchObject({ item: 'img_1' });
});

test('the pending shimmer stops under reduced motion', async ({ page }) => {
  await mount(page);
  await page.evaluate(() =>
    window.__anniedrawing![0].apply(
      [
        {
          op: 'add',
          item: { id: 'img_1', kind: 'image', pending: true, name: 'Soon', x: 0, y: 0 },
        },
      ],
      { origin: 'agent:fellow' },
    ),
  );
  const shimmer = () =>
    page.evaluate(() => {
      const element = document.querySelector('[data-ad-id="img_1"] .annie-pending')!;
      const style = getComputedStyle(element, '::before');
      return { name: style.animationName, display: style.display };
    });
  await expect(page.locator('[data-ad-id="img_1"] .annie-pending')).toBeVisible();
  expect((await shimmer()).name).toBe('annie-shimmer');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await shimmer()).toEqual({ name: 'none', display: 'none' });
});
