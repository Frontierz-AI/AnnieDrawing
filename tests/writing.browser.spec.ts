import { expect, test, type Page } from '@playwright/test';

/** A board with written arrivals, a presented log, and a per-frame sampler of every label. */
async function mount(page: Page, presence: Record<string, unknown> = { write: true }) {
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto('/?blank');
  await page.waitForFunction(() => !!window.__anniedrawing?.[0]);
  await page.evaluate(async (presence) => {
    for (const board of [...(window.__anniedrawing ?? [])]) board.destroy();
    document.body.innerHTML = '<main id="writing-fixture" style="position:fixed;inset:0"></main>';
    const { createBoard } = await import('/src/index.ts' as string);
    const board = createBoard(document.querySelector('#writing-fixture')!, {
      agentPresence: presence,
      agentReveal: 'none',
      exposeGlobal: true,
    });
    await board.ready;
    board.stage.lens.set({ x: 0, y: 0, zoom: 1 });
    const state = window as unknown as WritingWindow;
    state.presented = [];
    state.samples = [];
    board.on('presented', (event: { ids: string[] }) =>
      state.presented.push({ ids: event.ids, t: performance.now() }),
    );
  }, presence);
}

interface Sample {
  t: number;
  id: string;
  clip: string;
  value: string;
  size: string;
  transform: string;
  visible: boolean;
  pen: boolean;
}
interface WritingWindow {
  presented: { ids: string[]; t: number }[];
  samples: Sample[];
  sampling: boolean;
  started: number;
}

