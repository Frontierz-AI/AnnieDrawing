import type { AnnieDoc, Item, Media, NewItem, Op } from './types';
import { flattenItems } from '../geo/box';

/** Height over width, when the media has a usable size. */
const ratio = (media?: Media) => (media && media.w > 0 && media.h > 0 ? media.h / media.w : 0);
const size = (value: number) => Math.max(1, Math.round(value));

/**
 * Size an image add that omitted `w` or `h` from its media: both omitted fits the 480x360 box
 * `addImage()` uses without enlarging; one sent derives the other. A pending image without media
 * keeps the 4:3 default. The item is marked `fitMedia` so a later aspect change follows.
 */
export function sizeImage(item: Item, input: NewItem, media: AnnieDoc['media']): void {
  if (item.kind !== 'image' || (input.w !== undefined && input.h !== undefined)) return;
  const source = item.media ? media[item.media] : undefined,
    r = ratio(source) || (item.pending === true ? 0.75 : 0);
  if (!r) return;
  if (input.w !== undefined) item.h = size(item.w * r);
  else if (input.h !== undefined) item.w = size(item.h / r);
  else if (source && ratio(source)) {
    const scale = Math.min(1, 480 / source.w, 360 / source.h);
    item.w = size(source.w * scale);
    item.h = size(source.h * scale);
  }
  item.fitMedia = true;
}

/** The height a `fitMedia` image takes for this media at its current width, when it changes. */
export function followHeight(item: Item, media?: Media): number | undefined {
  const r = ratio(media);
  if (item.kind !== 'image' || item.fitMedia !== true || !r) return;
  const h = size(item.w * r);
  return h === item.h ? undefined : h;
}

/** Resize every `fitMedia` image that uses `key` after its media changed. Returns the ops and inverses. */
export function followMedia(doc: AnnieDoc, key: string): { ops: Op[]; inverse: Op[] } {
  const ops: Op[] = [],
    inverse: Op[] = [];
  for (const page of doc.pages)
    for (const item of flattenItems(page.items)) {
      const h = item.media === key ? followHeight(item, doc.media[key]) : undefined;
      if (h === undefined) continue;
      // `fitMedia` rides along so replaying either op never reads as an explicit resize.
      inverse.push({ op: 'set', id: item.id, patch: { h: item.h, fitMedia: true } });
      ops.push({ op: 'set', id: item.id, patch: { h, fitMedia: true } });
      item.h = h;
    }
  return { ops, inverse };
}

/**
 * Adjust an image `set` patch before it merges: an explicit `w` or `h` ends `fitMedia`, and a new
 * `media` on a `fitMedia` image sets the height from it. `undo` is the inverse patch to complete.
 */
export function patchImage(
  item: Item,
  patch: Partial<Item>,
  undo: Record<string, unknown>,
  media: AnnieDoc['media'],
): void {
  if (item.kind !== 'image' || item.fitMedia !== true || Object.hasOwn(patch, 'fitMedia')) return;
  if (Object.hasOwn(patch, 'w') || Object.hasOwn(patch, 'h')) {
    patch.fitMedia = undefined;
    undo.fitMedia = true;
    return;
  }
  if (typeof patch.media !== 'string') return;
  const h = followHeight(item, media[patch.media]);
  if (h === undefined) return;
  patch.h = h;
  undo.h = item.h;
}
