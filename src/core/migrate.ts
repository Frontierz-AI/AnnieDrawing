import type { AnnieDoc, Item, NewItem } from './types';
import { clone, normalizeItem } from './defaults';
import { flattenItems } from '../geo/box';

/** Retired containers become editable groups; no child or visible label is discarded. */
function convertContainers(pages: AnnieDoc['pages']) {
  const ids = new Set(
    flattenItems(pages.flatMap((page) => page.items ?? [])).map((item) => item.id),
  );
  const unique = (base: string) => {
    let id = base;
    for (let suffix = 2; ids.has(id); suffix++) id = `${base}_${suffix}`;
    ids.add(id);
    return id;
  };
  const convert = (input: NewItem): NewItem => {
    const children = input.children?.map(convert);
    if (input.kind !== 'frame') return { ...input, ...(children ? { children } : {}) };
    const { clip, title, text, style, ...rest } = input;
    const box = { x: input.x ?? 0, y: input.y ?? 0, w: input.w ?? 600, h: input.h ?? 400 };
    const parts: NewItem[] = [
      {
        kind: 'rect',
        id: unique(`${input.id}_background`),
        ...box,
        rotation: input.rotation,
        style: { fill: 'paper', strokeWidth: 1.5, ...style },
        ...(text ? { text } : {}),
      },
    ];
    const label = typeof title === 'string' ? title : input.name;
    if (label)
      parts.push({
        kind: 'text',
        id: unique(`${input.id}_label`),
        x: box.x,
        y: box.y - 30,
        w: box.w,
        h: 20,
        text: { value: label, size: 14, align: 'start', valign: 'top' },
      });
    return {
      ...rest,
      ...box,
      kind: 'group',
      name: input.name ?? label,
      children: [...parts, ...(children ?? [])],
    };
  };
  return pages.map((page) => ({
    ...page,
    items: Array.isArray(page.items) ? page.items.map(convert) : page.items,
  }));
}
export const CURRENT_VERSION = 2;
export const migrations: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> =
  {
    1: (doc) => ({
      ...doc,
      format: 'anniedrawing',
      version: 1,
      media: doc.media ?? {},
      meta: doc.meta ?? { title: 'Untitled board' },
    }),
    2: (doc) => {
      const { sheets, ...rest } = doc;
      const pages = sheets ?? doc.pages;
      return {
        ...rest,
        version: 2,
        pages: Array.isArray(pages)
          ? pages.map((page: Record<string, unknown>) => ({
              ...page,
              name:
                typeof page.name === 'string' && /^Sheet [1-9]\d*$/.test(page.name)
                  ? page.name.replace(/^Sheet /, 'Page ')
                  : page.name,
            }))
          : pages,
      };
    },
  };

/** Load any supported version. Retired `frame` items become groups on every import. */
export function migrate(
  input: unknown,
  kindDefaults: Record<string, Partial<Item>> = {},
): AnnieDoc {
  if (!input || typeof input !== 'object') throw new Error('A drawing must be a JSON object.');
  let doc = clone(input) as Record<string, unknown>;
  if (doc.format !== undefined && doc.format !== 'anniedrawing')
    throw new Error('This is not an AnnieDrawing document.');
  const version = doc.version ?? 0;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0)
    throw new Error('Invalid drawing version.');
  if (version > CURRENT_VERSION)
    throw new Error(
      `Drawing version ${version} is newer than supported version ${CURRENT_VERSION}.`,
    );
  for (let next = version + 1; next <= CURRENT_VERSION; next++) doc = migrations[next](doc);
  const result = doc as unknown as AnnieDoc;
  if (Array.isArray(result.pages))
    result.pages = convertContainers(result.pages).map((page) => ({
      ...page,
      items: Array.isArray(page.items)
        ? page.items.map((item) => normalizeItem(item, kindDefaults))
        : page.items,
    }));
  return result;
}
