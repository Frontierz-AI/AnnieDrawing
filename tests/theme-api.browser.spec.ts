import { expect, test, type Page } from '@playwright/test';

type RGBA = [number, number, number, number];
type Colors = Record<string, RGBA>;

async function mount(page: Page, options: Record<string, unknown> = {}, hostCSS = '') {
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  await page.evaluate(
    async ({ options, hostCSS }) => {
      for (const board of [...(window.__anniedrawing ?? [])]) board.destroy();
      document.body.innerHTML = `<style>${hostCSS}</style><main id="theme-host" style="position:fixed;inset:0"></main>`;
      const { createBoard } = await import('/src/board.ts' as string);
      const board = createBoard(document.querySelector('#theme-host')!, {
        exposeGlobal: true,
        agentPresence: false,
        ...options,
      });
      board.apply([
        { op: 'add', item: { id: 'r', kind: 'rect', x: 300, y: 200, w: 160, h: 100 } },
        { op: 'add', item: { id: 't', kind: 'text', x: 300, y: 400, w: 200, h: 40, text: 'Hi' } },
        { op: 'page.add', page: { id: 'p2', name: 'Second' } },
      ]);
    },
    { options, hostCSS },
  );
}

/** Computed colors of the accent-bearing chrome, normalized to 0-255 RGBA. */
async function colors(page: Page): Promise<Colors> {
  const read = (selector: string, property: string) =>
    page.evaluate(
      ([selector, property]) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing ${selector}`);
        return getComputedStyle(element).getPropertyValue(property);
      },
      [selector, property],
    );
  const parse = (value: string): RGBA => {
    const numbers = (value.match(/-?[\d.]+(e-?\d+)?/g) ?? []).map(Number);
    if (value.startsWith('color(srgb'))
      return [numbers[0] * 255, numbers[1] * 255, numbers[2] * 255, (numbers[3] ?? 1) * 255];
    if (value.startsWith('rgb'))
      return [numbers[0], numbers[1], numbers[2], (numbers[3] ?? 1) * 255];
    throw new Error(`Unparsed color ${value}`);
  };
  const result: Colors = {};
  const take = async (name: string, selector: string, property: string) => {
    result[name] = parse(await read(selector, property));
  };
  await take('export', '.annie-header-export', 'background-color');
  await take('exportText', '.annie-header-export', 'color');
  await take('brand', '.annie-brand-mark', 'background-color');
  await take(
    'pressedTool',
    '.annie-toolbar .annie-icon-button[aria-pressed="true"]',
    'background-color',
  );
  if (await page.locator('.annie-page-tab[aria-selected="true"]').count())
    await take('pageTab', '.annie-page-tab[aria-selected="true"]', 'background-color');
  // Keyboard focus on a toolbar button shows the focus ring.
  await page.evaluate(() => (document.querySelector('.annie-root') as HTMLElement).focus());
  await page.keyboard.press('Tab');
  result.focus = parse(
    await page.evaluate(() => getComputedStyle(document.activeElement!).outlineColor),
  );
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  // Selecting an item shows the selection outline and the style dock's range inputs.
  await page.evaluate(() => window.__anniedrawing![0].select(['r']));
  await take('selection', '.annie-selection-outline', 'stroke');
  await page.getByRole('button', { name: 'Opacity', exact: true }).click();
  await take('range', '.annie-field input[type="range"]', 'accent-color');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__anniedrawing![0].select([]));
  // A marquee exists only while dragging on empty canvas.
  await page.mouse.move(700, 560);
  await page.mouse.down();
  await page.mouse.move(820, 640, { steps: 4 });
  await take('marqueeFill', '.annie-marquee', 'fill');
  await take('marqueeStroke', '.annie-marquee', 'stroke');
  await page.mouse.up();
  await page.evaluate(() => window.__anniedrawing![0].editText('t'));
  await take('editing', '.annie-editing', 'outline-color');
  await page.keyboard.press('Escape');
  return result;
}

function expectColor(actual: RGBA | undefined, expected: RGBA, name: string) {
  expect(actual, name).toBeDefined();
  actual!.forEach((channel, index) =>
    expect(Math.abs(channel - expected[index]), `${name} channel ${index}`).toBeLessThanOrEqual(1),
  );
}

const ACCENT: RGBA = [5, 217, 171, 255];
const LIGHT_DEFAULTS: Colors = {
  export: ACCENT,
  exportText: [16, 54, 57, 255],
  brand: ACCENT,
  pressedTool: [5, 217, 171, 0x30],
  pageTab: [5, 217, 171, 0x25],
  focus: [5, 180, 143, 255],
  selection: [0, 135, 108, 255],
  range: [5, 180, 143, 255],
  marqueeFill: [5, 217, 171, 0x16],
  marqueeStroke: [0, 135, 108, 255],
  editing: ACCENT,
};

test('with no host tokens the accent chrome keeps its 0.7 colors', async ({ page }) => {
  await mount(page);
  const light = await colors(page);
  expect(Object.keys(light)).toContain('pageTab');
  for (const [name, expected] of Object.entries(LIGHT_DEFAULTS))
    expectColor(light[name], expected, name);
  await mount(page, { theme: 'dark' });
  const dark = await colors(page);
  for (const [name, expected] of Object.entries({ ...LIGHT_DEFAULTS, selection: ACCENT }))
    expectColor(dark[name], expected, `dark ${name}`);
});

const PURPLE: RGBA = [124, 58, 237, 255];
const isPurple = (color: RGBA | undefined) =>
  !!color && color[2] > color[1] + 60 && color[0] > color[1];

for (const theme of ['light', 'dark', 'auto'] as const) {
  test(`only --ad-ui-accent on the host recolors the accent chrome (${theme})`, async ({
    page,
  }) => {
    if (theme === 'auto') await page.emulateMedia({ colorScheme: 'dark' });
    await mount(page, { theme });
    await page.evaluate(() =>
      document
        .querySelector<HTMLElement>('#theme-host')!
        .style.setProperty('--ad-ui-accent', '#7c3aed'),
    );
    const c = await colors(page);
    expectColor(c.export, PURPLE, 'export');
    expectColor(c.brand, PURPLE, 'brand');
    expectColor(c.editing, PURPLE, 'editing');
    expectColor(c.pressedTool, [124, 58, 237, 0x30], 'pressedTool');
    expectColor(c.pageTab, [124, 58, 237, 0x25], 'pageTab');
    expectColor(c.marqueeFill, [124, 58, 237, 0x16], 'marqueeFill');
    for (const name of ['focus', 'range', 'marqueeStroke', 'selection'])
      expect(isPurple(c[name]), `${name} ${c[name]}`).toBe(true);
  });
}

test('a host stylesheet rule and the other tokens win over the theme defaults', async ({
  page,
}) => {
  await mount(
    page,
    { theme: 'dark' },
    `#theme-host {
      --ad-ui-accent: #7c3aed;
      --ad-ui-accent-soft: rgb(10 20 30 / 50%);
      --ad-ui-accent-strong: rgb(200 0 100);
      --ad-ui-accent-fg: rgb(255 255 255);
      --ad-focus: rgb(255 0 0);
    }`,
  );
  const c = await colors(page);
  expectColor(c.export, PURPLE, 'export');
  expectColor(c.exportText, [255, 255, 255, 255], 'exportText');
  expectColor(c.pressedTool, [10, 20, 30, 127.5], 'pressedTool');
  expectColor(c.marqueeFill, [10, 20, 30, 127.5], 'marqueeFill');
  expectColor(c.marqueeStroke, [200, 0, 100, 255], 'marqueeStroke');
  expectColor(c.range, [200, 0, 100, 255], 'range');
  expectColor(c.focus, [255, 0, 0, 255], 'focus');
  expectColor(c.selection, [255, 0, 0, 255], 'selection');
});

test('--ad-header-inset-end moves the header actions and nothing else', async ({ page }) => {
  await mount(page);
  const boxes = () =>
    page.evaluate(() => {
      const box = (element: Element) => {
        const r = element.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height].map(Math.round);
      };
      const ui = document.querySelector('.annie-ui')!;
      return {
        actions: box(document.querySelector('.annie-header-actions')!),
        brand: box(document.querySelector('.annie-brand')!),
        chrome: [...ui.children]
          .filter((element) => !element.classList.contains('annie-header'))
          .map((element) => [element.className, ...box(element)]),
        root: box(document.querySelector('.annie-root')!),
      };
    });
  const before = await boxes();
  expect(before.chrome.length).toBeGreaterThan(1);
  await page.evaluate(() =>
    document
      .querySelector<HTMLElement>('#theme-host')!
      .style.setProperty('--ad-header-inset-end', '100px'),
  );
  const after = await boxes();
  expect(after.actions[0]).toBe(before.actions[0] - 100);
  expect(after.actions.slice(1)).toEqual(before.actions.slice(1));
  expect(after.brand).toEqual(before.brand);
  expect(after.chrome).toEqual(before.chrome);
  expect(after.root).toEqual(before.root);
  await page.evaluate(() =>
    document
      .querySelector<HTMLElement>('#theme-host')!
      .style.setProperty('--ad-header-inset-start', '50px'),
  );
  const both = await boxes();
  expect(both.brand[0]).toBe(before.brand[0] + 50);
  expect(both.actions).toEqual(after.actions);
});
