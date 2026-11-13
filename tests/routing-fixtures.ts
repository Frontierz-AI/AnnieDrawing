import type { Item } from '../src/core';

/** Explicit-coordinate diagrams for routing tests, independent of agent placement. */
const node = (
  id: string,
  kind: string,
  x: number,
  y: number,
  w: number,
  h: number,
  text?: string,
) => ({ id, kind, x, y, w, h, ...(text ? { text: { value: text } } : {}) }) as Item;
const arrow = (id: string, from: string, to: string, text?: string) =>
  ({
    id,
    kind: 'connector',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    route: 'elbow',
    heads: { end: 'arrow' },
    from: { item: from },
    to: { item: to },
    ...(text ? { text: { value: text } } : {}),
  }) as Item;

/** Scenario 03: a row whose diamond sends "No" back to the second node. */
export const loopBack = (): Item[] => [
  node('plan', 'rect', 0, 0, 180, 110, 'Plan'),
  node('build', 'rect', 300, 0, 180, 110, 'Build'),
  node('test', 'rect', 600, 0, 180, 110, 'Test'),
  node('pass', 'diamond', 900, -15, 206, 140, 'Tests pass?'),
  node('release', 'rect', 1226, 0, 180, 110, 'Release'),
  arrow('a1', 'plan', 'build'),
  arrow('a2', 'build', 'test'),
  arrow('a3', 'test', 'pass'),
  arrow('a4', 'pass', 'release', 'Yes'),
  arrow('a5', 'pass', 'build', 'No'),
];

/** Scenario 07 after its second batch: a diamond inserted between `a` and `b`, "No" returns to `a`. */
export const insertBetween = (): Item[] => [
  node('a', 'rect', 0, 0, 180, 110, 'Draft'),
  node('b', 'rect', 588, 0, 180, 110, 'Send'),
  node('c', 'rect', 888, 0, 180, 110, 'Archive'),
  arrow('bc', 'b', 'c'),
  node('x', 'diamond', 300, -15, 168, 140, 'Reviewed?'),
  arrow('ax', 'a', 'x'),
  arrow('xb', 'x', 'b', 'Yes'),
  arrow('xa', 'x', 'a', 'No'),
];

/** A hub with three spokes on each side, arrows listed alternating sides. */
export const hub = (): Item[] => [
  node('hub', 'ellipse', 500, 260, 200, 100, 'Copilot Cowork'),
  ...[110, 280, 450].flatMap((y, row) => [
    node(`m${row * 2 + 1}`, 'rect', 100, y, 180, 60, `Left ${row + 1}`),
    node(`m${row * 2 + 2}`, 'rect', 920, y, 180, 60, `Right ${row + 1}`),
  ]),
  ...[1, 2, 3, 4, 5, 6].map((n) => arrow(`a${n}`, 'hub', `m${n}`)),
];

/** A three-level tree, each parent centered over its own children. */
export const tree = (): Item[] => [
  node('root', 'rect', 500, 0, 160, 60, 'Company'),
  node('c1', 'rect', 100, 200, 160, 60, 'Sales'),
  node('c2', 'rect', 500, 200, 160, 60, 'Product'),
  node('c3', 'rect', 900, 200, 160, 60, 'Operations'),
  ...['Inbound', 'Outbound', 'Design', 'Engineering', 'Finance', 'Support'].map((label, i) =>
    node(`g${i + 1}`, 'rect', i * 200, 400, 160, 60, label),
  ),
  arrow('e1', 'root', 'c1'),
  arrow('e2', 'root', 'c2'),
  arrow('e3', 'root', 'c3'),
  ...[1, 2, 3, 4, 5, 6].map((g) => arrow(`e${g + 3}`, `c${Math.ceil(g / 2)}`, `g${g}`)),
];

/** Scenario 10: four inputs left of one node, two labeled outputs right of it. */
export const fanInOut = (): Item[] => [
  node('i1', 'note', 0, 0, 300, 100, 'Emails from the last two weeks that mention the client'),
  node('i2', 'note', 0, 140, 300, 100, 'Calendar events with external attendees'),
  node('i3', 'note', 0, 280, 300, 100, 'Meeting transcripts stored in SharePoint'),
  node('i4', 'note', 0, 420, 300, 100, 'CRM notes'),
  node(
    'mix',
    'rect',
    600,
    220,
    344,
    80,
    'Copilot builds one briefing document for the account team',
  ),
  node('o1', 'rect', 1300, 60, 280, 80, 'Summary for the account manager'),
  node('o2', 'rect', 1300, 380, 280, 80, 'Open questions for the client'),
  ...[1, 2, 3, 4].map((n) => arrow(`e${n}`, `i${n}`, 'mix')),
  arrow('e5', 'mix', 'o1', 'always'),
  arrow('e6', 'mix', 'o2', 'when something is missing'),
];

export const fixtures = { loopBack, insertBetween, hub, tree, fanInOut };
