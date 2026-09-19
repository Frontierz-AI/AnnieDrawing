import type { AnnieDoc, Item, Query } from '../core/types';
import { clone } from '../core/defaults';
import { allItems } from '../core/item';
import { contains, flattenItems, itemBounds } from '../geo/box';
/** Filters combine with AND. A `RegExp` `g`/`y` flag is stripped so lastIndex cannot skip matches. */
export function queryDoc(doc: AnnieDoc, selector: Query = {}): Item[] {
  const all = allItems(doc),
    lookup = new Map(all.map((item) => [item.id, item]));
  const items = selector.page
    ? flattenItems(doc.pages.find((page) => page.id === selector.page)?.items ?? [])
    : all;
  const inside = selector.inside
    ? new Set(flattenItems(lookup.get(selector.inside)?.children ?? []).map((i) => i.id))
    : undefined;
  return items
    .filter((item) => {
      if (
        selector.kind &&
        !(Array.isArray(selector.kind) ? selector.kind : [selector.kind]).includes(item.kind)
      )
        return false;
      if (selector.text) {
        const value = [item.text?.value, item.name].filter(Boolean).join(' ');
        if (
          typeof selector.text === 'string'
            ? !value.toLowerCase().includes(selector.text.toLowerCase())
            : !new RegExp(selector.text.source, selector.text.flags.replace(/[gy]/g, '')).test(
                value,
              )
        )
          return false;
      }
      if (
        (selector.hidden !== undefined && !!item.hidden !== selector.hidden) ||
        (selector.locked !== undefined && !!item.locked !== selector.locked)
      )
        return false;
      if (selector.within && !contains(selector.within, itemBounds(item, lookup))) return false;
      if (inside && !inside.has(item.id)) return false;
      if (
        selector.data &&
        Object.entries(selector.data).some(
          ([key, value]) => JSON.stringify(item.data?.[key]) !== JSON.stringify(value),
        )
      )
        return false;
      if (selector.connectedTo) {
        const outgoing =
            item.from && 'item' in item.from && item.from.item === selector.connectedTo,
          incoming = item.to && 'item' in item.to && item.to.item === selector.connectedTo;
        const direction = selector.direction ?? 'both';
        if (
          !(direction === 'out' ? outgoing : direction === 'in' ? incoming : outgoing || incoming)
        )
          return false;
      }
      return true;
    })
    .map(clone);
}
