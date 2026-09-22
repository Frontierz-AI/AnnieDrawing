import type { AnnieDoc, DescribeOptions, Item } from '../core/types';
import { allItems } from '../core/item';
import { boundsOf, flattenItems, itemBounds } from '../geo/box';
const number = (n: number) => Math.round(n * 10) / 10;
const title = (i: Item) => i.name ?? i.text?.value;
const quote = (s: string) => JSON.stringify(s.length > 160 ? `${s.slice(0, 157)}…` : s);
/**
 * Ids, kinds, and colors come from the document, which is untrusted. A plain token prints as it is;
 * anything with spaces, commas, quotes, or line breaks is quoted so it cannot fake a line or a field.
 */
const token = (s: string) => (/^[\w.:#-]{1,160}$/.test(s) ? s : quote(s));
export interface ItemStamp {
  revision: number;
  origin: string;
  kind: string;
  page: string;
}
export interface DescribeSession {
  written: Map<string, ItemStamp>;
  removed: Map<string, ItemStamp>;
}
export function describeDoc(
  doc: AnnieDoc,
  options: DescribeOptions = {},
  session?: DescribeSession,
): string {
  const pages = doc.pages.filter((page, index) =>
      options.page ? page.id === options.page : options.scope === 'page' ? index === 0 : true,
    ),
    detail = options.detail ?? 'normal',
    limit = options.maxItems ?? 100,
    since = options.since,
    selected = new Set(options.selection ?? []),
    scoped = options.ids ? new Set(options.ids) : undefined,
    lines: string[] = [];
  let shown = 0;
  const emitted = new Set<string>();
  const all = allItems(doc),
    lookup = new Map(all.map((i) => [i.id, i]));
  const changed =
    since !== undefined && session
      ? (id: string) => {
          const stamp = session.written.get(id);
          return !!stamp && stamp.revision > since;
        }
      : () => true;
  const includePresent = (item: Item) => {
    if (options.scope === 'selection' && !selected.has(item.id)) return false;
    if (scoped && !scoped.has(item.id)) return false;
    return changed(item.id);
  };
  const includeRemoved = (stamp: ItemStamp) => {
    if (options.scope === 'selection' || scoped) return false;
    if (options.page && stamp.page !== options.page) return false;
    return since !== undefined && stamp.revision > since;
  };
  let any = false;
  for (const page of pages) {
    const items = flattenItems(page.items).filter(includePresent);
    const gone = session
      ? [...session.removed.entries()]
          .filter(([, stamp]) => stamp.page === page.id && includeRemoved(stamp))
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      : [];
    if (since !== undefined && !items.length && !gone.length) continue;
    any = true;
    const live = flattenItems(page.items).filter((item) => {
      if (options.scope === 'selection' && !selected.has(item.id)) return false;
      if (scoped && !scoped.has(item.id)) return false;
      return true;
    });
    lines.push(
      `Page ${quote(page.name)} (${token(page.id)}): ${since === undefined ? live.length : items.length + gone.length} item${(since === undefined ? live.length : items.length + gone.length) === 1 ? '' : 's'}.${selected.size && since === undefined ? ` Selection: ${[...selected].map(token).join(', ')}.` : ''}`,
    );
    if (!items.length && !gone.length) {
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
      let line = `${token(item.id)} ${token(item.kind)}${label ? ` ${quote(label)}` : ''}`;
      if (detail !== 'brief')
        line += ` at (${number(b.x)},${number(b.y)}) ${number(b.w)}×${number(b.h)}${item.style?.fill ? `, fill ${token(item.style.fill)}` : ''}${item.hidden ? ', hidden' : ''}${item.locked ? ', locked' : ''}`;
      if (item.children?.length)
        line += ` contains ${item.children.map((i) => token(i.id)).join(', ')}`;
      if (detail === 'full' && item.data)
        line += ` [${Object.entries(item.data)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, value]) => `data.${token(key)}=${JSON.stringify(value)}`)
          .join(', ')}]`;
      if (detail !== 'brief' && session?.written.get(item.id)?.origin.startsWith('agent:'))
        line += ', by agent';
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
          !p ? 'unset' : 'item' in p ? token(p.item) : `(${number(p.x)},${number(p.y)})`;
        let line = `  ${token(item.id)}: ${endpoint(item.from)} → ${endpoint(item.to)}${title(item) ? ` ${quote(title(item)!)}` : ''} (${item.route ?? 'straight'})`;
        if (detail !== 'brief' && session?.written.get(item.id)?.origin.startsWith('agent:'))
          line += ', by agent';
        lines.push(line);
      }
    }
    for (const [id, stamp] of gone) {
      if (shown >= limit) continue;
      shown++;
      emitted.add(id);
      lines.push(
        detail === 'brief' ? `removed ${token(id)}` : `removed ${token(id)} ${token(stamp.kind)}`,
      );
    }
    if (options.relations && detail !== 'brief') {
      const relations: string[] = [];
      for (let i = 0; i < Math.min(sorted.length, 20); i++) {
        const a = sorted[i],
          b = sorted[i + 1];
        if (!b) continue;
        const gap = b.x - a.x - a.w;
        if (gap >= 0 && Math.abs(a.y - b.y) < 5)
          relations.push(
            `${token(a.id)} is left of ${token(b.id)}, tops aligned, gap ${number(gap)}`,
          );
      }
      if (relations.length) lines.push(`Layout: ${relations.join('; ')}.`);
    }
    if (options.freeSpace) {
      const space = since === undefined ? flattenItems(page.items).filter(includePresent) : items;
      const source = space.length ? space : items;
      if (source.length) {
        const b = boundsOf(source, lookup);
        lines.push(
          `Free space: right of content from x=${number(b.x + b.w + 40)}; below content from y=${number(b.y + b.h + 40)}.`,
        );
      }
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
  if (since !== undefined && !any) return `No changes since revision ${since}.`;
  return lines.join('\n');
}