/** Sample every frame until stopped. */
async function sample(page: Page) {
  await page.evaluate(() => {
    const state = window as unknown as WritingWindow;
    state.samples = [];
    state.sampling = true;
    const loop = () => {
      const t = performance.now();
      for (const element of document.querySelectorAll<HTMLElement>('.annie-item[data-ad-id]')) {
        const text = element.querySelector<HTMLElement>(':scope > .annie-text')!;
        state.samples.push({
          t,
          id: element.dataset.adId!,
          clip: text.style.clipPath,
          value: text.textContent ?? '',
          size: `${text.offsetWidth}x${text.offsetHeight}`,
          transform: element.style.transform,
          visible: getComputedStyle(element).visibility === 'visible',
          pen: !!document.querySelector('.annie-agent-writing .annie-pen'),
        });
      }
      if (state.sampling) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

async function samples(page: Page) {
  return page.evaluate(() => {
    const state = window as unknown as WritingWindow;
    state.sampling = false;
    return state.samples;
  });
}

const presented = (page: Page) =>
  page.evaluate(() => (window as unknown as WritingWindow).presented);

async function finished(page: Page) {
  await expect(page.locator('.annie-agent-cursor, .annie-agent-pending')).toHaveCount(0, {
    timeout: 15000,
  });
}

/** Line boxes `[left, right, top, bottom]` of a label, in its own unscaled coordinates. */
function lines(page: Page, id: string) {
  return page.evaluate((id) => {
    const text = document.querySelector(`[data-ad-id="${id}"] > .annie-text`)!;
    const box = text.getBoundingClientRect();
    const zoom = box.width / (text as HTMLElement).offsetWidth;
    const result: number[][] = [];
    const walk = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    while (walk.nextNode()) {
      range.selectNodeContents(walk.currentNode);
      for (const rect of range.getClientRects()) {
        if (!rect.width) continue;
        const l = (rect.left - box.left) / zoom;
        const r = (rect.right - box.left) / zoom;
        const t = (rect.top - box.top) / zoom;
        const b = (rect.bottom - box.top) / zoom;
        const last = result[result.length - 1];
        if (last && (t + b) / 2 > last[2] && (t + b) / 2 < last[3]) {
          last[0] = Math.min(last[0], l);
          last[1] = Math.max(last[1], r);
        } else result.push([l, r, t, b]);
      }
    }
    return result;
  }, id);
}

/** The clip polygon's current line top and reveal edge. */
function edge(clip: string) {
  const numbers = clip.match(/-?\d+(\.\d+)?(e-?\d+)?/g)!.map(Number);
  return { top: numbers[5], x: numbers[6] };
}

/** Share of the label's line length that a clip reveals. */
function revealed(clip: string, boxes: number[][]) {
  if (!clip) return 1;
  const { top, x } = edge(clip);
  const total = boxes.reduce((sum, [l, r]) => sum + r - l, 0);
  let shown = 0;
  for (const [l, r, t] of boxes) {
    if (t < top - 0.5) shown += r - l;
    else if (Math.abs(t - top) <= 0.5) shown += Math.max(0, Math.min(r, x) - l);
  }
  return shown / total;
}

/** First and last frame in which a label carries a writing clip, and the frame it ends. */
function span(list: Sample[], id: string) {
  const own = list.filter((entry) => entry.id === id);
  const first = own.findIndex((entry) => entry.clip);
  const last = own.length - 1 - [...own].reverse().findIndex((entry) => entry.clip);
  if (first < 0) return { own, start: NaN, end: NaN, clipped: [] };
  return {
    own,
    start: own[first].t,
    end: own[last + 1]?.t ?? NaN,
    clipped: own.slice(first, last + 1),
  };
}

const sixty = 'Progressive writing shows each word as the tutor says it now';

test('a 60-character text is written left to right and complete in the document from the first frame', async ({
  page,
}) => {
  expect(sixty).toHaveLength(60);
  await mount(page);
  await sample(page);
  const result = await page.evaluate((value) => {
    const board = window.__anniedrawing![0];
    const result = board.apply(
      [{ op: 'add', item: { id: 'line', kind: 'text', x: 200, y: 200, text: { value } } }],
      { origin: 'agent:tutor', agentName: 'Tutor' },
    );
    const text = document.querySelector('[data-ad-id="line"] > .annie-text')!;
    return { ok: result.ok, stored: board.get('line')?.text?.value, dom: text.textContent };
  }, sixty);
  expect(result).toEqual({ ok: true, stored: sixty, dom: sixty });
  await expect(page.locator('.annie-agent-writing .annie-pen')).toBeVisible();
  await expect(page.locator('.annie-agent-cursor span')).toHaveText('Tutor');
  await finished(page);
  const list = await samples(page);
  const boxes = await lines(page, 'line');
  const { own, start, end, clipped } = span(list, 'line');
  expect(start).not.toBeNaN();
  expect(end).not.toBeNaN();
  // Default speed: 60 characters at 30 per second.
  expect(end - start).toBeGreaterThan(1600);
  expect(end - start).toBeLessThan(2600);
  // Every frame holds the whole text with the same layout; only the clip changes.
  expect(new Set(own.map((entry) => entry.value))).toEqual(new Set([sixty]));
  expect(new Set(own.map((entry) => entry.size)).size).toBe(1);
  // Hidden while pending, clipped (never faded or scaled) once visible.
  for (const entry of own.filter((entry) => entry.visible && entry.t < end))
    expect(entry.clip).not.toBe('');
  expect(own.some((entry) => /scale/.test(entry.transform))).toBe(false);
  const middle = clipped.reduce((best, entry) =>
    Math.abs(entry.t - (start + end) / 2) < Math.abs(best.t - (start + end) / 2) ? entry : best,
  );
  const half = revealed(middle.clip, boxes);
  test.info().annotations.push({
    type: 'measured',
    description: `write ${Math.round(end - start)} ms, revealed at half time ${half.toFixed(2)}`,
  });
  expect(half).toBeGreaterThan(0.25);
  expect(half).toBeLessThan(0.75);
  expect(middle.pen).toBe(true);
  const fractions = clipped.map((entry) => revealed(entry.clip, boxes));
  for (let index = 1; index < fractions.length; index++)
    expect(fractions[index]).toBeGreaterThanOrEqual(fractions[index - 1] - 1e-6);
  const after = await page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('[data-ad-id="line"]')!;
    const text = element.querySelector<HTMLElement>(':scope > .annie-text')!;
    return {
      clip: text.style.clipPath,
      computed: getComputedStyle(text).clipPath,
      transform: element.style.transform,
      opacity: element.style.opacity,
    };
  });
  expect(after.clip).toBe('');
  expect(after.computed).toBe('none');
  expect(after.transform).not.toContain('scale');
  expect(after.opacity).toBe('1');
  const events = await presented(page);
  expect(events).toHaveLength(1);
  expect(events[0].t).toBeGreaterThanOrEqual(end - 40);
});

test('multi-line plain and md labels are revealed line by line in order', async ({ page }) => {
  await mount(page, { write: { charsPerSecond: 60 } });
  await sample(page);
  await page.evaluate(() =>
    window.__anniedrawing![0].apply(
      [
        {
          op: 'add',
          item: {
            id: 'plain',
            kind: 'text',
            x: 120,
            y: 80,
            text: { value: 'First line\nSecond line\nThird line' },
          },
        },
        {
          op: 'add',
          item: {
            id: 'md',
            kind: 'text',
            x: 120,
            y: 320,
            text: { value: '# Heading\n- one bullet\n- two **bold**', format: 'md' },
          },
        },
      ],
      { origin: 'agent:tutor' },
    ),
  );
  await finished(page);
  const list = await samples(page);
  for (const id of ['plain', 'md']) {
    const boxes = await lines(page, id);
    expect(boxes).toHaveLength(3);
    const { clipped } = span(list, id);
    const tops = clipped.map((entry) => edge(entry.clip).top);
    // The current line only moves down, through every line.
    for (let index = 1; index < tops.length; index++)
      expect(tops[index]).toBeGreaterThanOrEqual(tops[index - 1]);
    for (const [, , top] of boxes)
      expect(
        tops.some((value) => Math.abs(value - top) < 1),
        `${id} ${JSON.stringify(boxes)} ${JSON.stringify([...new Set(tops)])}`,
      ).toBe(true);
    // Within one line the reveal edge only moves right.
    for (let index = 1; index < clipped.length; index++) {
      const before = edge(clipped[index - 1].clip);
      const now = edge(clipped[index].clip);
      if (before.top === now.top) expect(now.x).toBeGreaterThanOrEqual(before.x - 1e-6);
    }
  }
  // The second item starts after the first one ends.
  expect(span(list, 'md').start).toBeGreaterThanOrEqual(span(list, 'plain').end);
  expect(await presented(page)).toHaveLength(1);
});

test('a batch duration ends at the presented event and shares time by text length', async ({
  page,
}) => {
  await mount(page);
  // A first written batch pays for font loading and first paints, so the measured one does not.
  await page.evaluate(() => {
    window.__anniedrawing![0].apply(
      [{ op: 'add', item: { id: 'warm', kind: 'text', x: 120, y: 560, text: 'Warm up.' } }],
      { origin: 'agent:tutor', presentation: { durationMs: 300 } },
    );
  });
  await finished(page);
  await page.evaluate(() => {
    (window as unknown as WritingWindow).presented = [];
  });
  await sample(page);
  const values = ['Short one.', 'A medium sentence, thirty char', `${sixty}`];
  const started = await page.evaluate((values) => {
    const board = window.__anniedrawing![0];
    const started = performance.now();
    board.apply(
      values.map((value, index) => ({
        op: 'add' as const,
        item: { id: `t${index}`, kind: 'text', x: 120, y: 80 + index * 140, text: { value } },
      })),
      { origin: 'agent:tutor', presentation: { durationMs: 2000 } },
    );
    return started;
  }, values);
  await finished(page);
  const list = await samples(page);
  const events = await presented(page);
  expect(events).toHaveLength(1);
  const total = events[0].t - started;
  test.info().annotations.push({ type: 'measured', description: `presented after ${total} ms` });
  expect(total).toBeGreaterThan(1850);
  expect(total).toBeLessThan(2250);
  const ends = ['t0', 't1', 't2'].map((id) => span(list, id).end);
  expect(events[0].t).toBeGreaterThanOrEqual(ends[2] - 40);
  // Each item's share of the batch runs from the previous item's end to its own end.
  const shares = [ends[0] - started, ends[1] - ends[0], ends[2] - ends[1]];
  const lengths = values.map((value) => value.length);
  // Twice the text takes about twice the time. This holds when frames run late, because a stop
  // that overruns leaves less time for the rest and they still split it by length.
  expect(shares[2] / shares[1]).toBeGreaterThan(1.4);
  expect(shares[2] / shares[1]).toBeLessThan(2.8);
  // Exact shares need frames on time. A shared CI runner spent 450 ms extra in the first stop,
  // and the batch still ended on its deadline.
  if (!process.env.CI)
    for (const index of [0, 1, 2]) {
      const expected = (2000 * lengths[index]) / (lengths[0] + lengths[1] + lengths[2]);
      expect(Math.abs(shares[index] - expected)).toBeLessThan(Math.max(90, expected * 0.2));
    }
});

test('a labeled shape fades in first and then its label is written; connectors keep the fade', async ({
  page,
}) => {
  await mount(page, { write: { charsPerSecond: 40 } });
  await sample(page);
  await page.evaluate(() =>
    window.__anniedrawing![0].apply(
      [
        {
          op: 'add',
          item: { id: 'box', kind: 'rect', x: 140, y: 140, w: 220, h: 110, text: 'Write me' },
        },
        { op: 'add', item: { id: 'plainbox', kind: 'ellipse', x: 600, y: 140, w: 120, h: 90 } },
        {
          op: 'add',
          item: {
            id: 'link',
            kind: 'arrow',
            from: 'box',
            to: 'plainbox',
            text: { value: 'leads to' },
          },
        },
      ],
      { origin: 'agent:tutor' },
    ),
  );
  await finished(page);
  const list = await samples(page);
  const box = span(list, 'box');
  const fading = box.own.filter((entry) => entry.visible && /scale/.test(entry.transform));
  expect(fading.length).toBeGreaterThan(0);
  const boxes = await lines(page, 'box');
  // While the box fades, its label is clipped to nothing.
  for (const entry of fading) expect(revealed(entry.clip, boxes)).toBeCloseTo(0, 3);
  expect(box.clipped.some((entry) => revealed(entry.clip, boxes) > 0.3)).toBe(true);
  expect(span(list, 'link').clipped).toHaveLength(0);
  expect(span(list, 'plainbox').clipped).toHaveLength(0);
  expect(list.some((entry) => entry.id === 'link' && /scale/.test(entry.transform))).toBe(false);
  expect(await presented(page)).toHaveLength(1);
});

test('reduced motion shows the whole text at once and presents immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(page);
  const result = await page.evaluate(async () => {
    const board = window.__anniedrawing![0];
    board.apply([{ op: 'add', item: { id: 'quick', kind: 'text', x: 100, y: 100, text: 'Hi' } }], {
      origin: 'agent:tutor',
      presentation: { durationMs: 4000 },
    });
    await Promise.resolve();
    const element = document.querySelector<HTMLElement>('[data-ad-id="quick"]')!;
    return {
      presented: (window as unknown as WritingWindow).presented.length,
      visible: getComputedStyle(element).visibility,
      clip: element.querySelector<HTMLElement>('.annie-text')!.style.clipPath,
      cursor: document.querySelectorAll('.annie-agent-cursor').length,
    };
  });
  expect(result).toEqual({ presented: 1, visible: 'visible', clip: '', cursor: 0 });
});

test('a hidden tab finishes the writing at once', async ({ page }) => {
  await mount(page);
  await page.evaluate((value) => {
    window.__anniedrawing![0].apply(
      [{ op: 'add', item: { id: 'hide', kind: 'text', x: 100, y: 100, text: value } }],
      { origin: 'agent:tutor' },
    );
  }, sixty);
  await page.waitForFunction(
    () =>
      !!document.querySelector<HTMLElement>('[data-ad-id="hide"] > .annie-text')?.style.clipPath,
  );
  const result = await page.evaluate(async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    const element = document.querySelector<HTMLElement>('[data-ad-id="hide"]')!;
    return {
      presented: (window as unknown as WritingWindow).presented.length,
      clip: element.querySelector<HTMLElement>('.annie-text')!.style.clipPath,
      cursor: document.querySelectorAll('.annie-agent-cursor').length,
    };
  });
  expect(result).toEqual({ presented: 1, clip: '', cursor: 0 });
});

