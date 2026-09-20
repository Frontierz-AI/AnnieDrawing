/** Rasterise a completed SVG; this is the library's only canvas use. */
import { VISION_PNG } from '../core/schema';
import { encodeIndexedPng, paintIndices, quantizeRgba } from './indexedPng';
export type RasterFormat = 'png' | 'jpeg' | 'webp';
const MIME: Record<RasterFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
const QUALITY_STEPS = [0.85, 0.7, 0.55, 0.4];
export async function exportPNG(svg: string, scale = 2): Promise<Blob> {
  return exportRaster(svg, { format: 'png', scale });
}
export async function exportRaster(
  svg: string,
  options: {
    format: RasterFormat;
    scale?: number;
    maxSide?: number;
    maxBytes?: number;
    quality?: number;
    colors?: number;
  },
): Promise<Blob> {
  const format = options.format;
  if (typeof document === 'undefined')
    throw new Error(
      `${format.toUpperCase()} export requires a browser. Use SVG export in headless environments.`,
    );
  let scale = options.scale ?? 2;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 8)
    throw new Error(
      `${format.toUpperCase()} scale must be greater than zero and no greater than 8.`,
    );
  const palette = format === 'png' && options.colors !== undefined ? options.colors : undefined;
  if (palette !== undefined && (!Number.isInteger(palette) || palette < 2 || palette > 256))
    throw new Error('PNG colors must be an integer from 2 to 256.');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(
          new Error(
            'This drawing could not be rasterised. Export SVG instead, or embed external images as data URLs.',
          ),
        );
      image.src = url;
    });
    const naturalWidth = Math.max(1, image.naturalWidth);
    const naturalHeight = Math.max(1, image.naturalHeight);
    if (options.maxSide && Number.isFinite(options.maxSide) && options.maxSide > 0) {
      const longest = Math.max(naturalWidth * scale, naturalHeight * scale);
      if (longest > options.maxSide) scale *= options.maxSide / longest;
    }
    const qualities =
      format === 'png'
        ? [1]
        : [
            Math.min(1, Math.max(0.1, options.quality ?? 0.85)),
            ...QUALITY_STEPS.filter((step) => step < (options.quality ?? 0.85)),
          ];
    const encode = async (nextScale: number, quality: number, colors?: number) => {
      const width = Math.max(1, Math.ceil(naturalWidth * nextScale));
      const height = Math.max(1, Math.ceil(naturalHeight * nextScale));
      if (width > 16384 || height > 16384 || width * height > 64_000_000)
        throw new Error(
          `${format.toUpperCase()} is too large. Export a smaller selection or reduce the scale.`,
        );
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', colors ? { willReadFrequently: true } : undefined);
      if (!context)
        throw new Error(`This browser does not support ${format.toUpperCase()} export.`);
      context.drawImage(image, 0, 0, width, height);
      if (format === 'png' && colors) {
        const pixels = context.getImageData(0, 0, width, height);
        const quantized = quantizeRgba(pixels.data, colors);
        try {
          return await encodeIndexedPng(width, height, quantized.palette, quantized.indices);
        } catch {
          paintIndices(pixels.data, quantized.palette, quantized.indices);
          context.putImageData(pixels, 0, 0);
        }
      }
      return await new Promise<Blob>((resolve, reject) => {
        try {
          canvas.toBlob(
            (blob) =>
              blob
                ? resolve(blob)
                : reject(new Error(`The browser could not encode this ${format.toUpperCase()}.`)),
            MIME[format],
            format === 'png' ? undefined : quality,
          );
        } catch {
          reject(
            new Error(
              `An external image prevents ${format.toUpperCase()} export. Embed images as data URLs or export SVG.`,
            ),
          );
        }
      });
    };
    if (!options.maxBytes) return encode(scale, qualities[0], palette);
    let smallest: Blob | undefined;
    let nextScale = scale;
    const consider = (blob: Blob) => {
      if (!smallest || blob.size < smallest.size) smallest = blob;
      return blob.size <= options.maxBytes!;
    };
    while (nextScale >= 0.25 - 1e-9) {
      if (format === 'png') {
        if (palette === undefined && (await consider(await encode(nextScale, 1)))) return smallest!;
        if (await consider(await encode(nextScale, 1, palette ?? VISION_PNG.colors)))
          return smallest!;
      } else {
        for (const quality of qualities) {
          if (await consider(await encode(nextScale, quality))) return smallest!;
        }
      }
      const halved = nextScale / 2;
      if (halved < 0.25 - 1e-9) break;
      nextScale = halved;
    }
    return smallest ?? encode(scale, qualities[0], palette);
  } finally {
    URL.revokeObjectURL(url);
  }
}
