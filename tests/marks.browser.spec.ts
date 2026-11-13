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

const cases = [
  {
    name: 'plain',
    text: { value: 'Prepare the room first. Exactly 1 trial run before the class, then rest.' },
  },
  {
    name: 'md with a bold phrase',
    text: {
      value: '# Plan\n- Prepare the room first\n- Then **Exactly 1 trial run** before class',
      format: 'md' as const,
    },
  },
];

for (const { name, text } of cases)
  test(`a highlight stays on the phrase (${name}) through moves, re-wraps, edits, rotation, and zoom`, async ({
    page,
  }) => {
    await ready(page);
    const steps = await page.evaluate(async (text) => {
      const board = window.__anniedrawing![0];
      const frame = () => new Promise((done) => requestAnimationFrame(() => done(undefined)));
      const phrase = 'Exactly 1 trial run';
      board.apply([
        { op: 'add', item: { id: 'notes', kind: 'rect', x: 80, y: 60, w: 360, h: 220, text } },
        { op: 'add', item: { id: 'm', kind: 'mark', target: 'notes', match: phrase } },
      ]);
      const union = (rects: DOMRect[]) => {
        const list = rects.filter((r) => r.width > 0.5);
        const x = Math.min(...list.map((r) => r.left)),
          y = Math.min(...list.map((r) => r.top));
        return {
          x,
          y,
          w: Math.max(...list.map((r) => r.right)) - x,
          h: Math.max(...list.map((r) => r.bottom)) - y,
        };
      };
      /** The phrase as the browser lays it out, found in the rendered label. */
      const phraseRange = () => {
        const label = board.stage.world.querySelector('[data-ad-id="notes"] .annie-text')!;
        const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
        for (
          let node = walker.nextNode() as Text | null;
          node;
          node = walker.nextNode() as Text | null
        ) {
          const at = node.data.indexOf(phrase);
          if (at < 0) continue;
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + phrase.length);
          return range;
        }
        throw new Error('phrase not rendered');
      };
      const measure = async (step: string) => {
        await frame();
        await frame();
        const results = [];
        for (const zoom of [1, 1.7]) {
          board.stage.lens.set({ x: 30, y: 20, zoom });
          await frame();
          await frame();
          const want = union([...phraseRange().getClientRects()]);
          const paths = [...board.stage.world.querySelectorAll('[data-ad-id="m"] path')];
          const got = union(paths.map((path) => path.getBoundingClientRect()));
          const root = board.stage.root.getBoundingClientRect();
          const page = board.boundsOf(['m']);
          const lens = board.stage.lens.state;
          const pageInClient = {
            x: page.x * lens.zoom + lens.x + root.left,
            y: page.y * lens.zoom + lens.y + root.top,
            w: page.w * lens.zoom,
            h: page.h * lens.zoom,
          };
          const rows = new Set(
            [...phraseRange().getClientRects()]
              .filter((r) => r.width > 0.5)
              .map((r) => Math.round(r.top)),
          ).size;
          results.push({ step, zoom, want, got, pageInClient, rows, paths: paths.length });
        }
        board.stage.lens.set({ x: 0, y: 0, zoom: 1 });
        return results;
      };
      const out = [...(await measure('initial'))];
      board.apply([{ op: 'set', id: 'notes', patch: { x: 300, y: 200 } }]);
      out.push(...(await measure('moved')));
      board.apply([{ op: 'set', id: 'notes', patch: { w: 170, h: 360 } }]);
      out.push(...(await measure('narrow')));
      const edited = text.value.replace('Prepare', 'Before anything else, prepare');
      board.apply([{ op: 'set', id: 'notes', patch: { w: 300, text: { value: edited } } }]);
      out.push(...(await measure('edited')));
      board.apply([{ op: 'set', id: 'notes', patch: { rotation: 30 } }]);
      out.push(...(await measure('rotated')));
      return out;
    }, text);
    expect(steps.some((step) => step.rows > 1)).toBe(true);
    for (const step of steps) {
      const label = `${step.step} at zoom ${step.zoom}`;
      for (const key of ['x', 'y', 'w', 'h'] as const) {
        expect(Math.abs(step.got[key] - step.want[key]), `${label} ${key}`).toBeLessThanOrEqual(2);
        expect(
          Math.abs(step.pageInClient[key] - step.want[key]),
          `${label} bounds ${key}`,
        ).toBeLessThanOrEqual(2);
      }
      if (step.step !== 'rotated') expect(step.paths, label).toBe(step.rows);
    }
  });