test('patching, moving or removing the item being written ends its writing on the current state', async ({
  page,
}) => {
  await mount(page);
  for (const change of ['text', 'move', 'remove', 'edit'] as const) {
    await page.evaluate(() => {
      const board = window.__anniedrawing![0];
      board.clear();
      (window as unknown as WritingWindow).presented = [];
    });
    await page.evaluate((value) => {
      window.__anniedrawing![0].apply(
        [
          { op: 'add', item: { id: 'a', kind: 'text', x: 100, y: 100, text: value } },
          { op: 'add', item: { id: 'b', kind: 'text', x: 100, y: 300, text: 'Next one' } },
        ],
        { origin: 'agent:tutor' },
      );
    }, sixty);
    await page.waitForFunction(
      () =>
        !!document
          .querySelector<HTMLElement>('[data-ad-id="a"] > .annie-text')
          ?.style.clipPath.includes('polygon'),
    );
    await page.waitForTimeout(300);
    const state = await page.evaluate((change) => {
      const board = window.__anniedrawing![0];
      if (change === 'text')
        board.apply([{ op: 'set', id: 'a', patch: { text: { value: 'Changed' } } }]);
      if (change === 'move') board.apply([{ op: 'set', id: 'a', patch: { x: 140 } }]);
      if (change === 'remove') board.apply([{ op: 'remove', id: 'a' }]);
      if (change === 'edit') board.editText('a');
      return new Promise<{ clip?: string; value?: string; editing: boolean }>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const text = document.querySelector<HTMLElement>('[data-ad-id="a"] > .annie-text');
            resolve({
              clip: text?.style.clipPath,
              value: text?.textContent ?? undefined,
              editing: !!text?.isContentEditable,
            });
          }),
        ),
      );
    }, change);
    if (change === 'remove') expect(state.clip).toBeUndefined();
    else expect(state.clip).toBe('');
    if (change === 'text') expect(state.value).toBe('Changed');
    if (change === 'edit') {
      expect(state.editing).toBe(true);
      await page.keyboard.press('Escape');
    }
    // The walk goes on to the next item and the batch is presented once.
    await finished(page);
    expect(
      await page.evaluate(
        () => document.querySelector<HTMLElement>('[data-ad-id="b"] > .annie-text')!.style.clipPath,
      ),
    ).toBe('');
    await page.waitForTimeout(100);
    expect(await presented(page), change).toHaveLength(1);
  }
});

