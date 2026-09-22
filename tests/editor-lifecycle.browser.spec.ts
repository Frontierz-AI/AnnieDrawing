import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.length);
  await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    await board.ready;
    board.clear();
    board.stage.lens.set({ x: 0, y: 0, zoom: 1 });
    board.apply([
      {
        op: 'add',
        item: { id: 'n', kind: 'note', x: 300, y: 200, w: 200, h: 160, text: { value: 'X' } },
      },
    ]);
  });
}

test('finishing an edit by clicking a host field leaves focus and keys there', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const field = document.createElement('input');
    field.id = 'host-field';
    field.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:10000';
    document.body.append(field);
    window.__anniedrawing![0].editText('n');
  });
  await page.keyboard.type('Hello');
  await page.locator('#host-field').click();
  await page.keyboard.type('r');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('ok');
  await expect(page.locator('#host-field')).toHaveValue('ok');
  const board = await page.evaluate(() => {
    const b = window.__anniedrawing![0];
    return { text: b.get('n')?.text?.value, tool: b.tool };
  });
  expect(board).toEqual({ text: 'Hello', tool: 'select' });
});

test('a remote removal closes the editor so the next item can be edited', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => window.__anniedrawing![0].editText('n'));
  await expect(page.locator('.ad-editing')).toHaveCount(1);
  await page.evaluate(() => {
    const b = window.__anniedrawing![0];
    b.apply([{ op: 'remove', id: 'n' }], { origin: 'agent:helper' });
    b.apply([{ op: 'add', item: { id: 'm', kind: 'note', x: 40, y: 40, w: 160, h: 120 } }]);
    b.editText('m');
  });
  await expect(page.locator('[data-ad-id="m"] .ad-editing')).toHaveCount(1);
});

test('a cancelled pointer and a text drop inside the editor keep the edit', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => window.__anniedrawing![0].editText('n'));
  await page.keyboard.type('typed words');
  await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>('.ad-editing')!;
    editor.dispatchEvent(
      new PointerEvent('pointercancel', { bubbles: true, pointerId: 1, pointerType: 'mouse' }),
    );
    const data = new DataTransfer();
    data.setData('text/plain', 'word');
    editor.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }),
    );
  });
  await expect(page.locator('.ad-editing')).toHaveCount(1);
  await page.keyboard.press('Control+Enter');
  const items = await page.evaluate(() =>
    window.__anniedrawing![0].query().map((item) => [item.id, item.text?.value]),
  );
  expect(items).toEqual([['n', 'typed words']]);
});

test('an item moved while it fades in ends at the new position', async ({ page }) => {
  await ready(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const b = window.__anniedrawing![0];
        b.apply([{ op: 'add', item: { id: 'a', kind: 'rect', x: 100, y: 100, w: 120, h: 80 } }], {
          origin: 'agent:planner',
          reveal: 'none',
        });
        const element = b.stage.world.querySelector<HTMLElement>('[data-ad-id="a"]')!;
        const wait = () => {
          if (element.classList.contains('ad-agent-pending')) requestAnimationFrame(wait);
          else {
            b.apply([{ op: 'set', id: 'a', patch: { x: 600 } }]);
            resolve();
          }
        };
        wait();
      }),
  );
  await expect(page.locator('.ad-agent-cursor')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector<HTMLElement>('[data-ad-id="a"]')!.style.transform.split(' ')[0],
      ),
    )
    .toBe('translate3d(600px,');
});

test('a drag keeps its move when an agent removes one dragged item', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const b = window.__anniedrawing![0];
    b.apply([{ op: 'add', item: { id: 'o', kind: 'rect', x: 600, y: 200, w: 120, h: 80 } }]);
    b.select(['n', 'o']);
  });
  const box = (await page.locator('[data-ad-id="n"]').boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 70, { steps: 4 });
  await page.evaluate(() =>
    window.__anniedrawing![0].apply([{ op: 'remove', id: 'o' }], { origin: 'agent:helper' }),
  );
  await page.mouse.move(box.x + 140, box.y + 100, { steps: 4 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__anniedrawing![0].get('n'))).toMatchObject({
    x: 400,
    y: 260,
  });
});
