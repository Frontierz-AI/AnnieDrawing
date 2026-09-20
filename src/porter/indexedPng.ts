/** Palette PNG for vision budgets. Browser `toBlob('image/png')` cannot write indexed files. */
export type PaletteColor = { r: number; g: number; b: number; a: number };
type Counted = PaletteColor & { n: number };

const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c;
}

function crc32(parts: Uint8Array[]) {
  let c = ~0;
  for (const part of parts) for (const byte of part) c = CRC[(c ^ byte) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

function u32(value: number) {
  return Uint8Array.of(
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  );
}

function chunk(type: string, data: Uint8Array) {
  const name = Uint8Array.of(
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3),
  );
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length));
  out.set(name, 4);
  out.set(data, 8);
  out.set(u32(crc32([name, data])), 8 + data.length);
  return out;
}

function rgbaKey(r: number, g: number, b: number, a: number) {
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

function collect(data: Uint8ClampedArray): { colors: Counted[]; exact: boolean } {
  const map = new Map<number, Counted>();
  for (let i = 0; i < data.length; i += 4) {
    const key = rgbaKey(data[i], data[i + 1], data[i + 2], data[i + 3]);
    const hit = map.get(key);
    if (hit) hit.n++;
    else {
      if (map.size >= 4096) return { colors: collectWide(data), exact: false };
      map.set(key, { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3], n: 1 });
    }
  }
  return { colors: [...map.values()], exact: true };
}

function collectWide(data: Uint8ClampedArray): Counted[] {
  const counts = new Uint32Array(32768);
  let transparent = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) {
      transparent++;
      continue;
    }
    counts[((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)]++;
  }
  const colors: Counted[] = [];
  if (transparent) colors.push({ r: 0, g: 0, b: 0, a: 0, n: transparent });
  for (let key = 0; key < 32768; key++) {
    const n = counts[key];
    if (!n) continue;
    const r = (key >> 10) << 3,
      g = ((key >> 5) & 31) << 3,
      b = (key & 31) << 3;
    colors.push({ r: r | (r >> 5), g: g | (g >> 5), b: b | (b >> 5), a: 255, n });
  }
  return colors;
}

function channelOf(colors: Counted[]): 'r' | 'g' | 'b' | 'a' {
  let r0 = 255,
    r1 = 0,
    g0 = 255,
    g1 = 0,
    b0 = 255,
    b1 = 0,
    a0 = 255,
    a1 = 0;
  for (const color of colors) {
    if (color.r < r0) r0 = color.r;
    if (color.r > r1) r1 = color.r;
    if (color.g < g0) g0 = color.g;
    if (color.g > g1) g1 = color.g;
    if (color.b < b0) b0 = color.b;
    if (color.b > b1) b1 = color.b;
    if (color.a < a0) a0 = color.a;
    if (color.a > a1) a1 = color.a;
  }
  const r = r1 - r0,
    g = g1 - g0,
    b = b1 - b0,
    a = a1 - a0;
  if (r >= g && r >= b && r >= a) return 'r';
  if (g >= b && g >= a) return 'g';
  return b >= a ? 'b' : 'a';
}

function average(colors: Counted[]): PaletteColor {
  let r = 0,
    g = 0,
    b = 0,
    a = 0,
    n = 0;
  for (const color of colors) {
    r += color.r * color.n;
    g += color.g * color.n;
    b += color.b * color.n;
    a += color.a * color.n;
    n += color.n;
  }
  return {
    r: Math.round(r / n),
    g: Math.round(g / n),
    b: Math.round(b / n),
    a: Math.round(a / n),
  };
}

function medianCut(colors: Counted[], maxColors: number): PaletteColor[] {
  if (colors.length <= maxColors) return colors.map(({ r, g, b, a }) => ({ r, g, b, a }));
  const boxes = [colors];
  while (boxes.length < maxColors) {
    let best = -1,
      bestRange = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      const channel = channelOf(boxes[i]);
      let min = 255,
        max = 0;
      for (const color of boxes[i]) {
        const value = color[channel];
        if (value < min) min = value;
        if (value > max) max = value;
      }
      const range = max - min;
      if (range > bestRange) {
        bestRange = range;
        best = i;
      }
    }
    if (best < 0) break;
    const box = boxes[best];
    const channel = channelOf(box);
    box.sort((left, right) => left[channel] - right[channel]);
    let total = 0;
    for (const color of box) total += color.n;
    let seen = 0,
      split = Math.max(1, box.length >> 1);
    for (let i = 0; i < box.length - 1; i++) {
      seen += box[i].n;
      if (seen >= total / 2) {
        split = i + 1;
        break;
      }
    }
    boxes[best] = box.slice(0, split);
    boxes.push(box.slice(split));
  }
  return boxes.map(average);
}

