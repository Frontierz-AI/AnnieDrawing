import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodeIndexedPng, quantizeRgba } from '../src/porter/indexedPng';

function chunks(bytes: Uint8Array) {
  const out: { type: string; data: Uint8Array }[] = [];
  for (let i = 8; i < bytes.length;) {
    const length = (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    out.push({ type, data: bytes.subarray(i + 8, i + 8 + length) });
    i += 12 + length;
  }
  return out;
}

describe('indexed PNG', () => {
  it('quantizes to at most the requested colors', () => {
    const data = new Uint8ClampedArray([
      255, 0, 0, 255, 250, 2, 2, 255, 0, 0, 255, 255, 4, 0, 250, 255,
    ]);
    const { palette, indices } = quantizeRgba(data, 2);
    expect(palette.length).toBeLessThanOrEqual(2);
    expect(new Set(indices).size).toBeLessThanOrEqual(2);
    expect(indices).toHaveLength(4);
  });

  it('keeps an exact palette when the source already fits', () => {
    const data = new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, 255, 200, 10, 10, 255]);
    const { palette, indices } = quantizeRgba(data, 32);
    expect(palette).toEqual([
      { r: 10, g: 20, b: 30, a: 255 },
      { r: 200, g: 10, b: 10, a: 255 },
    ]);
    expect([...indices]).toEqual([0, 0, 1]);
  });

  it('writes an indexed PNG whose IDAT inflates to the source indices', async () => {
    const palette = [
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 0, g: 0, b: 255, a: 128 },
    ];
    const indices = new Uint8Array([0, 1, 1, 0]);
    const blob = await encodeIndexedPng(2, 2, palette, indices);
    expect(blob.type).toBe('image/png');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes[25]).toBe(3);
    const parsed = chunks(bytes);
    expect(parsed.map((chunk) => chunk.type)).toEqual(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
    expect([...parsed[2].data]).toEqual([255, 128]);
    const scan = inflateSync(Buffer.from(parsed[3].data));
    expect([...scan]).toEqual([0, 0, 1, 0, 1, 0]);
  });
});
