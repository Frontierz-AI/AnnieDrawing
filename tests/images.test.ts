import { describe, expect, it } from 'vitest';
import { CATALOG_VERSION, KIND_CATALOG, createDoc, type Op } from '../src/core';
import { exportSVG } from '../src/porter/svg';

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgvBn6PwAE+QKJBZFmAAAAAElFTkSuQmCC';
const OTHER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const media = (w: number, h: number, src = PIXEL) => ({ mime: 'image/png', w, h, src });
const agent = { origin: 'agent:test' };

describe('image default size', () => {
  it('sizes an agent image without w and h from its media, set earlier in the same batch', () => {
    const doc = createDoc();
    const result = doc.apply(
      [
        { op: 'media.set', id: 'm', media: media(400, 600) },
        { op: 'add', item: { id: 'img', kind: 'image', media: 'm' } },
      ],
      agent,
    );
    expect(result.ok).toBe(true);
    const item = doc.get('img')!;
    expect(item.w / item.h).toBeCloseTo(2 / 3);
    expect([item.w, item.h]).toEqual([240, 360]);
    expect(item.fitMedia).toBe(true);
  });

  it('derives the missing side when only one is sent, and keeps explicit sizes', () => {
    const doc = createDoc();
    doc.apply([{ op: 'media.set', id: 'm', media: media(400, 600) }]);
    doc.apply(
      [
        { op: 'add', item: { id: 'w', kind: 'image', media: 'm', w: 300 } },
        { op: 'add', item: { id: 'h', kind: 'image', media: 'm', h: 300 } },
        { op: 'add', item: { id: 'both', kind: 'image', media: 'm', w: 100, h: 100 } },
      ],
      agent,
    );
    expect(doc.get('w')).toMatchObject({ w: 300, h: 450, fitMedia: true });
    expect(doc.get('h')).toMatchObject({ w: 200, h: 300, fitMedia: true });
    expect(doc.get('both')).toMatchObject({ w: 100, h: 100 });
    expect(doc.get('both')!.fitMedia).toBeUndefined();
  });

  it('applies to API adds and never enlarges a small picture', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'media.set', id: 'big', media: media(1600, 900) },
      { op: 'media.set', id: 'small', media: media(64, 32) },
      { op: 'add', item: { id: 'a', kind: 'image', media: 'big' } },
      { op: 'add', item: { id: 'b', kind: 'image', media: 'small' } },
    ]);
    expect(doc.get('a')).toMatchObject({ w: 480, h: 270 });
    expect(doc.get('b')).toMatchObject({ w: 64, h: 32 });
  });

  it('keeps the width and follows a new aspect ratio for derived sizes only, in one undo step', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'media.set', id: 'm', media: media(400, 600) },
      { op: 'add', item: { id: 'derived', kind: 'image', media: 'm' } },
      { op: 'add', item: { id: 'fixed', kind: 'image', media: 'm', x: 400, w: 200, h: 300 } },
    ]);
    const events: Op[][] = [];
    doc.on('change', (event) => events.push(event.ops));
    const result = doc.apply([{ op: 'media.set', id: 'm', media: media(600, 400) }], agent);
    expect(result.ok).toBe(true);
    expect(result.created).toEqual([]);
    expect(result.moved).toBeUndefined();
    expect(doc.get('derived')).toMatchObject({ w: 240, h: 160 });
    expect(doc.get('fixed')).toMatchObject({ w: 200, h: 300 });
    expect(events[0]).toContainEqual({
      op: 'set',
      id: 'derived',
      patch: { h: 160, fitMedia: true },
    });
    const log = doc.changesSince(0).changes.at(-1)!;
    expect(log.ops.some((op) => op.op === 'set' && op.id === 'derived')).toBe(true);
    expect(doc.undo()).toBe(true);
    expect(doc.get('derived')).toMatchObject({ w: 240, h: 360, fitMedia: true });
    expect(doc.toJSON().media.m.w).toBe(400);
    expect(doc.redo()).toBe(true);
    expect(doc.get('derived')).toMatchObject({ w: 240, h: 160, fitMedia: true });
    expect(doc.toJSON().media.m.w).toBe(600);
  });

  it('an explicit resize ends the derived size, and undo restores it', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'media.set', id: 'm', media: media(400, 600) },
      { op: 'add', item: { id: 'img', kind: 'image', media: 'm' } },
    ]);
    doc.apply([{ op: 'set', id: 'img', patch: { w: 300, h: 300 } }], { origin: 'user' });
    expect(doc.get('img')!.fitMedia).toBeUndefined();
    doc.apply([{ op: 'media.set', id: 'm', media: media(600, 400) }]);
    expect(doc.get('img')).toMatchObject({ w: 300, h: 300 });
    doc.undo();
    doc.undo();
    expect(doc.get('img')).toMatchObject({ w: 240, h: 360, fitMedia: true });
  });

  it('survives toJSON and load', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'media.set', id: 'm', media: media(400, 600) },
      { op: 'add', item: { id: 'img', kind: 'image', media: 'm' } },
    ]);
    const copy = createDoc(doc.toJSON());
    copy.apply([{ op: 'media.set', id: 'm', media: media(800, 400) }]);
    expect(copy.get('img')).toMatchObject({ w: 240, h: 120 });
  });
});

