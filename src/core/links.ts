export type VideoProvider = 'youtube' | 'vimeo';
export interface VideoRef {
  provider: VideoProvider;
  id: string;
  hash?: string;
}
export interface LinkPreview {
  title?: string;
  description?: string;
  image?: string;
}

const YT = /^[\w-]{11}$/;
/** Raster image data URLs accepted as image items. */
export const IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;
/** Image media table sources, including SVG. */
export const MEDIA_DATA_URL =
  /^data:image\/(png|jpeg|gif|webp|avif|svg\+xml);base64,[a-z0-9+/=\s]+$/i;

export function normalizeHref(value?: string): string | undefined {
  if (typeof value !== 'string') return;
  const text = value.trim();
  if (IMAGE_DATA_URL.test(text)) return text.replace(/\s+/g, '');
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    url.username = url.password = '';
    return url.href;
  } catch {
    return;
  }
}

/** True for http(s) URLs whose host is not loopback, link-local, or RFC1918. */
export function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    return !isPrivateOrLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function isPrivateOrLocalHostname(host: string): boolean {
  const hostname = host
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
    .toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname === '::' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  )
    return true;
  const v4 = hostname.startsWith('::ffff:') ? hostname.slice(7) : hostname;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(v4)) {
    const [a, b] = v4.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  if (hostname.includes(':')) {
    if (
      hostname === '::1' ||
      hostname.startsWith('fe80:') ||
      hostname.startsWith('fc') ||
      hostname.startsWith('fd')
    )
      return true;
  }
  return false;
}

export function hostnameOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
}

export function parseVideo(href?: string): VideoRef | undefined {
  const normalized = normalizeHref(href);
  if (!normalized || normalized.startsWith('data:')) return;
  const url = new URL(normalized);
  const host = url.hostname.replace(/^(www|m)\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  if (host.includes('youtu')) {
    const id =
      host === 'youtu.be'
        ? parts[0]
        : (url.searchParams.get('v') ??
          parts[parts.findIndex((part) => /^(embed|shorts|live|v)$/.test(part)) + 1]);
    if (id && YT.test(id)) return { provider: 'youtube', id };
  }
  if (!/^(player\.)?vimeo\.com$/.test(host)) return;
  const start = parts[0] === 'video' || host.startsWith('player') ? 1 : 0;
  const id = parts[start];
  if (!id || !/^\d+$/.test(id)) return;
  const hash = url.searchParams.get('h') ?? parts[start + 1]?.match(/^[\w]+$/)?.[0];
  return { provider: 'vimeo', id, ...(hash ? { hash } : {}) };
}

export function videoEmbed(href?: string): string | undefined {
  const video = parseVideo(href);
  if (!video) return;
  return video.provider === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${video.id}?rel=0`
    : `https://player.vimeo.com/video/${video.id}${video.hash ? `?h=${encodeURIComponent(video.hash)}` : ''}`;
}