test('destroy during writing leaves no frames running and no clip behind', async ({ page }) => {
  await page.addInitScript(() => {
    const live = new Set<number>();
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      const id = request((time) => {
        live.delete(id);
        callback(time);
      });
      live.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      live.delete(id);
      cancel(id);
    };
    (window as unknown as { liveFrames: Set<number> }).liveFrames = live;
  });
  await mount(page);
  await page.evaluate((value) => {
    window.__anniedrawing![0].apply(
      [{ op: 'add', item: { id: 'gone', kind: 'text', x: 100, y: 100, text: value } }],
      { origin: 'agent:tutor' },
    );
  }, sixty);
  await page.waitForFunction(
    () =>
      !!document.querySelector<HTMLElement>('[data-ad-id="gone"] > .annie-text')?.style.clipPath,
  );
  const result = await page.evaluate(async () => {
    const text = document.querySelector<HTMLElement>('[data-ad-id="gone"] > .annie-text')!;
    window.__anniedrawing![0].destroy();
    await new Promise((resolve) => setTimeout(resolve, 150));
    return {
      frames: (window as unknown as { liveFrames: Set<number> }).liveFrames.size,
      clip: text.style.clipPath,
      cursor: document.querySelectorAll('.annie-agent-cursor').length,
    };
  });
  expect(result).toEqual({ frames: 0, clip: '', cursor: 0 });
});

