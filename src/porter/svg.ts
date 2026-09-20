import { CARD_CORNER } from '../core/defaults';
import { allItems } from '../core/item';
import { hostnameOf, normalizeHref, parseVideo } from '../core/links';
import type { AnnieDoc, Box, ExportOptions, Item } from '../core/types';
import { boundsOf, flattenItems, routeConnector } from '../geo/index';
import { createKindRegistry, type KindDef } from '../kinds/registry';
import {
  color,
  esc,
  fontFamily,
  fonts,
  fontSize,
  headsMarkup,
  shapeMarkup,
  labelColor,
  round,
} from '../stage/paint';

export interface SVGExportOptions extends ExportOptions {
  theme?: 'light' | 'dark';
  bounds?: Box;
  kinds?: KindDef[];
}
function wrapText(value: string, width: number, size: number): string[] {
  const maxChars = Math.max(1, Math.floor(width / (size * 0.53)));
  const result: string[] = [];
  for (const paragraph of value.split('\n')) {
    if (!paragraph) {
      result.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (line && line.length + word.length + 1 > maxChars) {
        result.push(line);
        line = '';
      }
      let remaining = word;
      while (remaining.length > maxChars) {
        if (line) {
          result.push(line);
          line = '';
        }
        result.push(remaining.slice(0, maxChars));
        remaining = remaining.slice(maxChars);
      }
      line += `${line ? ' ' : ''}${remaining}`;
    }
    result.push(line);
  }
  return result;
}
function textMarkup(
  item: Item,
  theme: 'light' | 'dark',
  connectorPoint?: { x: number; y: number },
): string {
  if (!item.text?.value) return '';
  const size = fontSize(item.text);
  const padding = item.kind === 'text' ? 0 : item.kind === 'note' ? 20 : 12;
  const width = connectorPoint
    ? 220
    : item.w * (item.kind === 'diamond' ? 0.6 : item.kind === 'ellipse' ? 0.75 : 1) - padding * 2;
  const lines = wrapText(item.text.value, width, size);
  const lineHeight = size * 1.35;
  const align = item.text.align ?? (item.kind === 'text' ? 'start' : 'center');
  const anchor = align === 'start' ? 'start' : align === 'end' ? 'end' : 'middle';
  const x =
    connectorPoint?.x ??
    (align === 'start' ? padding : align === 'end' ? item.w - padding : item.w / 2);
  const textHeight = lines.length * lineHeight;
  const y = connectorPoint
    ? connectorPoint.y - textHeight / 2 + size
    : item.text.valign === 'top'
      ? padding + size
      : item.text.valign === 'bottom'
        ? item.h - padding - textHeight + size
        : (item.h - textHeight) / 2 + size;
  const longest = Math.max(...lines.map((line) => line.length)) * size * 0.53;
  const label = connectorPoint
    ? `<rect x="${x - longest / 2 - 7}" y="${connectorPoint.y - textHeight / 2 - 2}" width="${longest + 14}" height="${textHeight + 4}" rx="4" fill="${color('paper', theme)}"/>`
    : '';
  return `${label}<text x="${x}" y="${y}" font-family="${esc(fontFamily(item.text.font))}" font-size="${size}" text-anchor="${connectorPoint ? 'middle' : anchor}" fill="${esc(labelColor(item, theme))}">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${esc(line) || '&#160;'}</tspan>`).join('')}</text>`;
}

function fitLine(value: string, width: number, size: number): string {
  const max = Math.max(1, Math.floor(width / (size * 0.52)));
  const text = value.trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

function hrefLine(href?: string): string {
  const url = normalizeHref(href);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname).replace(/\/$/, '');
    const line = `${hostnameOf(url)}${path}`;
    return parsed.search && line.length < 36 ? `${line}${parsed.search}` : line;
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
}

function cardTitle(item: Item, href?: string): string {
  const written = item.text?.value?.trim() || item.name?.trim();
  if (written && written.toLowerCase() !== item.kind) return written;
  if (href) {
    const name = hostnameOf(href).split('.')[0] ?? '';
    if (name) return name[0].toUpperCase() + name.slice(1);
  }
  return item.kind === 'video' ? 'Video' : 'Link';
}

function cardLink(href: string | undefined, inner: string): string {
  const url = normalizeHref(href);
  return url
    ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">${inner}</a>`
    : inner;
}

