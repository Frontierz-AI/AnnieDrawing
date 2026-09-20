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

/** True for http(s) URLs whose host is not loopback, link-local, ULA, or RFC1918. */
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
    hostname === '0.0.0.0' ||
    hostname === '::' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  )
    return true;
  const prefix = hostname.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?:\.|$)/);
  if (prefix && isPrivateIPv4(prefix[1])) return true;
  const v4 = ipv4Address(hostname);
  if (v4) return isPrivateIPv4(v4);
  const v6 = parseIPv6(hostname);
  if (!v6) return false;
  if (v6.every((part) => part === 0)) return true;
  if (v6[7] === 1 && v6.slice(0, 7).every((part) => part === 0)) return true;
  if ((v6[0] & 0xffc0) === 0xfe80 || (v6[0] & 0xfe00) === 0xfc00 || (v6[0] & 0xff00) === 0xff00)
    return true;
  const mapped = mappedIPv4(v6);
  return mapped ? isPrivateIPv4(mapped) : false;
}

function isPrivateIPv4(value: string): boolean {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => n > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return a >= 224;
}

function ipv4Address(hostname: string): string | undefined {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return hostname;
  const v6 = parseIPv6(hostname);
  return v6 ? mappedIPv4(v6) : undefined;
}

function mappedIPv4(groups: number[]): string | undefined {
  const last = `${(groups[6] >> 8) & 255}.${groups[6] & 255}.${(groups[7] >> 8) & 255}.${groups[7] & 255}`;
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff
  )
    return last;
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((part) => part === 0))
    return last;
  return;
}

function parseIPv6(host: string): number[] | undefined {
  if (!host.includes(':')) return;
  let value = host;
  const dotted = value.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return;
    value = `${value.slice(0, -dotted[1].length)}${(a << 8) | b}:${(c << 8) | d}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return;
  const parse = (side: string | undefined) =>
    side
      ? side
          .split(':')
          .filter(Boolean)
          .map((part) => (/^[0-9a-f]{1,4}$/i.test(part) ? parseInt(part, 16) : NaN))
      : [];
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (head.some(Number.isNaN) || tail.some(Number.isNaN)) return;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return;
  return [...head, ...Array(missing).fill(0), ...tail];
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
