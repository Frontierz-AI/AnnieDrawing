import { expect, test } from '@playwright/test';
import { fanInOut, insertBetween, loopBack } from './routing-fixtures';

type Box = { x: number; y: number; w: number; h: number };
const overlaps = (p: Box, q: Box) =>
  p.x < q.x + q.w - 0.5 && q.x < p.x + p.w - 0.5 && p.y < q.y + q.h - 0.5 && q.y < p.y + p.h - 0.5;

const cases = [
  { name: 'fan-in and fan-out (10)', items: fanInOut(), labeled: ['e5', 'e6'] },
  { name: 'loop back (03)', items: loopBack(), labeled: ['a4', 'a5'] },
  { name: 'insert between (07)', items: insertBetween(), labeled: ['xb', 'xa'] },
];

for (const { name, items, labeled: expected } of cases)
  test(`rendered labels of ${name} avoid nodes, labels, and other connectors, and match SVG export`, async ({
    page,
  }) => {
    await page.goto('/?blank');
    await page.waitForFunction(() => !!window.__anniedrawing?.length);
    const measured = await page.evaluate(async (items) => {
      const { createBoard } = await import('/src/board.ts' as string);
      const { exportSVG } = await import('/src/porter/svg.ts' as string);
      const { routePage } = await import('/src/geo/index.ts' as string);
      window.__anniedrawing![0].destroy();
      const board = createBoard(document.getElementById('app')!, {
        agentPresence: false,
        ui: false,
        exposeGlobal: true,
      });
      await board.ready;
      board.apply(
        items.map((item: unknown) => ({ op: 'add', item })),
        { origin: 'user' },
      );
      board.stage.lens.set({ x: 40, y: 80, zoom: 0.75 });
      await new Promise(requestAnimationFrame);
      const root = board.stage.root.getBoundingClientRect(),
        { x, y, zoom } = board.stage.lens.state;
      const toPage = (rect: DOMRect) => ({
        x: (rect.left - root.left - x) / zoom,
        y: (rect.top - root.top - y) / zoom,
        w: rect.width / zoom,
        h: rect.height / zoom,
      });
      const element = (id: string) => board.stage.world.querySelector(`[data-ad-id="${id}"]`)!;
      const nodes = board.items
        .filter((item: { kind: string }) => item.kind !== 'connector')
        .map((item: { id: string }) => ({
          id: item.id,
          box: toPage(element(item.id).querySelector('.annie-shape')!.getBoundingClientRect()),
        }));
      const connectors = board.items
        .filter((item: { kind: string }) => item.kind === 'connector')
        .map((item: { id: string; text?: { value: string } }) => {
          const d = element(item.id).querySelector('path')!.getAttribute('d')!;
          const numbers = d.match(/-?[\d.]+/g)!.map(Number);
          const points = [];
          for (let i = 0; i < numbers.length; i += 2)
            points.push({ x: numbers[i], y: numbers[i + 1] });
          const text = element(item.id).querySelector('.annie-text') as HTMLElement;
          return {
            id: item.id,
            points,
            label: item.text ? toPage(text.getBoundingClientRect()) : undefined,
          };
        });
      const svg = exportSVG(board.read(), board.items);
      const exported = Object.fromEntries(
        connectors
          .filter((connector: { label?: unknown }) => connector.label)
          .map((connector: { id: string }) => {
            const group = svg.slice(svg.indexOf(`data-ad-id="${connector.id}"`));
            const rect = /<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/
              .exec(group.slice(group.indexOf('</title>')))!
              .slice(1)
              .map(Number);
            return [connector.id, { x: rect[0], y: rect[1], w: rect[2], h: rect[3] }];
          }),
      );
      const headless = Object.fromEntries(
        routePage(board.items).map((route: { id: string; label?: Box }) => [route.id, route.label]),
      );
      return {
        nodes: nodes as { id: string; box: Box }[],
        connectors: connectors as { id: string; points: { x: number; y: number }[]; label?: Box }[],
        exported: exported as Record<string, Box>,
        headless: headless as Record<string, Box | undefined>,
      };
    }, items);
    const labeled = measured.connectors.filter((connector) => connector.label);
    expect(labeled.map((connector) => connector.id)).toEqual(expected);
    for (const { id, label } of labeled) {
      const box = label!;
      for (const node of measured.nodes)
        expect(overlaps(box, node.box), `${id} label over ${node.id}`).toBe(false);
      for (const other of measured.connectors) {
        if (other.id === id) continue;
        if (other.label) expect(overlaps(box, other.label), `${id} over ${other.id}`).toBe(false);
        for (let i = 1; i < other.points.length; i++) {
          const a = other.points[i - 1],
            b = other.points[i];
          const segment = {
            x: Math.min(a.x, b.x),
            y: Math.min(a.y, b.y),
            w: Math.abs(a.x - b.x),
            h: Math.abs(a.y - b.y),
          };
          // A segment is a zero-width box; it may touch the label edge but not cross it.
          const crosses =
            segment.x + segment.w > box.x &&
            segment.x < box.x + box.w &&
            segment.y + segment.h > box.y &&
            segment.y < box.y + box.h;
          expect(crosses, `${id} label over ${other.id}`).toBe(false);
        }
      }
      // The rendered label is centered where the headless box is, and fits inside it, so it
      // wraps no more than the headless estimate ("No" once broke into two lines).
      const headless = measured.headless[id]!;
      expect(box.x + box.w / 2).toBeCloseTo(headless.x + headless.w / 2, 0);
      expect(box.y + box.h / 2).toBeCloseTo(headless.y + headless.h / 2, 0);
      expect(box.w).toBeLessThanOrEqual(headless.w + 1);
      expect(box.h).toBeLessThanOrEqual(headless.h + 1);
      expect(measured.exported[id]).toEqual(headless);
    }
  });
