import { expect, test, type Page } from '@playwright/test';

const KEY = 'annie-playground-v2';

async function open(page: Page, path = '/') {
  await page.goto(path);
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  await page.evaluate(() => window.__anniedrawing![0].ready);
}
/** Apply a user edit and wait until autosave reports the outcome. */
function edit(page: Page, id: string, flush = false) {
  return page.evaluate(
    ({ id, flush }) =>
      new Promise<string>((resolve) => {
        const board = window.__anniedrawing![0];
        const stop = board.on('save', (event) => {
          if (event.status === 'saved' || event.status === 'conflict' || event.status === 'error') {
            stop();
            resolve(event.status);
          }
        });
        board.apply([{ op: 'add', item: { id, kind: 'rect', x: 40, y: 40 }, page: board.pageId }]);
        if (flush) window.dispatchEvent(new Event('pagehide'));
      }),
    { id, flush },
  );
}
function stored(page: Page, key = KEY) {
  return page.evaluate(
    (key) =>
      new Promise<unknown>((resolve, reject) => {
        const request = indexedDB.open('anniedrawing', 1);
        request.onsuccess = () => {
          const read = request.result.transaction('boards').objectStore('boards').get(key);
          read.onsuccess = () => {
            request.result.close();
            resolve(read.result);
          };
          read.onerror = () => reject(read.error);
        };
        request.onerror = () => reject(request.error);
      }),
    key,
  );
}
const ids = (doc: unknown) =>
  ((doc as { pages?: { items: { id: string }[] }[] })?.pages ?? []).flatMap((page) =>
    page.items.map((item) => item.id),
  );

test('a blank board leaves the saved drawing alone', async ({ page }) => {
  await open(page);
  expect(await edit(page, 'kept')).toBe('saved');
  await open(page, '/?blank');
  expect(await page.evaluate(() => window.__anniedrawing![0].query().length)).toBe(0);
  // Longer than the autosave debounce: an empty board saved here would replace the drawing.
  await page.waitForTimeout(800);
  await open(page);
  expect(await page.evaluate(() => !!window.__anniedrawing![0].get('kept'))).toBe(true);
});

test('an idle tab follows, and concurrent edits ask before overwriting', async ({
  page,
  context,
}) => {
  await open(page);
  const other = await context.newPage();
  await open(other);
  expect(await edit(page, 'first')).toBe('saved');
  await expect
    .poll(() => other.evaluate(() => !!window.__anniedrawing![0].get('first')))
    .toBe(true);
  // The other tab edits too, and this tab saves first: the other tab must not overwrite it.
  await other.evaluate(() => {
    const board = window.__anniedrawing![0];
    board.apply([{ op: 'add', item: { id: 'mine', kind: 'rect', x: 300, y: 40 } }]);
  });
  expect(await edit(page, 'theirs', true)).toBe('saved');
  const notice = other.locator('.ad-save-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('changed in another tab');
  expect(ids(await stored(page))).toEqual(expect.arrayContaining(['first', 'theirs']));
  expect(ids(await stored(page))).not.toContain('mine');
  await notice.getByRole('button', { name: 'Keep this version' }).click();
  await expect(notice).toBeHidden();
  await expect.poll(async () => ids(await stored(page))).toContain('mine');
  await expect.poll(() => page.evaluate(() => !!window.__anniedrawing![0].get('mine'))).toBe(true);
});

test('edits made before the saved drawing loads do not overwrite it', async ({ page }) => {
  await open(page);
  expect(await edit(page, 'saved_first')).toBe('saved');
  const outcome = await page.evaluate(async () => {
    const Board = window.__anniedrawing![0].constructor as new (
      host: HTMLElement,
      options: object,
    ) => NonNullable<typeof window.__anniedrawing>[number];
    const host = document.createElement('div');
    document.body.append(host);
    const early = new Board(host, { autosaveKey: 'annie-playground-v2', ui: false });
    const events: string[] = [];
    early.on('save', (event) => events.push(event.status));
    early.apply([{ op: 'add', item: { id: 'too_early', kind: 'note', x: 0, y: 0 } }]);
    await early.ready;
    await new Promise((resolve) => setTimeout(resolve, 400));
    early.destroy();
    host.remove();
    return events;
  });
  expect(outcome).toContain('conflict');
  expect(ids(await stored(page))).toEqual(['saved_first']);
});

test('an unreadable saved drawing is kept aside and new work still saves', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    window.__anniedrawing![0].destroy();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('anniedrawing', 1);
      request.onsuccess = () => {
        const tx = request.result.transaction('boards', 'readwrite');
        tx.objectStore('boards').put(
          { format: 'anniedrawing', version: 99 },
          'annie-playground-v2',
        );
        tx.oncomplete = () => {
          request.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  await expect(page.locator('.ad-save-notice')).toContainText('could not be opened');
  expect(await edit(page, 'fresh')).toBe('saved');
  await expect(page.locator('.ad-save-notice')).toBeHidden();
  expect(ids(await stored(page))).toEqual(['fresh']);
  const keys = await page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const request = indexedDB.open('anniedrawing', 1);
        request.onsuccess = () => {
          const read = request.result.transaction('boards').objectStore('boards').getAllKeys();
          read.onsuccess = () => {
            request.result.close();
            resolve(read.result.map(String));
          };
        };
      }),
  );
  const aside = keys.find((key) => key.startsWith('annie-playground-v2#unreadable-'))!;
  expect(await stored(page, aside)).toEqual({ format: 'anniedrawing', version: 99 });
});

test('a write that aborts reports an error instead of staying on saving', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      const request = put.apply(this, args);
      this.transaction.abort();
      return request;
    };
  });
  expect(await edit(page, 'lost')).toBe('error');
  await expect(page.locator('.ad-save-notice')).toContainText('Could not save locally');
});
