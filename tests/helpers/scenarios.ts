/**
 * The agent diagram scenarios from the Founderz requests (appendix), written in the same notation,
 * and the measurements used to judge a layout: fit zoom, connector crossings, connectors through
 * nodes that are not their endpoints, and node overlaps. Routes come from `routeConnector`.
 */
import {
  createDoc,
  type ApplyResult,
  type Box,
  type DocModel,
  type Item,
  type Op,
} from '../../src/core';
import { boundsOf, flattenItems } from '../../src/geo/box';
import { routeConnector } from '../../src/geo/router';
import type { Point } from '../../src/core/types';

/** Options the Founderz host passes to the board, as far as the headless document reads them. */
export const FOUNDERZ = { agentPlaceGap: 120 } as const;
export const VIEWPORT = { w: 1280, h: 760 } as const;
export const FELLOW = { origin: 'agent:fellow' } as const;

/**
 * One op per line: `id:kind "label"` adds a node, `id: from > to "label"` adds an arrow (the label
 * is optional), and `remove id` removes an item.
 */
export function ops(...lines: string[]): Op[] {
  return lines.map((line): Op => {
    const node = /^(\w+):(\w+) "(.*)"$/.exec(line);
    if (node) return { op: 'add', item: { id: node[1], kind: node[2], text: { value: node[3] } } };
    const arrow = /^(\w+): (\w+) > (\w+)(?: "(.*)")?$/.exec(line);
    if (arrow)
      return {
        op: 'add',
        item: {
          id: arrow[1],
          kind: 'arrow',
          from: arrow[2],
          to: arrow[3],
          ...(arrow[4] ? { text: { value: arrow[4] } } : {}),
        },
      };
    const remove = /^remove (\w+)$/.exec(line);
    if (remove) return { op: 'remove', id: remove[1] };
    throw new Error(`Unknown scenario line: ${line}`);
  });
}

const each = (count: number, line: (index: number) => string) =>
  Array.from({ length: count }, (_, index) => line(index + 1));

export interface Scenario {
  id: string;
  name: string;
  batches: Op[][];
}

