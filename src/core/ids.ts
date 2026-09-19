import { customAlphabet } from 'nanoid';
const random = customAlphabet('346789abcdefghjkmnpqrtwxyz', 6);
/** Matches the item-id schema maximum. */
const ID_MAX = 160;
export const itemId = () => `i_${random()}`;
export const pageId = () => `p_${random()}`;
export const mediaId = () => `m_${random()}`;

/** Next free id: keep `requested` when unused, otherwise `stem_1`, `stem_2`, … */
export function uniqueItemId(requested: string, taken: Set<string>): string {
  if (requested && !taken.has(requested) && requested.length <= ID_MAX) return requested;
  const stem = (requested.replace(/_\d+$/, '') || requested || 'i').slice(0, ID_MAX - 2);
  for (let n = 1; n < 1e7; n++) {
    const suffix = `_${n}`;
    const id = `${stem.slice(0, ID_MAX - suffix.length)}${suffix}`;
    if (!taken.has(id)) return id;
  }
  return itemId();
}
