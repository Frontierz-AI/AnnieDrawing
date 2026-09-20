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

async function enrich(host: PasteHost, id: string, href: string, label = 'Paste link') {
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
    if (ops.length) host.apply(ops, { origin: 'user', label, merge: true });
  } catch {
    /* Keep the hostname card when the page cannot be read. */
  }
}

function reject(message: string): ApplyResult {
  return {
    ok: false,
    created: [],
    errors: [{ index: 0, code: 'INVALID_OP', message }],
    warnings: [],
  };
}

/** Replace the href on an existing video or link item. */
export function updateHref(host: PasteHost, id: string, value: string): ApplyResult {
  const item = host.get(id);
  if (!item || (item.kind !== 'video' && item.kind !== 'link'))
    return reject(`Item ${id} is not a video or link.`);
  const pasted = classifyPaste(value);
  const href = pasted.kind === 'text' ? undefined : pasted.href;
  if (!href || href.startsWith('data:'))
    return reject(item.kind === 'video' ? `Bad video (${id}).` : `Bad href (${id}).`);
  if (item.kind === 'video' && pasted.kind !== 'video') return reject(`Bad video (${id}).`);
  if (href === item.href) return { ok: true, created: [], errors: [], warnings: [] };
  const preview = item.kind === 'link' ? linkFallback(href) : undefined;
  const label = item.kind === 'video' ? 'Edit video URL' : 'Edit URL';
  const result = host.apply(
    [
      {
        op: 'set',
        id,
        patch: {
          href,
          ...(preview
            ? {
                name: preview.host,
                description: preview.description,
                text: { value: preview.title, font: 'sans' as const },
                media: undefined,
              }
            : {}),
        },
      },
    ],
    { origin: 'user', label },
  );
  if (result.ok && item.kind === 'link') void enrich(host, id, href, label);
  return result;
}

function readImageSize(src: string): Promise<[number, number]> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const done = (ok: boolean) => {
      clearTimeout(timer);
      image.onload = image.onerror = null;
      if (ok && image.naturalWidth) resolve([image.naturalWidth, image.naturalHeight]);
      else reject(new Error('image'));
    };
    const timer = setTimeout(() => done(!!image.naturalWidth), 2500);
    image.onload = () => done(true);
    image.onerror = () => done(false);
    image.src = src;
  });
}

async function addRemoteImage(host: PasteHost, src: string, point?: Point) {
  try {
    const [width, height] = await readImageSize(src);
    const scale = Math.min(1, 480 / width, 360 / height),
      id = mediaId();
    const result = host.apply(
      [
        {
          op: 'media.set',
          id,
          media: { src, mime: imageMime(src), w: width, h: height },
        },
        {
          op: 'add',
          page: host.pageId,
          item: {
            kind: 'image',
            ...place(host, 'image', point, [width * scale, height * scale]),
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
