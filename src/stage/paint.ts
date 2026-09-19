import { getStroke } from 'perfect-freehand';
import type { Item, ItemText, Point, Style } from '../core/types';

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const fonts = {
  sans: 'Nunito Variable, Nunito, ui-rounded, system-ui, sans-serif',
  serif: 'Georgia, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  hand: 'Comic Sans MS, Chalkboard SE, cursive',
};
export const DEFAULT_FONT = 'hand' satisfies keyof typeof fonts;
export function fontFamily(font?: ItemText['font']): string {
  return fonts[font ?? DEFAULT_FONT];
}
const light: Record<string, string> = {
  ink: '#103639',
  slate: '#606062',
  coral: '#FF9302',
  amber: '#FFC68A',
  moss: '#AAF1AC',
  teal: '#05D9AB',
  sky: '#92CAFF',
  violet: '#8F93F9',
  rose: '#F89B97',
  paper: '#FFFFFF',
};
const dark: Record<string, string> = {
  ...light,
  ink: '#E9F7F3',
  slate: '#B6C5C1',
  paper: '#173D40',
};
export function color(value = 'ink', theme: 'light' | 'dark' = 'light'): string {
  return (theme === 'dark' ? dark : light)[value] ?? value;
}
function rgb(value: string): number[] | undefined {
  const named: Record<string, string> = {
    black: '#000000',
    white: '#ffffff',
    red: '#ff0000',
    blue: '#0000ff',
    green: '#008000',
    yellow: '#ffff00',
    transparent: '#00000000',
  };
  value = named[value.toLowerCase()] ?? value;
  if (/^#[\da-f]{3,4}$/i.test(value))
    value = `#${[...value.slice(1)].map((channel) => channel + channel).join('')}`;
  if (/^#[\da-f]{6}([\da-f]{2})?$/i.test(value))
    return [1, 3, 5]
      .map((index) => parseInt(value.slice(index, index + 2), 16))
      .concat(value.length === 9 ? parseInt(value.slice(7, 9), 16) / 255 : 1);
  if (!/^rgba?\(/i.test(value)) return undefined;
  const channels = value.match(/[\d.]+%?/g);
  if (!channels || channels.length < 3) return undefined;
  return channels
    .slice(0, 3)
    .map((channel) => parseFloat(channel) * (channel.endsWith('%') ? 2.55 : 1))
    .concat(
      channels[3] === undefined
        ? 1
        : parseFloat(channels[3]) / (channels[3].endsWith('%') ? 100 : 1),
    );
}
function luminance(channels: number[]): number {
  return channels
    .slice(0, 3)
    .map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}
/** Preserve explicit text colors and keep labels legible on opaque shape fills. */
export function labelColor(item: Item, theme: 'light' | 'dark'): string {
  if (item.kind === 'text') return color(item.style?.stroke ?? 'ink', theme);
  const ink = color('ink', theme),
    style = styleFor(item, theme);
  if (['connector', 'line'].includes(item.kind) || style.fillMode !== 'solid') return ink;
  const fill = rgb(style.fill);
  if (!fill) return ink;
  const paper = rgb(color('paper', theme))!;
  const background = luminance(
    fill.slice(0, 3).map((channel, index) => channel * fill[3] + paper[index] * (1 - fill[3])),
  );
  const contrast = (value: string) => {
    const foreground = luminance(rgb(value)!);
    return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
  };
  for (const candidate of [ink, color('ink', theme === 'dark' ? 'light' : 'dark')])
    if (contrast(candidate) >= 4.5) return candidate;
  return contrast('#0F0B0A') >= contrast('#FFFFFF') ? '#0F0B0A' : '#FFFFFF';
}
export function fontSize(text?: ItemText): number {
  return typeof text?.size === 'number'
    ? text.size
    : { s: 14, m: 18, l: 26, xl: 36 }[text?.size ?? 'm'];
}
export function esc(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}
export function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
export function pathFromPoints(points: Point[], closed = false): string {
  return (
    points
      .map((point, index) => `${index ? 'L' : 'M'}${round(point.x)},${round(point.y)}`)
      .join(' ') + (closed ? ' Z' : '')
  );
}
export function freehandPath(item: Item): string {
  const points = item.points ?? [];
  if (!points.length) return '';
  if (item.closed)
    return pathFromPoints(
      points.map(([x, y]) => ({ x, y })),
      true,
    );
  const stroke = getStroke(
    points.map(([x, y, pressure]) => ({ x, y, pressure })),
    {
      size: (item.style?.strokeWidth ?? 2) * 2.2,
      thinning: 0.45,
      smoothing: 0.6,
      streamline: 0.45,
      simulatePressure: points.every((point) => point[2] === undefined),
      last: true,
    },
  );
  if (!stroke.length) return '';
  return `M${stroke.map((point) => `${round(point[0])},${round(point[1])}`).join(' L')} Z`;
}
export function shapePath(item: Item): string {
  const w = item.w,
    h = item.h;
  if (item.kind === 'ellipse')
    return `M${w},${h / 2}a${w / 2},${h / 2} 0 1 0 ${-w},0a${w / 2},${h / 2} 0 1 0 ${w},0Z`;
  if (item.kind === 'diamond') return `M${w / 2},0L${w},${h / 2}L${w / 2},${h}L0,${h / 2}Z`;
  if (item.kind === 'line')
    return pathFromPoints(
      (
        item.points ?? [
          [0, 0],
          [w, h],
        ]
      ).map(([x, y]) => ({ x, y })),
    );
  if (item.kind === 'path') return freehandPath(item);
  const corner = Math.max(
    0,
    Math.min(item.style?.corner ?? (item.kind === 'note' ? 3 : 12), w / 2, h / 2),
  );
  return `M${corner},0H${w - corner}Q${w},0 ${w},${corner}V${h - corner}Q${w},${h} ${w - corner},${h}H${corner}Q0,${h} 0,${h - corner}V${corner}Q0,0 ${corner},0Z`;
}
export function styleFor(item: Item, theme: 'light' | 'dark'): Required<Style> {
  const fill = item.style?.fill ?? (item.kind === 'note' ? 'moss' : 'none');
  return {
    stroke: color(item.style?.stroke ?? 'ink', theme),
    strokeWidth: item.style?.strokeWidth ?? (item.kind === 'note' ? 0 : 2),
    dash: item.style?.dash ?? 'solid',
    fill: color(fill, theme),
    fillMode: item.style?.fillMode ?? 'solid',
    corner: item.style?.corner ?? 12,
    opacity: item.style?.opacity ?? 1,
  };
}
export function shapeMarkup(
  item: Item,
  theme: 'light' | 'dark',
  uid: string,
  path = shapePath(item),
): string {
  const style = styleFor(item, theme);
  const dash = style.dash === 'dashed' ? '8 6' : style.dash === 'dotted' ? '1 6' : '';
  const isPath = item.kind === 'path';
  const fill =
    item.kind === 'line' || item.kind === 'connector'
      ? 'none'
      : isPath
        ? item.closed && style.fill !== 'none'
          ? style.fill
          : style.stroke
        : style.fill;
  const hatchId = `ad_h_${uid.replace(/[^a-z0-9_-]/gi, '_')}`;
  const hatch = style.fillMode === 'hatch' && fill !== 'none' && !isPath;
  const defs = hatch
    ? `<defs><pattern id="${hatchId}" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M-2 2L2-2M0 8L8 0M6 10L10 6" fill="none" stroke="${esc(fill)}" stroke-opacity="0.5" stroke-width="1.3"/></pattern></defs>`
    : '';
  const fillAttr = hatch ? `url(#${hatchId})` : fill;
  const geometry = `<path d="${esc(path)}" fill="${esc(fillAttr)}"${style.fillMode === 'tint' && !isPath ? ' fill-opacity="0.22"' : ''} stroke="${isPath && !item.closed ? 'none' : esc(style.stroke)}" stroke-width="${style.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  return `${defs}${geometry}`;
}
export function headMarkup(
  point: Point,
  previous: Point,
  kind: 'arrow' | 'dot' | 'none' | undefined,
  stroke: string,
  width: number,
): string {
  if (!kind || kind === 'none') return '';
  if (kind === 'dot')
    return `<circle cx="${round(point.x)}" cy="${round(point.y)}" r="${Math.max(3, width * 2)}" fill="${esc(stroke)}"/>`;
  const angle = Math.atan2(point.y - previous.y, point.x - previous.x);
  const length = Math.max(10, width * 4.5);
  const spread = Math.PI / 6;
  const a = {
    x: point.x - Math.cos(angle - spread) * length,
    y: point.y - Math.sin(angle - spread) * length,
  };
  const b = {
    x: point.x - Math.cos(angle + spread) * length,
    y: point.y - Math.sin(angle + spread) * length,
  };
  return `<path d="${pathFromPoints([a, point, b])}" fill="none" stroke="${esc(stroke)}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
export function headsMarkup(points: Point[], item: Item, theme: 'light' | 'dark'): string {
  if (points.length < 2) return '';
  const style = styleFor(item, theme);
  return (
    headMarkup(points[0], points[1], item.heads?.start, style.stroke, style.strokeWidth) +
    headMarkup(
      points[points.length - 1],
      points[points.length - 2],
      item.heads?.end ?? (item.kind === 'connector' ? 'arrow' : 'none'),
      style.stroke,
      style.strokeWidth,
    )
  );
}
