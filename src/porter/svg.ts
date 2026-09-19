import type { AnnieDoc, Box, ExportOptions, Item } from '../core/types';
import { boundsOf, flattenItems, routeConnector } from '../geo/index';
import { createKindRegistry, type KindDef } from '../kinds/registry';
import { color, esc, fonts, fontSize, headsMarkup, shapeMarkup, labelColor } from '../stage/paint';

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
  return `${label}<text x="${x}" y="${y}" font-family="${esc(fonts[item.text.font ?? 'sans'])}" font-size="${size}" text-anchor="${connectorPoint ? 'middle' : anchor}" fill="${esc(labelColor(item, theme))}">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${esc(line) || '&#160;'}</tspan>`).join('')}</text>`;
}

/** Create a portable SVG without scripts, foreignObject, or a DOM dependency. */
export function exportSVG(doc: AnnieDoc, items: Item[], options: SVGExportOptions = {}): string {
  const theme = options.theme ?? 'light';
  const all = flattenItems(doc.pages.flatMap((page) => page.items));
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
      if (media) {
        if (item.crop && item.crop.w > 0 && item.crop.h > 0) {
          markup = `<svg width="${item.w}" height="${item.h}" viewBox="${item.crop.x} ${item.crop.y} ${item.crop.w} ${item.crop.h}" preserveAspectRatio="none" overflow="hidden"><image width="${media.w}" height="${media.h}" href="${esc(media.src)}" preserveAspectRatio="none"/></svg>`;
        } else
          markup = `<image width="${item.w}" height="${item.h}" href="${esc(media.src)}" preserveAspectRatio="none"/>`;
      }
    } else if (!['text', 'group'].includes(item.kind)) {
      markup = `<rect width="${item.w}" height="${item.h}" rx="8" fill="${color('paper', theme)}" stroke="#8F93F9" stroke-dasharray="5 4"/><text x="12" y="24" fill="${color('ink', theme)}" font-family="${esc(fonts.sans)}" font-size="14">${esc(item.kind === 'html' ? 'HTML content' : `Unknown kind: ${item.kind}`)}</text>`;
    }
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
