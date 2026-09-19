/** Rasterise a completed SVG; this is the library's only canvas use. */
export async function exportPNG(svg: string, scale = 2): Promise<Blob> {
  if (typeof document === 'undefined')
    throw new Error('PNG export requires a browser. Use SVG export in headless environments.');
  if (!Number.isFinite(scale) || scale <= 0 || scale > 8)
    throw new Error('PNG scale must be greater than zero and no greater than 8.');
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
    const width = Math.max(1, Math.ceil(image.naturalWidth * scale));
    const height = Math.max(1, Math.ceil(image.naturalHeight * scale));
    if (width > 16384 || height > 16384 || width * height > 64_000_000)
      throw new Error('PNG is too large. Export a smaller selection or reduce the scale.');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser does not support PNG export.');
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      try {
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error('The browser could not encode this PNG.')),
          'image/png',
        );
      } catch {
        reject(
          new Error(
            'An external image prevents PNG export. Embed images as data URLs or export SVG.',
          ),
        );
      }
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