test('a mark does not get in the way of its target and leaves with it', async ({ page }) => {
  await ready(page);
  const box = await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    board.apply([
      {
        op: 'add',
        item: {
          id: 'notes',
          kind: 'rect',
          x: 120,
          y: 100,
          w: 300,
          h: 160,
          text: 'Exactly 1 trial run first',
        },
      },
      { op: 'add', item: { id: 'hl', kind: 'mark', target: 'notes', match: 'trial run' } },
      {
        op: 'add',
        item: { id: 'ring', kind: 'mark', target: 'notes', match: 'Exactly', mark: 'circle' },
      },
    ]);
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const path = board.stage.world.querySelector('[data-ad-id="hl"] path')!.getBoundingClientRect();
    return {
      hl: { x: path.left + path.width / 2, y: path.top + path.height / 2 },
      menu: getComputedStyle(board.stage.world.querySelector('[data-ad-id="hl"]')!).pointerEvents,
    };
  });
  expect(box.menu).toBe('none');
  // Clicking on a highlighted phrase selects and drags the target.
  await page.mouse.move(box.hl.x, box.hl.y);
  await page.mouse.down();
  await page.mouse.move(box.hl.x + 40, box.hl.y + 30, { steps: 4 });
  await page.mouse.up();
  const moved = await page.evaluate(() => {
    const board = window.__anniedrawing![0];
    return { selection: board.selection, notes: board.get('notes'), hl: board.get('hl') };
  });
  expect(moved.selection).toEqual(['notes']);
  expect([moved.notes!.x, moved.notes!.y]).toEqual([160, 130]);
  expect([moved.hl!.x, moved.hl!.y]).toEqual([0, 0]);
  // Double-clicking the phrase edits the target's text.
  await page.mouse.dblclick(box.hl.x + 40, box.hl.y + 30);
  const editing = await page.evaluate(
    () => document.activeElement?.closest('[data-ad-id]')?.getAttribute('data-ad-id') ?? null,
  );
  expect(editing).toBe('notes');
  await page.keyboard.press('Escape');
  // The circle's stroke selects the circle; Delete removes only that mark.
  const ring = await page.evaluate(() => {
    const path = window.__anniedrawing![0].stage.world.querySelector<SVGPathElement>(
      '[data-ad-id="ring"] path',
    )!;
    const p = path.getPointAtLength(path.getTotalLength() * 0.3);
    const at = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!);
    return { x: at.x, y: at.y };
  });
  await page.mouse.click(ring.x, ring.y);
  expect(await page.evaluate(() => window.__anniedrawing![0].selection)).toEqual(['ring']);
  await page.keyboard.press('Delete');
  const afterRing = await page.evaluate(() =>
    window.__anniedrawing![0].items.map((item) => item.id),
  );
  expect(afterRing).toEqual(['notes', 'hl']);
  // Deleting the target takes its marks; one undo brings both back.
  await page.evaluate(() => window.__anniedrawing![0].select(['notes']));
  await page.keyboard.press('Delete');
  expect(await page.evaluate(() => window.__anniedrawing![0].items.map((item) => item.id))).toEqual(
    [],
  );
  await page.evaluate(() => window.__anniedrawing![0].undo());
  expect(await page.evaluate(() => window.__anniedrawing![0].items.map((item) => item.id))).toEqual(
    ['notes', 'hl'],
  );
});

