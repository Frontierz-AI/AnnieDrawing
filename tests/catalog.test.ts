import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATALOG_VERSION, DEFAULT_SIZES, KIND_CATALOG, createDoc, kindsSince } from '../src/core';
import { getKind } from '../src/kinds';

const kindNames = KIND_CATALOG.map((entry) => entry.kind);
const llmSources = ['llms.txt', 'docs/board-js.md'].map((path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'),
);

describe('kind catalog', () => {
  it('lists every built-in kind once, with sizes that match defaults', () => {
    expect(kindNames).toEqual([
      'rect',
      'ellipse',
      'diamond',
      'line',
      'connector',
      'path',
      'text',
      'note',
      'image',
      'video',
      'link',
      'group',
      'html',
    ]);
    expect(new Set(kindNames).size).toBe(kindNames.length);
    expect(Object.keys(DEFAULT_SIZES)).toEqual(kindNames);
    for (const kind of kindNames) expect(getKind(kind)?.kind).toBe(kind);
    for (const entry of KIND_CATALOG) {
      expect(DEFAULT_SIZES[entry.kind]).toEqual([entry.w, entry.h]);
      expect(entry.since).toBeGreaterThan(0);
      expect(entry.since).toBeLessThanOrEqual(CATALOG_VERSION);
      expect(entry.note.length).toBeGreaterThan(8);
    }
  });

  it('returns every kind from the beginning and only later kinds after a version', () => {
    expect(kindsSince()).toEqual(kindsSince(0));
    expect(kindsSince().version).toBe(CATALOG_VERSION);
    expect(kindsSince().since).toBe(0);
    expect(kindsSince().kinds.map((entry) => entry.kind)).toEqual(kindNames);
    expect(kindsSince(1).kinds.map((entry) => entry.kind)).toEqual([
      'rect',
      'ellipse',
      'diamond',
      'connector',
      'text',
      'note',
    ]);
    expect(kindsSince(CATALOG_VERSION)).toEqual({
      version: CATALOG_VERSION,
      since: CATALOG_VERSION,
      kinds: [],
    });
    expect(
      createDoc()
        .kindsSince(0)
        .kinds.map((entry) => entry.kind),
    ).toEqual(kindNames);
  });

  it('keeps the LLM board-JS guides aligned with the catalog', () => {
    for (const text of llmSources) {
      expect(text).toContain(`Kind catalog: ${CATALOG_VERSION}`);
      expect(text).toMatch(/kindsSince/);
      expect(text.toLowerCase()).not.toContain('npm run');
      expect(text.toLowerCase()).not.toContain('npm ci');
      for (const kind of kindNames) expect(text).toContain(`\`${kind}\``);
    }
  });
});