test('without write, a batch duration scales the arrival', async ({ page }) => {
  await mount(page, {});
  const started = await page.evaluate(() => {
    const started = performance.now();
    window.__anniedrawing![0].apply(
      [
        { op: 'add', item: { id: 'r1', kind: 'rect', x: 100, y: 100, w: 120, h: 80, text: 'A' } },
        { op: 'add', item: { id: 'r2', kind: 'rect', x: 500, y: 300, w: 120, h: 80, text: 'B' } },
      ],
      { origin: 'agent:tutor', presentation: { durationMs: 2500 } },
    );
    return started;
  });
  await finished(page);
  await page.waitForTimeout(100);
  const events = await presented(page);
  expect(events).toHaveLength(1);
  const total = events[0].t - started;
  test.info().annotations.push({ type: 'measured', description: `presented after ${total} ms` });
  expect(total).toBeGreaterThan(2350);
  expect(total).toBeLessThan(2750);
});

test('write stays off by default, so labels fade as before', async ({ page }) => {
  await mount(page, {});
  await sample(page);
  await page.evaluate(() =>
    window.__anniedrawing![0].apply(
      [{ op: 'add', item: { id: 'plain', kind: 'text', x: 100, y: 100, text: 'Fades in' } }],
      { origin: 'agent:tutor' },
    ),
  );
  await finished(page);
  const list = await samples(page);
  expect(span(list, 'plain').clipped).toHaveLength(0);
  expect(list.some((entry) => entry.id === 'plain' && /scale/.test(entry.transform))).toBe(true);
  expect(list.some((entry) => entry.pen)).toBe(false);
});