test('an agent mark arrives on its target, fits nothing extra, and exports', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    board.apply([
      {
        op: 'add',
        item: {
          id: 'notes',
          kind: 'rect',
          x: 100,
          y: 100,
          w: 260,
          h: 140,
          text: 'Exactly 1 trial run first',
        },
      },
    ]);
    board.view.fit();
    const before = board.boundsOf();
    const presented = new Promise<string[]>((done) =>
      board.on('presented', (event) => done(event.ids)),
    );
    let landed: string | undefined;
    const watch = () => {
      landed ??=
        board.stage.root.querySelector<HTMLElement>('.annie-agent-cursor')?.dataset.adLanded;
      if (!landed) requestAnimationFrame(watch);
    };
    watch();
    const applied = board.apply(
      [
        {
          op: 'add',
          item: {
            id: 'ring',
            kind: 'mark',
            target: 'notes',
            mark: 'circle',
            style: { stroke: 'coral' },
          },
        },
      ],
      { origin: 'agent:fellow', reveal: 'none' },
    );
    const element = board.stage.world.querySelector<HTMLElement>('[data-ad-id="ring"]')!;
    const pending = element.classList.contains('annie-agent-pending');
    const ids = await presented;
    const [lx, ly] = (landed ?? 'NaN,NaN').split(',').map(Number);
    const target = board.stage.lens.toScreen({ x: 100, y: 100 }),
      zoom = board.stage.lens.zoom;
    const onTarget =
      lx >= target.x &&
      lx <= target.x + 260 * zoom &&
      ly >= target.y &&
      ly <= target.y + 140 * zoom;
    const after = board.boundsOf();
    const ring = board.boundsOf(['ring']);
    const svg = (await board.export('svg')) as string;
    const png = (await board.export('png')) as Blob;
    return {
      ok: applied.ok,
      warnings: applied.warnings,
      pending,
      ids,
      onTarget,
      before,
      after,
      ring,
      svg: svg.includes('data-ad-kind="mark"'),
      png: png.size,
      visible: getComputedStyle(element).visibility,
    };
  });
  expect(result.ok).toBe(true);
  expect(result.warnings).toEqual([]);
  expect(result.ids).toEqual(['ring']);
  expect(result.pending).toBe(true);
  expect(result.onTarget).toBe(true);
  expect(result.visible).toBe('visible');
  expect(result.after).toEqual(result.before);
  expect(result.ring.w).toBeGreaterThan(result.before.w);
  expect(result.svg).toBe(true);
  expect(result.png).toBeGreaterThan(1000);
});

test('a highlight on a filled node is a halo around it and leaves its fill and label alone', async ({
  page,
}) => {
  await ready(page);
  const seen = await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    const frame = () => new Promise((done) => requestAnimationFrame(() => done(undefined)));
    board.apply([
      {
        op: 'add',
        item: {
          id: 'step',
          kind: 'rect',
          x: 120,
          y: 100,
          w: 240,
          h: 110,
          text: 'Step one',
          style: { fill: 'teal', fillMode: 'tint' },
        },
      },
    ]);
    await frame();
    await frame();
    const node = document.querySelector('[data-ad-id="step"]')!;
    const look = () => ({
      fill: getComputedStyle(node.querySelector('path')!).fill,
      opacity: getComputedStyle(node.querySelector('path')!).fillOpacity,
      label: getComputedStyle(node.querySelector('.annie-text')!).color,
    });
    const before = look();
    board.apply([
      { op: 'add', item: { id: 'm', kind: 'mark', target: 'step', style: { stroke: '#d35400' } } },
    ]);
    await frame();
    await frame();
    const path = document.querySelector('[data-ad-id="m"] path')!;
    const box = path.getBoundingClientRect(),
      own = node.getBoundingClientRect();
    const png = (await board.export('png', { scope: 'page' })) as Blob;
    return {
      before,
      after: look(),
      paths: document.querySelectorAll('[data-ad-id="m"] path').length,
      fill: path.getAttribute('fill'),
      width: path.getAttribute('stroke-width'),
      // The band's center line sits 6 px outside the node on every side.
      around: [
        own.left - box.left,
        own.top - box.top,
        box.right - own.right,
        box.bottom - own.bottom,
      ],
      bounds: board.boundsOf(['m']),
      png: [png.type, png.size > 500],
    };
  });
  expect(seen.after).toEqual(seen.before);
  expect(seen.paths).toBe(1);
  expect(seen.fill).toBe('none');
  expect(seen.width).toBe('8');
  for (const gap of seen.around) expect(gap).toBeGreaterThanOrEqual(1.5);
  expect(seen.bounds).toEqual({ x: 110, y: 90, w: 260, h: 130 });
  expect(seen.png).toEqual(['image/png', true]);
});
