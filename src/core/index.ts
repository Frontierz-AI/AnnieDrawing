/** Headless document, validation, history, and geometry. */
export type * from './types';
export { CATALOG_VERSION, KIND_CATALOG, kindsSince } from './catalog';
export type { KindCatalogEntry, KindCatalogSnapshot } from './catalog';
export { createDoc } from './doc';
export {
  DEFAULT_STYLE,
  CARD_CORNER,
  DEFAULT_SIZES,
  clone,
  sizeOf,
  kindDefaultsFrom,
  defaultDoc,
  normalizeItem,
  minimalItem,
  storedKind,
  storedColor,
  storedEndpoint,
} from './defaults';
export { itemId, pageId, mediaId } from './ids';
export {
  LIMITS,
  VISION_PNG,
  ItemSchema,
  PlacementSchema,
  DocumentSchema,
  OpSchema,
  OpsSchema,
  QuerySchema,
  DescribeSchema,
} from './schema';
export { migrate } from './migrate';
export {
  IMAGE_DATA_URL,
  MEDIA_DATA_URL,
  normalizeHref,
  hostnameOf,
  parseVideo,
  videoEmbed,
} from './links';
export type { VideoRef, LinkPreview } from './links';
export { clipboardText } from './clipboard';
export {
  imageMime,
  classifyPaste,
  parseLinkPreview,
  unfurlPage,
  displayUrl,
  prettyTitle,
  linkFallback,
  decodeEntities,
} from './paste';
export { allItems, applyDraft, translateItem, copyItems, detachMissingEndpoints } from './item';
export type { ItemPatch } from './item';
export * from '../geo/index';
