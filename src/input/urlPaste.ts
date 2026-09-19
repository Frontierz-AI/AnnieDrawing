import { sizeOf } from '../core/defaults';
import { mediaId } from '../core/ids';
import { hostnameOf, type LinkPreview } from '../core/links';
import { classifyPaste, imageMime, linkFallback, unfurlPage } from '../core/paste';
import type { ApplyOptions, ApplyResult, Item, Op, Point } from '../core/types';

export interface PasteHost {
  pageId: string;
  items: Item[];
  destroyed: boolean;
  unfurl?: false | ((url: string) => Promise<LinkPreview | undefined>);
  view: { center: Point };
  host: HTMLElement;
  apply(ops: Op[], options?: ApplyOptions): ApplyResult;
  select(ids: string[]): void;
  get(id: string): Item | undefined;
}

function place(
  host: PasteHost,
  kind: 'video' | 'link' | 'image',
  point?: Point,
  size?: [number, number],
) {
  const [w, h] = size ?? sizeOf(kind);
  const p = point ?? host.view.center;
  let x = p.x - w / 2,
    y = p.y - h / 2;
  if (!point)
    while (host.items.some((item) => Math.abs(item.x - x) < 4 && Math.abs(item.y - y) < 4)) {
      x += 24;
      y += 24;
    }
  return { x, y, w, h };
}

function fail(host: PasteHost, error: unknown) {
  host.host.dispatchEvent(new CustomEvent('ad-error', { detail: String(error) }));
}

function addHref(host: PasteHost, kind: 'video' | 'link', href: string, point?: Point) {
  const preview = kind === 'link' ? linkFallback(href) : undefined;
  const result = host.apply(
    [
      {
        op: 'add',
        page: host.pageId,
        item: {
          kind,
          href,
          ...place(host, kind, point),
          ...(preview
            ? {
                name: preview.host,
                description: preview.description,
                text: { value: preview.title, font: 'sans' as const },
              }
            : {}),
        },
      },
    ],
    { origin: 'user', label: kind === 'video' ? 'Paste video' : 'Paste link' },
  );
  if (result.ok) {
    host.select(result.created);
    if (kind === 'link' && result.created[0]) void enrich(host, result.created[0], href);
  }
}

async function enrich(host: PasteHost, id: string, href: string) {
  if (host.unfurl === false) return;
  try {
    const preview = await (host.unfurl ?? unfurlPage)(href);
    if (!preview || host.destroyed || !host.get(id)) return;
    const ops: Op[] = [];
    const patch: Partial<Item> = {};
    if (preview.title) patch.text = { value: preview.title, font: 'sans' };
    if (preview.image) {
      const mid = mediaId();
      ops.push({
        op: 'media.set',
        id: mid,
        media: { src: preview.image, mime: imageMime(preview.image), w: 1200, h: 630 },
      });
      patch.media = mid;
    }
    if (Object.keys(patch).length) ops.push({ op: 'set', id, patch });
    if (ops.length) host.apply(ops, { origin: 'user', label: 'Paste link', merge: true });
  } catch {
    /* Keep the hostname card when the page cannot be read. */
  }
}

async function addRemoteImage(host: PasteHost, src: string, point?: Point) {
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    const scale = Math.min(1, 480 / image.width, 360 / image.height),
      id = mediaId();
    const result = host.apply(
      [
        {
          op: 'media.set',
          id,
          media: { src, mime: imageMime(src), w: image.width, h: image.height },
        },
        {
          op: 'add',
          page: host.pageId,
          item: {
            kind: 'image',
            ...place(host, 'image', point, [image.width * scale, image.height * scale]),
            media: id,
            name: hostnameOf(src),
          },
        },
      ],
      { origin: 'user', label: 'Paste image' },
    );
    if (result.ok) host.select(result.created);
  } catch {
    addHref(host, 'link', src, point);
  }
}

export function pastePlain(host: PasteHost, value: string, point?: Point) {
  const pasted = classifyPaste(value);
  if (pasted.kind === 'video' || pasted.kind === 'link')
    addHref(host, pasted.kind, pasted.href, point);
  else if (pasted.kind === 'image')
    void addRemoteImage(host, pasted.href, point).catch((error) => fail(host, error));
  else {
    const p = point ?? host.view.center;
    const result = host.apply(
      [
        {
          op: 'add',
          page: host.pageId,
          item: { kind: 'text', x: p.x, y: p.y, w: 300, h: 100, text: { value, size: 'm' } },
        },
      ],
      { origin: 'user', label: 'Paste text' },
    );
    if (result.ok) host.select(result.created);
  }
}
