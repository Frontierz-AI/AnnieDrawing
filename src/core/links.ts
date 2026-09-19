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