export const SCENARIOS: Scenario[] = [
  {
    id: '01',
    name: 'linear-5',
    batches: [
      ops(
        's1:rect "Research"',
        's2:rect "Draft"',
        's3:rect "Review"',
        's4:rect "Approve"',
        's5:rect "Publish"',
        'a1: s1 > s2',
        'a2: s2 > s3',
        'a3: s3 > s4',
        'a4: s4 > s5',
      ),
    ],
  },
  {
    id: '02',
    name: 'decision-rejoin',
    batches: [
      ops(
        'start:ellipse "Request arrives"',
        'check:diamond "Approved?"',
        'send:rect "Send to customer"',
        'revise:rect "Revise draft"',
        'done:ellipse "Done"',
        'a1: start > check',
        'a2: check > send "Yes"',
        'a3: check > revise "No"',
        'a4: send > done',
        'a5: revise > done',
      ),
    ],
  },
  {
    id: '03',
    name: 'loop-back',
    batches: [
      ops(
        'plan:rect "Plan"',
        'build:rect "Build"',
        'test:rect "Test"',
        'pass:diamond "Tests pass?"',
        'release:rect "Release"',
        'a1: plan > build',
        'a2: build > test',
        'a3: test > pass',
        'a4: pass > release "Yes"',
        'a5: pass > build "No"',
      ),
    ],
  },
  {
    id: '04',
    name: 'hub-6-spokes',
    batches: [
      ops(
        'hub:ellipse "Copilot Cowork"',
        'm1:rect "Inbox"',
        'm2:rect "Calendar"',
        'm3:rect "Meetings"',
        'm4:rect "Documents"',
        'm5:rect "Reports"',
        'm6:rect "Recurring tasks"',
        ...each(6, (i) => `a${i}: hub > m${i}`),
      ),
    ],
  },
  {
    id: '05',
    name: 'two-lanes-cross-links',
    batches: [
      ops(
        'a1:rect "Learner: pick a task"',
        'a2:rect "Learner: write prompt"',
        'a3:rect "Learner: review output"',
        'a4:rect "Learner: approve"',
        'b1:rect "Fellow: suggest ideas"',
        'b2:rect "Fellow: add guardrail"',
        'b3:rect "Fellow: hand off"',
        'l1: a1 > a2',
        'l2: a2 > a3',
        'l3: a3 > a4',
        'l4: b1 > b2',
        'l5: b2 > b3',
        'x1: b1 > a1',
        'x2: a2 > b2',
        'x3: b3 > a4',
      ),
    ],
  },
  {
    id: '06',
    name: 'append-second-batch',
    batches: [
      ops(
        's1:rect "Collect notes"',
        's2:rect "Summarize"',
        's3:rect "Share"',
        'a1: s1 > s2',
        'a2: s2 > s3',
      ),
      ops(
        't:text "Guardrails"',
        'g1:note "Show me before sending"',
        'g2:note "Do not change anything"',
        'g3:rect "Human approval"',
        'b1: s2 > g1',
        'b2: s2 > g2',
        'b3: g1 > g3',
        'b4: g2 > g3',
        'b5: g3 > s3',
      ),
    ],
  },
  {
    id: '07',
    name: 'insert-between',
    batches: [
      ops('a:rect "Draft"', 'b:rect "Send"', 'c:rect "Archive"', 'ab: a > b', 'bc: b > c'),
      ops('x:diamond "Reviewed?"', 'remove ab', 'ax: a > x', 'xb: x > b "Yes"', 'xa: x > a "No"'),
    ],
  },
  {
    id: '08',
    name: 'tree-3-levels',
    batches: [
      ops(
        'root:rect "Company"',
        'c1:rect "Sales"',
        'c2:rect "Product"',
        'c3:rect "Operations"',
        'g1:rect "Inbound"',
        'g2:rect "Outbound"',
        'g3:rect "Design"',
        'g4:rect "Engineering"',
        'g5:rect "Finance"',
        'g6:rect "Support"',
        'e1: root > c1',
        'e2: root > c2',
        'e3: root > c3',
        'e4: c1 > g1',
        'e5: c1 > g2',
        'e6: c2 > g3',
        'e7: c2 > g4',
        'e8: c3 > g5',
        'e9: c3 > g6',
      ),
    ],
  },
  {
    id: '09',
    name: 'cycle-4',
    batches: [
      ops(
        'p:ellipse "Plan"',
        'd:ellipse "Do"',
        'c:ellipse "Check"',
        'a:ellipse "Act"',
        'e1: p > d',
        'e2: d > c',
        'e3: c > a',
        'e4: a > p',
      ),
    ],
  },
  {
    id: '10',
    name: 'fan-in-out-long-labels',
    batches: [
      ops(
        'i1:note "Emails from the last two weeks that mention the client"',
        'i2:note "Calendar events with external attendees"',
        'i3:note "Meeting transcripts stored in SharePoint"',
        'i4:note "CRM notes"',
        'mix:rect "Copilot builds one briefing document for the account team"',
        'o1:rect "Summary for the account manager"',
        'o2:rect "Open questions for the client"',
        ...each(4, (i) => `e${i}: i${i} > mix`),
        'e5: mix > o1 "always"',
        'e6: mix > o2 "when something is missing"',
      ),
    ],
  },
  {
    id: '11',
    name: 'arrows-interleaved',
    batches: [
      ops(
        's1:rect "Idea"',
        's2:rect "Prototype"',
        'a1: s1 > s2',
        's3:diamond "Works?"',
        'a2: s2 > s3',
        's4:rect "Ship"',
        'a3: s3 > s4 "Yes"',
        's5:rect "Learn"',
        'a4: s3 > s5 "No"',
        'a5: s5 > s1',
      ),
    ],
  },
  {
    id: '12',
    name: 'two-diagrams-same-call',
    batches: [
      ops('q1:rect "Question"', 'q2:rect "Answer"', 'qa: q1 > q2'),
      ops(
        'title:text "Second topic: escalation"',
        'e1:rect "Ticket"',
        'e2:rect "Tier 1"',
        'e3:rect "Tier 2"',
        'ea: e1 > e2',
        'eb: e2 > e3',
      ),
    ],
  },
  {
    id: '13',
    name: 'title-then-flow',
    batches: [
      ops(
        'title:text "How a request is approved"',
        's1:rect "Submit"',
        's2:rect "Manager review"',
        's3:rect "Finance check"',
        'a1: s1 > s2',
        'a2: s2 > s3',
      ),
    ],
  },
  {
    id: '14',
    name: 'unconnected-notes',
    batches: [
      ops(
        'n1:note "Inbox triage"',
        'n2:note "Meeting prep"',
        'n3:note "Weekly report"',
        'n4:note "Client follow-up"',
        'n5:note "Budget review"',
      ),
    ],
  },
];

export function scenario(id: string): Scenario {
  const found = SCENARIOS.find((entry) => entry.id === id);
  if (!found) throw new Error(`No scenario ${id}`);
  return found;
}

/** Apply every batch of a scenario to a fresh document with the Founderz options. */
export function run(
  entry: Scenario,
  options: Parameters<DocModel['apply']>[1] = {},
): { doc: DocModel; results: ApplyResult[] } {
  const doc = createDoc(undefined, FOUNDERZ);
  const results = entry.batches.map((batch) => doc.apply(batch, { ...FELLOW, ...options }));
  return { doc, results };
}

