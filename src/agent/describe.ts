import type { AnnieDoc, DescribeOptions, Item } from '../core/types';
import { allItems } from '../core/item';
import { boundsOf, flattenItems, itemBounds } from '../geo/box';
const number = (n: number) => Math.round(n * 10) / 10;
const title = (i: Item) => i.name ?? i.text?.value;
const quote = (s: string) => JSON.stringify(s.length > 160 ? `${s.slice(0, 157)}…` : s);
export function describeDoc(doc: AnnieDoc, options: DescribeOptions = {}): string {
  const pages = doc.pages.filter((page, index) =>
      options.page ? page.id === options.page : options.scope === 'page' ? index === 0 : true,
    ),
    detail = options.detail ?? 'normal',
    limit = options.maxItems ?? 100,
    lines: string[] = [],
    selected = new Set(options.selection ?? []);
  let shown = 0;
  const emitted = new Set<string>();
  const all = allItems(doc),
    lookup = new Map(all.map((i) => [i.id, i]));
  for (const page of pages) {
    const items = flattenItems(page.items).filter(
      (i) => options.scope !== 'selection' || selected.has(i.id),
    );
    lines.push(
      `Page ${quote(page.name)} (${page.id}): ${items.length} item${items.length === 1 ? '' : 's'}.${selected.size ? ` Selection: ${[...selected].join(', ')}.` : ''}`,
    );
    if (!items.length) {
      lines.push('An empty board, ready for your first idea.');
      continue;
    }
    const sorted = items
      .filter((i) => i.kind !== 'connector')
      .sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const item of sorted) {
      if (shown >= limit) continue;
      shown++;
      emitted.add(item.id);
      const b = itemBounds(item, lookup),
        label = title(item);
      let line = `${item.id} ${item.kind}${label ? ` ${quote(label)}` : ''}`;
      if (detail !== 'brief')
        line += ` at (${number(b.x)},${number(b.y)}) ${number(b.w)}×${number(b.h)}${item.style?.fill ? `, fill ${item.style.fill}` : ''}${item.hidden ? ', hidden' : ''}${item.locked ? ', locked' : ''}`;
      if (item.children?.length) line += ` contains ${item.children.map((i) => i.id).join(', ')}`;
      if (detail === 'full' && item.data)
        line += ` [${Object.entries(item.data)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, value]) => `data.${key}=${JSON.stringify(value)}`)
          .join(', ')}]`;
      lines.push(line);
    }
    const connections = items.filter((i) => i.kind === 'connector');
    if (connections.length) {
      lines.push('Connections:');
      for (const item of connections) {
        if (shown >= limit) continue;
        shown++;
        emitted.add(item.id);
        const endpoint = (p: Item['from']) =>
          !p ? 'unset' : 'item' in p ? p.item : `(${number(p.x)},${number(p.y)})`;
        lines.push(
          `  ${item.id}: ${endpoint(item.from)} → ${endpoint(item.to)}${title(item) ? ` ${quote(title(item)!)}` : ''} (${item.route ?? 'straight'})`,
        );
      }
    }
    if (options.relations && detail !== 'brief') {
      const relations: string[] = [];
      for (let i = 0; i < Math.min(sorted.length, 20); i++) {
        const a = sorted[i],
          b = sorted[i + 1];
        if (!b) continue;
        const gap = b.x - a.x - a.w;
        if (gap >= 0 && Math.abs(a.y - b.y) < 5)
          relations.push(`${a.id} is left of ${b.id}, tops aligned, gap ${number(gap)}`);
      }
      if (relations.length) lines.push(`Layout: ${relations.join('; ')}.`);
    }
    if (options.freeSpace) {
      const b = boundsOf(items, lookup);
      lines.push(
        `Free space: right of content from x=${number(b.x + b.w + 40)}; below content from y=${number(b.y + b.h + 40)}.`,
      );
    }
    const omitted = items.filter((item) => !emitted.has(item.id));
    if (omitted.length) {
      const clusters = new Map<string, number>();
      for (const item of omitted) {
        const key = `near (${Math.floor(item.x / 600) * 600},${Math.floor(item.y / 600) * 600})`;
        clusters.set(key, (clusters.get(key) ?? 0) + 1);
      }
      lines.push(
        `${omitted.length} more items: ${[...clusters]
          .slice(0, 8)
          .map(([key, count]) => `${count} ${key}`)
          .join(
            '; ',
          )}${clusters.size > 8 ? `; ${clusters.size - 8} more clusters` : ''}. Use query() or increase maxItems for detail.`,
      );
    }
  }
  return lines.join('\n');
}
