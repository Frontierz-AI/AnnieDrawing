import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('legacy browser drawings migrate to pages and save without losing content', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    await board.ready;
    board.destroy();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('anniedrawing', 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('boards', 'readwrite');
        tx.objectStore('boards').put(
          {
            format: 'anniedrawing',
            version: 1,
            meta: { title: 'An existing drawing' },
            media: {},
            sheets: [
              {
                id: 's_legacy',
                name: 'Sheet 1',
                items: [
                  {
                    id: 'i_legacy',
                    kind: 'note',
                    x: 400,
                    y: 200,
                    w: 180,
                    h: 160,
                    text: { value: 'Keep this thought' },
                  },
                ],
              },
            ],
          },
          'annie-playground-v2',
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
      request.onerror = () => reject(request.error);
    });
  });
  await page.reload();
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  const loaded = await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    await board.ready;
    return board.read();
  });
  expect(loaded).toMatchObject({
    version: 2,
    pages: [
      {
        id: 's_legacy',
        name: 'Page 1',
        items: [{ id: 'i_legacy', text: { value: 'Keep this thought' } }],
      },
    ],
  });
  expect(loaded).not.toHaveProperty('sheets');
  await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    await new Promise<void>((resolve) => {
      const stop = board.on('save', ({ status }) => {
        if (status === 'saved') {
          stop();
          resolve();
        }
      });
      board.apply([{ op: 'page.set', id: 's_legacy', patch: { name: 'My ideas' } }]);
    });
  });
  await page.reload();
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  const saved = await page.evaluate(async () => {
    await window.__anniedrawing![0].ready;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = indexedDB.open('anniedrawing', 1);
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction('boards').objectStore('boards').get('annie-playground-v2');
        read.onsuccess = () => {
          db.close();
          resolve(read.result);
        };
        read.onerror = () => {
          db.close();
          reject(read.error);
        };
      };
      request.onerror = () => reject(request.error);
    });
  });
  expect(saved).toMatchObject({
    version: 2,
    pages: [
      {
        id: 's_legacy',
        name: 'My ideas',
        items: [{ id: 'i_legacy', text: { value: 'Keep this thought' } }],
      },
    ],
  });
  expect(saved).not.toHaveProperty('sheets');
});

test('PNG export defaults to the entire current page at twice the resolution', async ({ page }) => {
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    await board.ready;
    board.clear();
    board.apply([
      {
        op: 'add',
        item: {
          id: 'i_selected',
          kind: 'rect',
          x: 400,
          y: 200,
          w: 120,
          h: 80,
          style: { fill: 'violet' },
        },
      },
      {
        op: 'add',
        item: {
          id: 'i_unselected',
          kind: 'rect',
          x: 700,
          y: 200,
          w: 120,
          h: 80,
          style: { fill: 'teal' },
        },
      },
    ]);
    board.select(['i_selected']);
  });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('button', { name: 'PNG Image', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'SVG Image', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'AnnieDoc format', exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG Image', exact: true }).click();
  const png = await readFile((await (await downloading).path())!);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1000, 320]);
  const green = await page.evaluate(
    async (data) => {
      const image = new Image();
      image.src = data;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return [...context.getImageData(800, 160, 1, 1).data];
    },
    `data:image/png;base64,${png.toString('base64')}`,
  );
  expect(green).toEqual([5, 217, 171, 255]);

  const dimensions = await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    const { exportPNG } = await import('/src/porter/png.ts' as string);
    const size = async (blob: Blob) => {
      const bytes = new DataView(await blob.arrayBuffer());
      return [bytes.getUint32(16), bytes.getUint32(20)];
    };
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="red"/></svg>';
    return Promise.all([
      size(await exportPNG(svg)),
      size(await exportPNG(svg, 1)),
      size((await board.export('png', { padding: 40 })) as Blob),
      size((await board.export('png', { padding: 40, scale: 1 })) as Blob),
    ]);
  });
  expect(dimensions).toEqual([
    [240, 160],
    [120, 80],
    [1000, 320],
    [500, 160],
  ]);
});