function nearest(palette: PaletteColor[], r: number, g: number, b: number, a: number) {
  let best = 0,
    bestDistance = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const color = palette[i];
    const distance =
      (r - color.r) ** 2 + (g - color.g) ** 2 + (b - color.b) ** 2 + (a - color.a) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

export function paintIndices(
  data: Uint8ClampedArray,
  palette: PaletteColor[],
  indices: Uint8Array,
) {
  for (let i = 0, pixel = 0; i < indices.length; i++, pixel += 4) {
    const color = palette[indices[i]];
    data[pixel] = color.r;
    data[pixel + 1] = color.g;
    data[pixel + 2] = color.b;
    data[pixel + 3] = color.a;
  }
}

export function quantizeRgba(data: Uint8ClampedArray, maxColors: number) {
  const limit = Math.min(256, Math.max(1, Math.trunc(maxColors)));
  const { colors, exact } = collect(data);
  const palette =
    exact && colors.length <= limit
      ? colors.map(({ r, g, b, a }) => ({ r, g, b, a }))
      : medianCut(colors, limit);
  const indices = new Uint8Array(data.length / 4);
  if (exact && colors.length <= limit) {
    const lookup = new Map<number, number>();
    for (let i = 0; i < palette.length; i++) {
      const color = palette[i];
      lookup.set(rgbaKey(color.r, color.g, color.b, color.a), i);
    }
    for (let i = 0, pixel = 0; i < indices.length; i++, pixel += 4)
      indices[i] = lookup.get(
        rgbaKey(data[pixel], data[pixel + 1], data[pixel + 2], data[pixel + 3]),
      )!;
  } else {
    const cache = new Map<number, number>();
    for (let i = 0, pixel = 0; i < indices.length; i++, pixel += 4) {
      const key = rgbaKey(data[pixel], data[pixel + 1], data[pixel + 2], data[pixel + 3]);
      let index = cache.get(key);
      if (index === undefined) {
        index = nearest(palette, data[pixel], data[pixel + 1], data[pixel + 2], data[pixel + 3]);
        cache.set(key, index);
      }
      indices[i] = index;
    }
  }
  return { palette, indices };
}

async function zlib(bytes: Uint8Array) {
  if (typeof CompressionStream !== 'function') throw new Error('CompressionStream is unavailable.');
  const body = new Response(bytes as BodyInit).body;
  if (!body) throw new Error('CompressionStream is unavailable.');
  return new Uint8Array(
    await new Response(body.pipeThrough(new CompressionStream('deflate'))).arrayBuffer(),
  );
}

export async function encodeIndexedPng(
  width: number,
  height: number,
  palette: PaletteColor[],
  indices: Uint8Array,
): Promise<Blob> {
  if (width < 1 || height < 1 || palette.length < 1 || palette.length > 256)
    throw new Error('Indexed PNG dimensions or palette are invalid.');
  if (indices.length !== width * height) throw new Error('Indexed PNG indices do not match size.');
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(width));
  ihdr.set(u32(height), 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  const plte = new Uint8Array(palette.length * 3);
  let lastAlpha = -1;
  for (let i = 0; i < palette.length; i++) {
    plte[i * 3] = palette[i].r;
    plte[i * 3 + 1] = palette[i].g;
    plte[i * 3 + 2] = palette[i].b;
    if (palette[i].a < 255) lastAlpha = i;
  }
  const rows = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width + 1);
    rows[row] = 0;
    rows.set(indices.subarray(y * width, (y + 1) * width), row + 1);
  }
  const parts = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
  ];
  if (lastAlpha >= 0) {
    const trns = new Uint8Array(lastAlpha + 1);
    for (let i = 0; i <= lastAlpha; i++) trns[i] = palette[i].a;
    parts.push(chunk('tRNS', trns));
  }
  parts.push(chunk('IDAT', await zlib(rows)), chunk('IEND', new Uint8Array()));
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return new Blob([out], { type: 'image/png' });
}
