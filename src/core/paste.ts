import {
  hostnameOf,
  IMAGE_DATA_URL,
  normalizeHref,
  parseVideo,
  type LinkPreview,
  type VideoRef,
} from './links';

export function imageMime(href: string): string {
  const ext = href.match(/image\/([a-z]+)|[.](png|jpe?g|gif|webp|avif)(?:$|[?#])/i);
  const token = (ext?.[1] ?? ext?.[2] ?? 'jpeg').toLowerCase();
  return `image/${token === 'jpg' ? 'jpeg' : token}`;
}

export type PastedContent =
  | { kind: 'video'; href: string; video: VideoRef }
  | { kind: 'image'; href: string }
  | { kind: 'link'; href: string }
  | { kind: 'text'; value: string };

const IMAGE = /\.(png|jpe?g|gif|webp|avif)$/i;
const SITE = /^[\w-]+(\.[\w-]+)+([/:?#]|$)/;
const NAMED: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[\da-f]+|nbsp|amp|quot|apos|#39|lt|gt);/gi, (all, token: string) => {
    if (token[0] === '#')
      return String.fromCodePoint(
        token[1] === 'x' || token[1] === 'X' ? parseInt(token.slice(2), 16) : +token.slice(1),
      );
    return NAMED[token.toLowerCase()] ?? all;
  });
}

export function classifyPaste(value: string): PastedContent {
  let text = value.trim();
  if (/^<.*>$/.test(text)) text = text.slice(1, -1).trim();
  const found = text.match(/https?:\/\/[^\s<>"']+/i)?.[0];
  if (found) text = found.replace(/&amp;/g, '&');
  else if (IMAGE_DATA_URL.test(text)) text = text.replace(/\s+/g, '');
  else if (SITE.test(text) && !/\s/.test(text)) text = `https://${text}`;
  const href = /\s/.test(text) && !text.startsWith('data:') ? undefined : normalizeHref(text);
  if (!href) return { kind: 'text', value };
  const video = parseVideo(href);
  if (video) return { kind: 'video', href, video };
  try {
    if (IMAGE_DATA_URL.test(href) || IMAGE.test(new URL(href).pathname))
      return { kind: 'image', href };
  } catch {
    /* Invalid URL is treated as a link or plain text above. */
  }
  return { kind: 'link', href };
}

function meta(html: string, name: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!new RegExp(`(?:property|name|itemprop)\\s*=\\s*["']${name}["']`, 'i').test(tag)) continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content) return decodeEntities(content.trim());
  }
}

export function parseLinkPreview(html: string, base: string): LinkPreview {
  const title =
    meta(html, 'og:title') ??
    meta(html, 'twitter:title') ??
    decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? '');
  const description =
    meta(html, 'og:description') ?? meta(html, 'twitter:description') ?? meta(html, 'description');
  let image =
    meta(html, 'og:image') ??
    meta(html, 'og:image:secure_url') ??
    meta(html, 'twitter:image') ??
    meta(html, 'twitter:image:src');
  if (image)
    try {
      image = normalizeHref(new URL(image, base).href);
    } catch {
      image = undefined;
    }
  return {
    ...(title ? { title: title.slice(0, 200) } : {}),
    ...(description ? { description: description.slice(0, 400) } : {}),
    ...(image ? { image } : {}),
  };
}

export async function unfurlPage(href: string): Promise<LinkPreview | undefined> {
  const url = normalizeHref(href);
  if (!url || url.startsWith('data:') || typeof fetch !== 'function') return;
  const response = await fetch(url, { credentials: 'omit', headers: { Accept: 'text/html' } });
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || (type && !/html|xml/i.test(type))) return;
  return parseLinkPreview((await response.text()).slice(0, 200000), response.url || url);
}

export function displayUrl(href: string): string {
  try {
    const url = new URL(href);
    const path = decodeURIComponent(url.pathname).replace(/\/$/, '');
    return `${hostnameOf(href)}${path}`;
  } catch {
    return href.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
}

export function prettyTitle(href: string): string {
  const name = hostnameOf(href).split('.')[0] ?? '';
  return name ? name[0].toUpperCase() + name.slice(1) : hostnameOf(href);
}

export function linkFallback(href: string): { title: string; description: string; host: string } {
  return { title: prettyTitle(href), description: displayUrl(href), host: hostnameOf(href) };
}
