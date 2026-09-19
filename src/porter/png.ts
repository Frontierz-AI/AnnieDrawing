/** Rasterise a completed SVG; this is the library's only canvas use. */
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
  },
): Promise<Blob> {
  const format = options.format;
  if (typeof document === 'undefined')
    throw new Error(
      `${format.toUpperCase()} export requires a browser. Use SVG export in headless environments.`,
    );
  let scale = options.scale ?? 2;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 8)
    throw new Error(`${format.toUpperCase()} scale must be greater than zero and no greater than 8.`);
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
    const encode = async (nextScale: number, quality: number) => {
      const width = Math.max(1, Math.ceil(naturalWidth * nextScale));
      const height = Math.max(1, Math.ceil(naturalHeight * nextScale));
      if (width > 16384 || height > 16384 || width * height > 64_000_000)
        throw new Error(`${format.toUpperCase()} is too large. Export a smaller selection or reduce the scale.`);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error(`This browser does not support ${format.toUpperCase()} export.`);
      context.drawImage(image, 0, 0, width, height);
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
    if (!options.maxBytes) return encode(scale, qualities[0]);
    let smallest: Blob | undefined;
    let nextScale = scale;
    while (nextScale >= 0.25 - 1e-9) {
      for (const quality of qualities) {
        const blob = await encode(nextScale, quality);
        if (!smallest || blob.size < smallest.size) smallest = blob;
        if (blob.size <= options.maxBytes) return smallest;
      }
      const halved = nextScale / 2;
      if (halved < 0.25 - 1e-9) break;
      nextScale = halved;
    }
    return smallest ?? encode(scale, qualities[0]);
  } finally {
    URL.revokeObjectURL(url);
  }
}
