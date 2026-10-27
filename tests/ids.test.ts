import { afterEach, describe, expect, it, vi } from 'vitest';
import { itemId, mediaId, pageId, uniqueItemId } from '../src/core/ids';

afterEach(() => vi.unstubAllGlobals());

function stubRandomBytes(bytes: number[]) {
  let index = 0;
  const getRandomValues = vi.fn((target: Uint8Array) => {
    for (let offset = 0; offset < target.length; offset++) {
      if (index >= bytes.length) throw new Error('Random byte fixture exhausted');
      target[offset] = bytes[index++];
    }
    return target;
  });
  vi.stubGlobal('crypto', { getRandomValues });
  return getRandomValues;
}

describe('document IDs', () => {
  it('keeps the public prefixes and six-character alphabet with native Web Crypto', () => {
    for (let index = 0; index < 32; index++) {
      expect(itemId()).toMatch(/^i_[346789abcdefghjkmnpqrtwxyz]{6}$/);
      expect(pageId()).toMatch(/^p_[346789abcdefghjkmnpqrtwxyz]{6}$/);
      expect(mediaId()).toMatch(/^m_[346789abcdefghjkmnpqrtwxyz]{6}$/);
    }
  });

  it('rejects bytes outside the uniform range and draws again to complete an ID', () => {
    const random = stubRandomBytes([234, 255, 0, 25, 26, 233, 1, 232, 0, 0, 0, 0]);
    expect(itemId()).toBe('i_3z3z4y');
    expect(random).toHaveBeenCalledTimes(2);
  });

  it('gives each alphabet character the same number of accepted byte values', () => {
    stubRandomBytes(Array.from({ length: 234 }, (_, index) => index));
    const counts = new Map<string, number>();
    for (let index = 0; index < 39; index++) {
      for (const character of itemId().slice(2)) {
        counts.set(character, (counts.get(character) ?? 0) + 1);
      }
    }
    expect([...counts.keys()].join('')).toBe('346789abcdefghjkmnpqrtwxyz');
    expect([...counts.values()]).toEqual(Array(26).fill(9));
  });

  it('can be imported without Web Crypto and never falls back to an insecure generator', async () => {
    vi.stubGlobal('crypto', undefined);
    vi.resetModules();
    const ids = await import('../src/core/ids');
    expect(ids.uniqueItemId('supplied', new Set())).toBe('supplied');
    expect(() => ids.itemId()).toThrow();
  });

  it('preserves supplied IDs and the existing collision suffix and length rules', () => {
    expect(uniqueItemId('custom', new Set())).toBe('custom');
    expect(uniqueItemId('custom', new Set(['custom', 'custom_1']))).toBe('custom_2');
    expect(uniqueItemId('custom_7', new Set(['custom_7', 'custom_1']))).toBe('custom_2');
    const long = 'a'.repeat(160);
    expect(uniqueItemId(long, new Set())).toBe(long);
    expect(uniqueItemId(long, new Set([long]))).toBe(`${'a'.repeat(158)}_1`);
  });
});