function cardExport(item: Item, theme: 'light' | 'dark', doc: AnnieDoc, index: number): string {
  const r = Math.min(item.style?.corner ?? CARD_CORNER, item.w / 2, item.h / 2);
  const w = item.w,
    h = item.h,
    uid = `adx${index}`,
    face = fonts.sans,
    href = item.href,
    title = cardTitle(item, href),
    url = hrefLine(href),
    pad = Math.max(10, Math.min(14, w * 0.04));
  const clip = `<defs><clipPath id="${uid}p"><rect width="${w}" height="${h}" rx="${r}"/></clipPath></defs>`;
  if (item.kind === 'video') {
    const video = parseVideo(href);
    const provider = video?.provider === 'vimeo' ? 'Vimeo' : video ? 'YouTube' : '';
    const play = Math.min(w, h) * 0.11,
      poster = h >= 96 ? h * 0.58 : h,
      cx = w / 2 + play * 0.06,
      cy = h / 2;
    const label = fitLine(title, w - pad * 2, 15);
    const source = fitLine(url, w - pad * 2, 12);
    return `${clip}<defs>
        <linearGradient id="${uid}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16494c"/><stop offset="1" stop-color="#103639"/></linearGradient>
        <radialGradient id="${uid}s" cx="50%" cy="50%" r="58%"><stop offset="0" stop-color="#05D9AB" stop-opacity=".2"/><stop offset="1" stop-color="#103639" stop-opacity="0"/></radialGradient>
        <linearGradient id="${uid}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#103639" stop-opacity="0"/><stop offset="1" stop-color="#103639" stop-opacity=".92"/></linearGradient>
      </defs>${cardLink(
        href,
        `<g clip-path="url(#${uid}p)">
        <rect width="${w}" height="${h}" fill="url(#${uid}g)"/><rect width="${w}" height="${h}" fill="url(#${uid}s)"/>
        <circle cx="${round(w / 2)}" cy="${round(cy)}" r="${round(play * 1.7)}" fill="#fff" fill-opacity=".1"/>
        <path d="M${round(cx - play * 0.36)} ${round(cy - play * 0.7)}L${round(cx + play * 0.7)} ${round(cy)}L${round(cx - play * 0.36)} ${round(cy + play * 0.7)}Z" fill="#fff"/>
        ${h >= 96 ? `<rect y="${round(poster)}" width="${w}" height="${round(h - poster)}" fill="url(#${uid}c)"/>` : ''}
        ${provider && h >= 120 ? `<text x="${pad}" y="${pad + 10}" fill="#05D9AB" font-family="${esc(face)}" font-size="11" font-weight="700">${provider}</text>` : ''}
        <text x="${pad}" y="${h - (source ? 28 : 16)}" fill="#fff" font-family="${esc(face)}" font-size="15" font-weight="700">${esc(label)}</text>
        ${source ? `<text x="${pad}" y="${h - 12}" fill="#B6C5C1" font-family="${esc(face)}" font-size="12">${esc(source)}</text>` : ''}
      </g>`,
      )}`;
  }
  const mediaH = h >= 118 ? Math.min(h * 0.48, h - 62) : 0;
  const media = item.media ? doc.media[item.media] : undefined;
  const mark = title.trim().slice(0, 1).toUpperCase() || '•';
  const preview = !mediaH
    ? ''
    : media
      ? `<image width="${w}" height="${mediaH}" href="${esc(media.src)}" preserveAspectRatio="xMidYMid slice"/>`
      : `<rect width="${w}" height="${mediaH}" fill="#8F93F914"/><text x="${w / 2}" y="${mediaH / 2 + 11}" text-anchor="middle" fill="#8F93F9" font-family="${esc(face)}" font-size="${Math.min(34, mediaH * 0.28)}" font-weight="700">${esc(mark)}</text>`;
  const body = mediaH ? mediaH + 20 : 24;
  const label = fitLine(title, w - pad * 2, 15);
  const source = fitLine(url, w - pad * 2, 12);
  const note =
    item.description && h - mediaH > 78 ? fitLine(item.description, w - pad * 2, 12) : '';
  const edge = theme === 'dark' ? '#ffffff14' : '#10363914';
  return `${clip}${cardLink(
    href,
    `<g clip-path="url(#${uid}p)">
      <rect width="${w}" height="${h}" fill="${color('paper', theme)}"/>${preview}
      <text x="${pad}" y="${body}" fill="${color('ink', theme)}" font-family="${esc(face)}" font-size="15" font-weight="700">${esc(label)}</text>
      ${source ? `<text x="${pad}" y="${body + 18}" fill="${color('slate', theme)}" font-family="${esc(face)}" font-size="12">${esc(source)}</text>` : ''}
      ${note ? `<text x="${pad}" y="${body + 36}" fill="${color('slate', theme)}" font-family="${esc(face)}" font-size="12">${esc(note)}</text>` : ''}
    </g><rect width="${w}" height="${h}" rx="${r}" fill="none" stroke="${edge}"/>`,
  )}`;
}

