import type { Item } from './types';

/** Moving a group must not move a locked descendant; locked groups protect their children. */
export function lockedItems(items: Item[]): Set<string> {
  const locked = new Set<string>();
  const visit = (item: Item, inherited = false): boolean => {
    const own = inherited || !!item.locked;
    let protectedChild = false;
    for (const child of item.children ?? []) protectedChild = visit(child, own) || protectedChild;
    if (own || protectedChild) locked.add(item.id);
    return own || protectedChild;
  };
  items.forEach((item) => visit(item));
  return locked;
}