describe('media swap', () => {
  it('updates every item that uses the key, keeps ids and bound connectors, creates nothing', () => {
    const doc = createDoc();
    doc.apply(
      [
        { op: 'media.set', id: 'm', media: media(400, 300) },
        { op: 'add', item: { id: 'a', kind: 'image', media: 'm', x: 0, y: 0, w: 200, h: 150 } },
        { op: 'add', item: { id: 'b', kind: 'image', media: 'm', x: 400, y: 0, w: 200, h: 150 } },
        { op: 'add', item: { id: 'c', kind: 'connector', from: 'a', to: 'b' } },
      ],
      agent,
    );
    const before = doc.get('c');
    const result = doc.apply([{ op: 'media.set', id: 'm', media: media(400, 300, OTHER) }], agent);
    expect(result.ok).toBe(true);
    expect(result.created).toEqual([]);
    expect(doc.toJSON().media.m.src).toBe(OTHER);
    expect(doc.query({ kind: 'image' }).map((item) => [item.id, item.media])).toEqual([
      ['a', 'm'],
      ['b', 'm'],
    ]);
    expect(doc.get('c')).toEqual(before);
  });
});

describe('pending images', () => {
  const add = (extra: Record<string, unknown> = {}): Op => ({
    op: 'add',
    item: { id: 'img_1', kind: 'image', pending: true, name: 'Team at a whiteboard', ...extra },
  });

  it('allows a missing media key only while pending, and validates progress', () => {
    const doc = createDoc();
    expect(doc.apply([add({ w: 320, h: 213 })], agent).ok).toBe(true);
    expect(doc.apply([{ op: 'set', id: 'img_1', patch: { progress: 0.54 } }], agent).ok).toBe(true);
    expect(doc.get('img_1')!.progress).toBe(0.54);
    const high = doc.apply([{ op: 'set', id: 'img_1', patch: { progress: 1.5 } }], agent);
    expect(high.ok).toBe(false);
    expect(doc.apply([{ op: 'set', id: 'img_1', patch: { progress: -0.1 } }], agent).ok).toBe(
      false,
    );
    const done = doc.apply([{ op: 'set', id: 'img_1', patch: { pending: false } }], agent);
    expect(done.ok).toBe(false);
    expect(done.errors[0].message).toMatch(/missing media/);
    const plain = createDoc().apply([{ op: 'add', item: { id: 'x', kind: 'image' } }]);
    expect(plain.ok).toBe(false);
    expect(createDoc().apply([add({ progress: 2 })], agent).ok).toBe(false);
  });

  it('accepts an arrow in the same batch, round-trips, and resolves without changing its id', () => {
    const doc = createDoc();
    const first = doc.apply(
      [
        { op: 'add', item: { id: 'idea', kind: 'rect', text: 'Idea' } },
        add({ w: 320, h: 213 }),
        { op: 'add', item: { id: 'link', kind: 'arrow', from: 'idea', to: 'img_1' } },
      ],
      agent,
    );
    expect(first.ok).toBe(true);
    expect(first.created).toContain('img_1');
    expect(doc.describe()).toContain('img_1 image (pending) "Team at a whiteboard"');
    const json = doc.toJSON();
    expect(json.pages[0].items.find((item) => item.id === 'img_1')).toMatchObject({
      pending: true,
      name: 'Team at a whiteboard',
    });
    const copy = createDoc(json);
    const resolved = copy.apply(
      [
        { op: 'media.set', id: 'm_1', media: { ...media(1536, 1024), mime: 'image/jpeg' } },
        { op: 'set', id: 'img_1', patch: { media: 'm_1', pending: false } },
      ],
      agent,
    );
    expect(resolved.ok).toBe(true);
    expect(resolved.created).toEqual([]);
    expect(copy.get('img_1')).toMatchObject({ media: 'm_1', pending: false, w: 320, h: 213 });
    expect(copy.get('link')!.to).toMatchObject({ item: 'img_1' });
    expect(copy.describe()).not.toContain('(pending)');
    expect(copy.undo()).toBe(true);
    expect(copy.get('img_1')).toMatchObject({ pending: true });
    expect(copy.get('img_1')!.media).toBeUndefined();
    expect(copy.toJSON().media.m_1).toBeUndefined();
    expect(copy.redo()).toBe(true);
    expect(copy.get('img_1')).toMatchObject({ media: 'm_1', pending: false });
  });

  it('a pending image sent without a size takes its height from the media when resolved', () => {
    const doc = createDoc();
    doc.apply([add()], agent);
    expect(doc.get('img_1')).toMatchObject({ w: 240, h: 180, fitMedia: true });
    doc.apply(
      [
        { op: 'media.set', id: 'm_1', media: media(1000, 1000) },
        { op: 'set', id: 'img_1', patch: { media: 'm_1', pending: false } },
      ],
      agent,
    );
    expect(doc.get('img_1')).toMatchObject({ w: 240, h: 240 });
    doc.undo();
    expect(doc.get('img_1')).toMatchObject({ w: 240, h: 180, pending: true });
  });

  it('exports pending and missing pictures as labeled placeholders', () => {
    const doc = createDoc();
    doc.apply(
      [
        add({ x: 0, y: 0, w: 320, h: 213, progress: 0.5 }),
        { op: 'media.set', id: 'm', media: media(10, 10) },
        { op: 'add', item: { id: 'ok', kind: 'image', media: 'm', x: 400, y: 0, w: 10, h: 10 } },
      ],
      agent,
    );
    const json = doc.toJSON({ compact: false });
    const items = json.pages[0].items;
    const svg = exportSVG(json, items);
    expect(svg).toContain('Team at a whiteboard');
    expect(svg).toContain('stroke-dasharray="5 4"');
    expect(svg).toContain(`width="154"`);
    expect(svg).toContain(`href="${PIXEL}"`);
    const missing = exportSVG({ ...json, media: {} }, items.slice(1));
    expect(missing).toContain('stroke-dasharray="5 4"');
    expect(missing).not.toContain('<image');
  });

  it('bumps the catalog for image', () => {
    expect(CATALOG_VERSION).toBe(4);
    expect(KIND_CATALOG.find((entry) => entry.kind === 'image')!.since).toBe(4);
  });
});
