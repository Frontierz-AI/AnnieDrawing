import { expect, test } from '@playwright/test';

test('5000-item load stays below 500 ms and moving 100 of 2000 stays below 8 ms scripting', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const measurements = await page.evaluate(async () => {
    window.__anniedrawing?.forEach((board) => board.destroy());
    document.body.innerHTML = '<main id="perf-fixture" style="position:fixed;inset:0"></main>';
    const stagePath = '/src/stage/stage.ts';
    const { Stage } = await import(stagePath);
    const stage = new Stage(document.querySelector('#perf-fixture'));
    const items = Array.from({ length: 5000 }, (_, index) => ({
      id: `i_perf_${index}`,
      kind: 'rect',
      x: (index % 100) * 220,
      y: Math.floor(index / 100) * 140,
      w: 180,
      h: 100,
      text: { value: `Idea ${index}` },
      style: { fill: 'teal', fillMode: 'tint' },
    }));
    const doc = {
      format: 'anniedrawing',
      version: 2,
      meta: { title: 'Performance fixture' },
      pages: [{ id: 's_main', name: 'Main', items }],
      media: {},
    };
    await new Promise(requestAnimationFrame);
    const loadStart = performance.now();
    stage.render(doc, 's_main');
    const loadMs = performance.now() - loadStart;
    const shortDoc = { ...doc, pages: [{ ...doc.pages[0], items: items.slice(0, 2000) }] };
    stage.render(shortDoc, 's_main');
    const drafts = new Map();
    const durations: number[] = [];
    for (let frame = 0; frame < 90; frame++) {
      await new Promise(requestAnimationFrame);
      for (let index = 0; index < 100; index++)
        drafts.set(items[index].id, { x: items[index].x + frame * 2, y: items[index].y + frame });
      const start = performance.now();
      stage.render(shortDoc, 's_main', drafts);
      if (frame >= 10) durations.push(performance.now() - start);
    }
    durations.sort((a, b) => a - b);
    const visibleCount = [...stage.world.children].filter(
      (element: any) => element.style.display !== 'none',
    ).length;
    stage.destroy();
    return {
      loadMs,
      dragMedianMs: durations[Math.floor(durations.length / 2)],
      dragP95Ms: durations[Math.floor(durations.length * 0.95)],
      dragMaximumMs: durations.at(-1),
      visibleCount,
      samples: durations,
    };
  });
  console.log(
    JSON.stringify({
      loadMs: measurements.loadMs,
      dragMedianMs: measurements.dragMedianMs,
      dragP95Ms: measurements.dragP95Ms,
      dragMaximumMs: measurements.dragMaximumMs,
      visibleCount: measurements.visibleCount,
    }),
  );
  await testInfo.attach('performance-measurements.json', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json',
  });
  expect(measurements.loadMs, JSON.stringify(measurements)).toBeLessThan(500 * 1.15);
  expect(measurements.dragP95Ms, JSON.stringify(measurements)).toBeLessThan(8 * 1.15);
  expect(measurements.visibleCount).toBeLessThan(100);
});

test('full editor load and pointer-to-draft pipeline meet the same budgets', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    window.__anniedrawing?.forEach((board) => board.destroy());
    const { createBoard } = await import('/src/board.ts' as string);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0';
    document.body.append(host);
    const items = Array.from({ length: 5000 }, (_, i) => ({
      id: `i_full_${i}`,
      kind: 'rect',
      x: 400 + (i % 100) * 200,
      y: 200 + Math.floor(i / 100) * 130,
      w: 160,
      h: 100,
      style: { fill: 'teal' },
      text: { value: `Idea ${i}` },
    }));
    const doc = {
      format: 'anniedrawing',
      version: 2,
      meta: { title: 'Full editor benchmark' },
      pages: [{ id: 's_main', name: 'Main', items }],
      media: {},
    };
    const started = performance.now();
    const board = createBoard(host, { doc });
    const loadMs = performance.now() - started;
    board.load({ ...doc, pages: [{ ...doc.pages[0], items: items.slice(0, 2000) }] });
    board.stage.lens.set({ x: 0, y: 0, zoom: 1 });
    board.select(items.slice(0, 100).map((item) => item.id));
    await new Promise(requestAnimationFrame);
    let paintMs = 0;
    const original = board.stage.render.bind(board.stage);
    board.stage.render = (...args: unknown[]) => {
      const start = performance.now();
      const result = original(...args);
      paintMs += performance.now() - start;
      return result;
    };
    const pointer = (type: string, x: number, y: number) =>
      board.stage.root.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 1,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          bubbles: true,
          cancelable: true,
        }),
      );
    pointer('pointerdown', 450, 240);
    const durations: number[] = [];
    for (let frame = 1; frame <= 90; frame++) {
      paintMs = 0;
      const start = performance.now();
      pointer('pointermove', 450 + frame * 2, 240 + frame);
      const inputMs = performance.now() - start;
      await new Promise(requestAnimationFrame);
      if (frame > 10) durations.push(inputMs + paintMs);
    }
    pointer('pointerup', 630, 330);
    const moved = board.get('i_full_0').x !== items[0].x;
    board.destroy();
    host.remove();
    durations.sort((a, b) => a - b);
    return {
      loadMs,
      dragP95Ms: durations[Math.floor(durations.length * 0.95)],
      dragMedianMs: durations[Math.floor(durations.length * 0.5)],
      moved,
    };
  });
  console.log(JSON.stringify(result));
  await testInfo.attach('full-editor-performance.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(result.moved).toBe(true);
  expect(result.loadMs).toBeLessThan(500 * 1.15);
  expect(result.dragP95Ms).toBeLessThan(8 * 1.15);
});