/** Create a portable SVG without scripts, foreignObject, or a DOM dependency. */
export function exportSVG(doc: AnnieDoc, items: Item[], options: SVGExportOptions = {}): string {
  const theme = options.theme ?? 'light';
  const all = allItems(doc);
  const lookup = new Map(all.map((item) => [item.id, item]));
  const kinds = createKindRegistry(options.kinds);
  const resolveOutline = (item: Item) => kinds.get(item.kind)?.outline?.(item);
  const hidden = new Set<string>();
  const walk = (nodes: Item[], inheritedHidden: boolean) => {
    for (const item of nodes) {
      if (inheritedHidden || item.hidden) hidden.add(item.id);
      if (item.children) walk(item.children, inheritedHidden || !!item.hidden);
    }
  };
  for (const page of doc.pages) walk(page.items, false);
  const seen = new Set<string>();
  const visible = flattenItems(items).filter((item) => {
    if (seen.has(item.id) || hidden.has(item.id) || item.hidden) return false;
    seen.add(item.id);
    return true;
  });
  const content =
    options.bounds ??
    (visible.length ? boundsOf(visible, lookup, resolveOutline) : { x: 0, y: 0, w: 800, h: 600 });
  const padding = Math.max(0, options.padding ?? 32);
  const box = {
    x: content.x - padding,
    y: content.y - padding - (options.labels ? 18 : 0),
    w: Math.max(1, content.w + padding * 2),
    h: Math.max(1, content.h + padding * 2 + (options.labels ? 18 : 0)),
  };
  const output: string[] = [];
  for (const [itemIndex, item] of visible.entries()) {
    let markup = '';
    const definition = kinds.get(item.kind);
    const connector =
      item.kind === 'connector' ? routeConnector(item, lookup, resolveOutline) : undefined;
    if (definition?.toSVG) {
      const custom = definition.toSVG(item, {
        doc,
        theme,
        color: (value) => color(value, theme),
        escape: esc,
      });
      markup = typeof custom === 'string' ? custom : new XMLSerializer().serializeToString(custom);
    } else if (
      ['rect', 'ellipse', 'diamond', 'note', 'line', 'path', 'connector'].includes(item.kind)
    ) {
      markup = shapeMarkup(item, theme, `export_${itemIndex}`, connector?.d);
      if (connector || item.kind === 'line')
        markup += headsMarkup(
          connector?.points ??
            (
              item.points ?? [
                [0, 0],
                [item.w, item.h],
              ]
            ).map(([x, y]) => ({ x, y })),
          item,
          theme,
        );
    } else if (item.kind === 'image') {
      const media = item.media ? doc.media[item.media] : undefined;
      const radius = Math.min(item.style?.corner ?? CARD_CORNER, item.w / 2, item.h / 2);
      const clip = `export_clip_${itemIndex}`;
      if (media) {
        const clipped =
          item.crop && item.crop.w > 0 && item.crop.h > 0
            ? `<svg width="${item.w}" height="${item.h}" viewBox="${item.crop.x} ${item.crop.y} ${item.crop.w} ${item.crop.h}" preserveAspectRatio="none" overflow="hidden"><image width="${media.w}" height="${media.h}" href="${esc(media.src)}" preserveAspectRatio="none"/></svg>`
            : `<image width="${item.w}" height="${item.h}" href="${esc(media.src)}" preserveAspectRatio="none"/>`;
        markup = `<defs><clipPath id="${clip}"><rect width="${item.w}" height="${item.h}" rx="${radius}"/></clipPath></defs><g clip-path="url(#${clip})">${clipped}</g>`;
      }
    } else if (item.kind === 'video' || item.kind === 'link') {
      markup = cardExport(item, theme, doc, itemIndex);
    } else if (!['text', 'group'].includes(item.kind)) {
      markup = `<rect width="${item.w}" height="${item.h}" rx="8" fill="${color('paper', theme)}" stroke="#8F93F9" stroke-dasharray="5 4"/><text x="12" y="24" fill="${color('ink', theme)}" font-family="${esc(fonts.sans)}" font-size="14">${esc(item.kind === 'html' ? 'HTML content' : `Unknown kind: ${item.kind}`)}</text>`;
    }
    if (item.kind !== 'video' && item.kind !== 'link')
      markup += textMarkup(item, theme, connector?.midpoint);
    if (options.labels) {
      const x = connector ? connector.bounds.x : 0,
        y = connector ? connector.bounds.y - 22 : -22;
      markup += `<rect x="${x}" y="${y}" width="${item.id.length * 6.6 + 12}" height="17" rx="4" fill="#103639"/><text x="${x + 6}" y="${y + 12}" fill="#FFFFFF" font-family="monospace" font-size="10">${esc(item.id)}</text>`;
    }
    const transform = connector
      ? ''
      : `translate(${item.x} ${item.y}) rotate(${item.rotation ?? 0} ${item.w / 2} ${item.h / 2})`;
    const group = `<g data-ad-id="${esc(item.id)}" data-ad-kind="${esc(item.kind)}"${transform ? ` transform="${transform}"` : ''}${item.style?.opacity !== undefined ? ` opacity="${item.style.opacity}"` : ''}><title>${esc(item.name ?? item.text?.value ?? item.kind)}</title>${markup}</g>`;
    output.push(group);
  }
  const background =
    options.background === false
      ? ''
      : color(typeof options.background === 'string' ? options.background : 'paper', theme);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${box.w}" height="${box.h}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" role="img" aria-label="${esc(doc.meta.title)}"><title>${esc(doc.meta.title)}</title>${background ? `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${esc(background)}"/>` : ''}${output.join('')}</svg>`;
}