/** The camera zoom `view.fit()` picks for a box, as `fitState` computes it (96 px padding, 1.5 cap). */
export function fitZoom(box: Box, viewport: { w: number; h: number } = VIEWPORT): number {
  const usableW = Math.max(120, viewport.w - Math.min(192, viewport.w * 0.3));
  const usableH = Math.max(120, viewport.h - Math.min(192, viewport.h * 0.35));
  return Math.max(0.05, Math.min(1.5, usableW / Math.max(1, box.w), usableH / Math.max(1, box.h)));
}

const NOT_NODES = new Set(['connector', 'line', 'path', 'group']);
export const isNode = (item: Item) => !NOT_NODES.has(item.kind);

type Segment = [Point, Point];
const segments = (points: Point[]): Segment[] =>
  points.slice(1).map((point, index): Segment => [points[index], point]);

/** Proper crossings away from segment ends, and collinear overlaps longer than 4 px. */
export function segmentsCross([a, b]: Segment, [c, d]: Segment): boolean {
  const rx = b.x - a.x,
    ry = b.y - a.y,
    sx = d.x - c.x,
    sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-9) {
    if (Math.abs((c.x - a.x) * ry - (c.y - a.y) * rx) > 1e-6) return false;
    const axis = Math.abs(rx) > Math.abs(ry) ? 'x' : 'y';
    const low = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
    const high = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]));
    return high - low > 4;
  }
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denominator;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}

/** Whether a segment passes through the inside of a box shrunk by 2 px. */
export function segmentThrough([a, b]: Segment, box: Box): boolean {
  const x0 = box.x + 2,
    y0 = box.y + 2,
    x1 = box.x + box.w - 2,
    y1 = box.y + box.h - 2;
  for (let step = 0; step <= 40; step++) {
    const x = a.x + ((b.x - a.x) * step) / 40,
      y = a.y + ((b.y - a.y) * step) / 40;
    if (x > x0 && x < x1 && y > y0 && y < y1) return true;
  }
  return false;
}

export const boxesOverlap = (a: Box, b: Box) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export interface Route {
  id: string;
  from?: string;
  to?: string;
  points: Point[];
}

export interface Measurement {
  bounds: Box;
  zoom: number;
  routes: Route[];
  crossings: string[];
  through: string[];
  overlaps: string[];
  nodes: Item[];
}

const endpoint = (end: Item['from']) => (end && 'item' in end ? end.item : undefined);

/** Measure the first page as the board would show it after `view.fit()`. */
export function measure(doc: DocModel, viewport: { w: number; h: number } = VIEWPORT): Measurement {
  const items = flattenItems(doc.toJSON({ compact: false }).pages[0].items);
  const nodes = items.filter(isNode);
  const routes: Route[] = items
    .filter((item) => item.kind === 'connector')
    .map((item) => ({
      id: item.id,
      from: endpoint(item.from),
      to: endpoint(item.to),
      points: routeConnector(item, items).points,
    }));
  const crossings: string[] = [];
  for (let i = 0; i < routes.length; i++)
    for (let j = i + 1; j < routes.length; j++)
      if (
        segments(routes[i].points).some((one) =>
          segments(routes[j].points).some((other) => segmentsCross(one, other)),
        )
      )
        crossings.push(`${routes[i].id} x ${routes[j].id}`);
  const through: string[] = [];
  for (const route of routes)
    for (const node of nodes)
      if (
        node.id !== route.from &&
        node.id !== route.to &&
        segments(route.points).some((segment) => segmentThrough(segment, node))
      )
        through.push(`${route.id} through ${node.id}`);
  const overlaps: string[] = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      if (boxesOverlap(nodes[i], nodes[j])) overlaps.push(`${nodes[i].id} + ${nodes[j].id}`);
  const bounds = boundsOf(items, items);
  return {
    bounds,
    zoom: fitZoom(bounds, viewport),
    routes,
    crossings,
    through,
    overlaps,
    nodes,
  };
}

/** Polyline length of a route. */
export function routeLength(points: Point[]): number {
  return segments(points).reduce((sum, [a, b]) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0);
}

/** One summary line per scenario, for reports. */
export function summary(entry: Scenario, result: Measurement): string {
  const { bounds, zoom, crossings, through, overlaps } = result;
  return `${entry.id} ${entry.name}: ${Math.round(bounds.w)}x${Math.round(bounds.h)} zoom ${zoom.toFixed(2)} crossings ${crossings.length} through ${through.length} overlaps ${overlaps.length}`;
}
