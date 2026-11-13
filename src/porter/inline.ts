import { MEDIA_DATA_URL } from '../core/links';
import type { AnnieDoc, ExportOptions, Item } from '../core/types';
import { flattenItems } from '../geo/index';

/**
 * Copy the media table with each remote picture the exported items use replaced by a data URL,
 * fetched with CORS. Only media already in the document is fetched, so the origin rules that
 * accepted it still decide what loads. Media that cannot be fetched is left out, which the SVG
 * writer draws as a labeled placeholder, and `onWarning` hears about every item that used it.
 */
export async function inlineMedia(
  media: AnnieDoc['media'],
  items: Item[],
  onWarning?: ExportOptions['onWarning'],
): Promise<AnnieDoc['media']> {
  const out = { ...media },
    users = new Map<string, Item[]>();
  for (const item of flattenItems(items)) {
    const source = item.media ? media[item.media] : undefined;
    if (!source || item.hidden || MEDIA_DATA_URL.test(source.src)) continue;
    users.set(item.media!, [...(users.get(item.media!) ?? []), item]);
  }
  await Promise.all(
    [...users].map(async ([key, list]) => {
      try {
        const response = await fetch(media[key].src, { mode: 'cors' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        out[key] = {
          ...media[key],
          src: await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(
              blob.type.startsWith('image/') ? blob : new Blob([blob], { type: media[key].mime }),
            );
          }),
        };
      } catch (error) {
        delete out[key];
        const reason = error instanceof Error ? error.message : String(error);
        for (const item of list)
          try {
            onWarning?.({
              code: 'IMAGE_UNAVAILABLE',
              id: item.id,
              media: key,
              message: `Image ${item.name ?? item.id} could not be embedded (${reason}). The export shows a placeholder.`,
            });
          } catch {
            /* A failing callback does not stop the export. */
          }
      }
    }),
  );
  return out;
}
