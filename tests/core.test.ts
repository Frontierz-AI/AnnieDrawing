import { describe, expect, it } from 'vitest';
import {
  createDoc,
  defaultDoc,
  migrate,
  type AnnieDoc,
  type ChangeEvent,
  type Op,
} from '../src/core';
const rect = (id: string, x = 0, y = 0) => ({ kind: 'rect' as const, id, x, y, w: 100, h: 80 });
describe('atomic document operations', () => {
  it('commits a referenced scene atomically and exposes only defensive copies', () => {
    const doc = createDoc();
    const events: ChangeEvent[] = [];
    doc.on('change', (event) => events.push(event));
    expect(
      doc.apply(
        [
          { op: 'add', item: rect('a') },
          { op: 'add', item: rect('b', 250) },
          {
            op: 'add',
            item: { id: 'c', kind: 'connector', from: { item: 'a' }, to: { item: 'b' } },
          },
        ],
        { origin: 'agent:test' },
      ).ok,
    ).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].origin).toBe('agent:test');
    const copy = doc.get('a')!;
    copy.x = 999;
    expect(doc.get('a')!.x).toBe(0);
    const json = doc.toJSON();
    json.meta.title = 'Changed';
    expect(doc.toJSON().meta.title).not.toBe('Changed');
  });
  it('rolls back every operation when a later operation fails', () => {
    const doc = createDoc(),
      before = doc.toJSON();
    const result = doc.apply([
      { op: 'add', item: rect('a') },
      { op: 'set', id: 'missing', patch: { x: 90 } },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors[0].index).toBe(1);
    expect(result.errors[0].message).toContain('Known ids: a');
    expect(result.created).toEqual([]);
    expect(doc.toJSON()).toEqual(before);
    expect(doc.canUndo).toBe(false);
  });
  it('validates dry runs without history or notifications', () => {
    const doc = createDoc();
    let count = 0;
    doc.on('change', () => count++);
    const result = doc.apply([{ op: 'add', item: rect('a') }], { dryRun: true });
    expect(result).toMatchObject({ ok: true, created: ['a'] });
    expect(doc.get('a')).toBeUndefined();
    expect(doc.canUndo).toBe(false);
    expect(count).toBe(0);
  });
  it('merges style, text and metadata at one level and inverts exactly', () => {
    const doc = createDoc();
    doc.apply([
      {
        op: 'add',
        item: {
          ...rect('a'),
          style: { fill: 'sky' },
          text: { value: 'Hello', align: 'center' },
          data: { owner: 'team' },
        },
      },
    ]);
    const before = doc.toJSON();
    let event: ChangeEvent | undefined;
    doc.on('change', (e) => (event = e));
    doc.apply([
      {
        op: 'set',
        id: 'a',
        patch: { style: { stroke: 'coral' }, text: { value: 'World' }, data: { status: 'ready' } },
      },
    ]);
    expect(doc.get('a')).toMatchObject({
      style: { fill: 'sky', stroke: 'coral' },
      text: { value: 'World', align: 'center' },
      data: { owner: 'team', status: 'ready' },
    });
    expect(doc.apply(event!.inverse).ok).toBe(true);
    expect(doc.toJSON()).toEqual(before);
  });
  it('detaches endpoints at their last geometric position and restores them on undo', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'add', item: rect('a') },
      { op: 'add', item: rect('b', 300) },
      {
        op: 'add',
        item: {
          id: 'c',
          kind: 'connector',
          from: { item: 'a', side: 'right' },
          to: { item: 'b', side: 'left' },
        },
      },
    ]);
    const before = doc.toJSON();
    expect(doc.apply([{ op: 'remove', id: 'a' }]).ok).toBe(true);
    expect(doc.get('c')!.from).toEqual({ x: 100, y: 40 });
    expect(doc.undo()).toBe(true);
    expect(doc.toJSON()).toEqual(before);
  });
  it('supports nested remove with connectors detached, reparenting, and ordering', () => {
    const doc = createDoc();
    doc.apply([
      {
        op: 'add',
        item: { id: 'container', kind: 'group', children: [rect('a'), rect('b', 200)] },
      },
      {
        op: 'add',
        item: { id: 'c', kind: 'connector', from: { item: 'a' }, to: { x: 500, y: 40 } },
      },
    ]);
    const before = doc.toJSON();
    doc.apply([
      { op: 'reparent', id: 'b', parent: null },
      { op: 'order', id: 'b', to: 'back' },
    ]);
    expect(doc.toJSON().pages[0].items[0].id).toBe('b');
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
    doc.apply([{ op: 'remove', id: 'container' }]);
    expect(doc.get('a')).toBeUndefined();
    expect(doc.get('c')!.from).toEqual({ x: 100, y: 40 });
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
  });
  it('rejects cycles, duplicate IDs and dangling/cross-page endpoints', () => {
    const doc = createDoc();
    doc.apply([
      {
        op: 'add',
        item: {
          id: 'g',
          kind: 'group',
          children: [{ id: 'f', kind: 'group', children: [rect('a')] }],
        },
      },
    ]);
    expect(doc.apply([{ op: 'reparent', id: 'g', parent: 'f' }]).ok).toBe(false);
    expect(doc.apply([{ op: 'add', item: rect('a') }]).ok).toBe(false);
    expect(
      doc.apply([
        { op: 'add', item: { kind: 'connector', from: { item: 'missing' }, to: { item: 'a' } } },
      ]).ok,
    ).toBe(false);
    expect(
      doc.apply([
        { op: 'page.add', page: { id: 'second', name: 'Second', items: [rect('b')] } },
        { op: 'add', item: { kind: 'connector', from: { item: 'a' }, to: { item: 'b' } } },
      ]).ok,
    ).toBe(false);
  });
  it('handles pages, metadata and media in one reversible batch', () => {
    const doc = createDoc(),
      before = doc.toJSON();
    const result = doc.apply([
      { op: 'page.add', page: { id: 's_two', name: 'Second' } },
      { op: 'page.set', id: 's_two', patch: { background: 'sky', name: 'Renamed' } },
      { op: 'meta.set', patch: { title: 'Plan' } },
      {
        op: 'media.set',
        id: 'm_a',
        media: { mime: 'image/png', w: 1, h: 1, src: 'data:image/png;base64,AA==' },
      },
      { op: 'add', page: 's_two', item: { id: 'img', kind: 'image', media: 'm_a' } },
    ]);
    expect(result.ok).toBe(true);
    expect(doc.undo()).toBe(true);
    expect(doc.toJSON()).toEqual(before);
    expect(doc.redo()).toBe(true);
    expect(doc.get('img')?.media).toBe('m_a');
    expect(doc.apply([{ op: 'media.remove', id: 'm_a' }]).ok).toBe(false);
  });
  it('keeps at least one page, but permits replacing it atomically', () => {
    const doc = createDoc();
    expect(doc.apply([{ op: 'page.remove', id: 'p_main' }]).ok).toBe(false);
    expect(
      doc.apply([
        { op: 'page.remove', id: 'p_main' },
        { op: 'page.add', page: { name: 'Replacement' } },
      ]).ok,
    ).toBe(true);
    expect(doc.undo()).toBe(true);
    expect(doc.toJSON()).toEqual(defaultDoc());
  });
  it('keeps unknown kinds and omits default style values on save', () => {
    const doc = createDoc();
    doc.apply([
      {
        op: 'add',
        item: {
          id: 'custom',
          kind: 'custom-widget',
          x: 1,
          style: { stroke: 'ink', opacity: 1, fill: 'none' },
          data: { custom: true },
        },
      },
    ]);
    expect(doc.toJSON().pages[0].items[0]).toMatchObject({
      kind: 'custom-widget',
      data: { custom: true },
    });
    expect(doc.toJSON().pages[0].items[0].style).toBeUndefined();
    expect(createDoc(doc.toJSON()).get('custom')).toMatchObject({ x: 1, y: 0, w: 180, h: 110 });
  });
});
describe('history', () => {
  it('undoes only the chosen origin and preserves later unrelated property writes', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: rect('a') }], { origin: 'user' });
    doc.apply([{ op: 'set', id: 'a', patch: { x: 200, style: { fill: 'sky' } } }], {
      origin: 'agent:one',
    });
    doc.apply([{ op: 'set', id: 'a', patch: { y: 250, style: { stroke: 'coral' } } }], {
      origin: 'user',
    });
    expect(doc.undo({ origin: 'agent:one' })).toBe(true);
    expect(doc.get('a')).toMatchObject({ x: 0, y: 250, style: { stroke: 'coral' } });
    expect(doc.get('a')!.style?.fill).toBeUndefined();
    expect(doc.redo()).toBe(true);
    expect(doc.get('a')).toMatchObject({ x: 200, y: 250, style: { stroke: 'coral', fill: 'sky' } });
  });
  it('does not overwrite later same-field changes during origin undo', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: rect('a') }]);
    doc.apply([{ op: 'set', id: 'a', patch: { x: 100, y: 100 } }], { origin: 'agent:a' });
    doc.apply([{ op: 'set', id: 'a', patch: { x: 500 } }], { origin: 'user' });
    doc.undo({ origin: 'agent:a' });
    expect(doc.get('a')).toMatchObject({ x: 500, y: 0 });
  });
  it('merges related changes into one undo entry and clears redo after a new commit', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: rect('a') }]);
    doc.apply([{ op: 'set', id: 'a', patch: { x: 1 } }], { origin: 'user', label: 'Nudge' });
    doc.apply([{ op: 'set', id: 'a', patch: { x: 2 } }], {
      origin: 'user',
      label: 'Nudge',
      merge: true,
    });
    doc.undo();
    expect(doc.get('a')!.x).toBe(0);
    expect(doc.canRedo).toBe(true);
    doc.apply([{ op: 'set', id: 'a', patch: { y: 1 } }]);
    expect(doc.canRedo).toBe(false);
  });
  it('undoes a merged agent entry by origin around later edits by a person', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'add', item: rect('a') },
      { op: 'add', item: rect('b', 200) },
      { op: 'meta.set', patch: { title: 'Plan' } },
    ]);
    const tidy = { origin: 'agent:tidy', label: 'Tidy', merge: true };
    doc.apply([{ op: 'set', id: 'a', patch: { x: 50, style: { fill: 'sky' } } }], tidy);
    doc.apply([{ op: 'set', id: 'b', patch: { y: 90 } }], tidy);
    doc.apply([{ op: 'set', id: 'a', patch: { x: 70 } }], tidy);
    doc.apply([{ op: 'meta.set', patch: { title: 'Tidy plan' } }], tidy);
    doc.apply([{ op: 'set', id: 'b', patch: { x: 400 } }], { origin: 'user' });
    expect(doc.undo({ origin: 'agent:tidy' })).toBe(true);
    expect(doc.get('a')).toMatchObject({ x: 0 });
    expect(doc.get('a')!.style?.fill).toBeUndefined();
    expect(doc.get('b')).toMatchObject({ x: 400, y: 0 });
    expect(doc.toJSON().meta.title).toBe('Plan');
    expect(doc.undo({ origin: 'agent:tidy' })).toBe(false);
  });
  it('round-trips mixed operation sequences through event inverses', () => {
    for (let seed = 0; seed < 20; seed++) {
      const doc = createDoc();
      doc.apply([
        { op: 'add', item: { kind: 'group', id: 'f', children: [rect('a'), rect('b', 200)] } },
        { op: 'add', item: rect('c', 400) },
      ]);
      const before = doc.toJSON();
      let inverse: Op[] = [];
      doc.on('change', (e) => (inverse = e.inverse));
      expect(
        doc.apply([
          { op: 'set', id: 'a', patch: { x: seed * 7, style: { fill: 'coral' }, data: { seed } } },
          { op: 'order', id: 'b', to: 'back' },
          { op: 'reparent', id: 'c', parent: 'f', index: 1 },
          { op: 'remove', id: 'a' },
        ]).ok,
      ).toBe(true);
      expect(doc.apply(inverse).ok).toBe(true);
      expect(doc.toJSON()).toEqual(before);
    }
  });
});
describe('validation and safety', () => {
  it('rejects all readonly writes regardless of actor', () => {
    const doc = createDoc(undefined, { readonly: true });
    for (const origin of ['user', 'api', 'agent:bot'])
      expect(doc.apply([{ op: 'add', item: rect('a') }], { origin }).errors[0].code).toBe(
        'READONLY',
      );
    expect(doc.undo()).toBe(false);
    expect(() => doc.load(defaultDoc())).toThrow('read-only');
  });
  it('rejects unsafe sizes, malformed fields, non-JSON metadata and oversized batches', () => {
    const doc = createDoc();
    for (const patch of [
      { x: Infinity },
      { x: 1000001 },
      { w: -1 },
      { text: { value: 'x'.repeat(100001) } },
      { style: { opacity: 2 } },
      { data: { fn: () => 1 } },
    ])
      expect(doc.apply([{ op: 'add', item: { ...rect('a'), ...patch } }]).ok).toBe(false);
    expect(
      doc.apply(Array.from({ length: 1001 }, () => ({ op: 'add', item: rect('a') }))),
    ).toMatchObject({ ok: false, errors: [{ code: 'BATCH_LIMIT' }] });
  });
  it('keeps agent html inert and rejects unapproved image origins', () => {
    const doc = createDoc();
    doc.apply(
      [
        {
          op: 'add',
          item: {
            kind: 'html',
            id: 'html',
            html: '<img src=x onerror=alert(1)>',
            mount: 'callback',
          },
        },
      ],
      { origin: 'agent:bot' },
    );
    expect(doc.get('html')!.html).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(doc.get('html')!.mount).toBeUndefined();
    const op: Op = {
      op: 'media.set',
      id: 'm_external',
      media: { mime: 'image/png', w: 1, h: 1, src: 'https://images.example.test/a.png' },
    };
    expect(doc.apply([op], { origin: 'agent:bot' }).ok).toBe(false);
    expect(
      createDoc(undefined, { allowedImageOrigins: ['https://images.example.test'] }).apply([op], {
        origin: 'agent:bot',
      }).ok,
    ).toBe(true);
    expect(
      doc.apply([{ ...op, media: { ...op.media, src: 'javascript:alert(1)' } }], { origin: 'user' })
        .ok,
    ).toBe(false);
    expect(
      doc.apply(
        [
          {
            ...op,
            id: 'm_creds',
            media: { ...op.media, src: 'https://user:token@images.example.test/a.png' },
          },
        ],
        { origin: 'user' },
      ).ok,
    ).toBe(false);
  });
  it('migrates version zero, rejects future versions, and replaces history on load', () => {
    const old = { ...defaultDoc(), version: 0 } as unknown as AnnieDoc;
    expect(migrate(old).version).toBe(2);
    expect(() => migrate({ ...old, version: 3 })).toThrow('newer');
    const doc = createDoc();
    doc.apply([{ op: 'add', item: rect('a') }]);
    doc.load(defaultDoc());
    expect(doc.canUndo).toBe(false);
    expect(doc.get('a')).toBeUndefined();
  });
  it('migrates saved version-one sheets without changing identities, content or custom names', () => {
    const legacy = {
      format: 'anniedrawing',
      version: 1,
      meta: { title: 'Product plan', modified: '2026-09-18', team: { name: 'Frontierz' } },
      sheets: [
        {
          id: 's_design',
          name: 'Sheet 1',
          background: '#fafafa',
          items: [
            {
              id: 'container',
              kind: 'group',
              x: 30,
              y: 40,
              w: 500,
              h: 300,
              data: { author: 'Pau' },
              children: [
                { ...rect('a', 70, 90), text: { value: 'First idea' }, rotation: 17 },
                { ...rect('b', 300, 90), data: { status: ['ready', 'reviewed'] } },
              ],
            },
            { id: 'link', kind: 'connector', from: { item: 'a' }, to: { item: 'b' } },
            { id: 'photo', kind: 'image', x: 90, y: 410, w: 20, h: 20, media: 'm_photo' },
          ],
        },
        { id: 's_notes', name: 'Sheet music and sketches', items: [] },
        { id: 's_archive', name: 'My board', items: [] },
      ],
      media: { m_photo: { mime: 'image/png', w: 1, h: 1, src: 'data:image/png;base64,AAAA' } },
    };
    const original = structuredClone(legacy);
    const doc = createDoc(legacy as unknown as AnnieDoc);
    const current = doc.toJSON({ compact: false });
    expect(current.version).toBe(2);
    expect(current).not.toHaveProperty('sheets');
    expect(current.pages.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 's_design', name: 'Page 1' },
      { id: 's_notes', name: 'Sheet music and sketches' },
      { id: 's_archive', name: 'My board' },
    ]);
    expect(current.meta).toEqual(legacy.meta);
    expect(current.media).toEqual(legacy.media);
    expect(current.pages[0]).toMatchObject({
      background: '#fafafa',
      items: legacy.sheets[0].items,
    });
    expect(doc.get('link')).toMatchObject({ from: { item: 'a' }, to: { item: 'b' } });
    expect(doc.query({ page: 's_design' })).toHaveLength(5);
    expect(createDoc(doc.toJSON()).toJSON({ compact: false })).toEqual(current);
    expect(legacy).toEqual(original);
    expect(doc.apply([{ op: 'page.set', id: 's_design', patch: { name: 'Launch plan' } }]).ok).toBe(
      true,
    );
    doc.load(legacy as unknown as AnnieDoc);
    expect(doc.toJSON({ compact: false })).toEqual(current);
    expect(doc.canUndo).toBe(false);
  });
  it('accepts transitional v1 pages and preserves canonical v2 names exactly', () => {
    const transitional = { ...defaultDoc(), version: 1 };
    transitional.pages[0].name = 'Sheet 12';
    expect(migrate(transitional).pages[0].name).toBe('Page 12');
    const current = { ...defaultDoc() };
    current.pages[0].name = 'Sheet 12';
    expect(migrate(current)).toEqual(current);
    expect(createDoc().toJSON()).toMatchObject({ version: 2, pages: [{ name: 'Page 1' }] });
  });
});
describe('reactive read model', () => {
  it('notifies only changed item fields and child order after one atomic commit', async () => {
    const { effect } = await import('@preact/signals-core');
    const doc = createDoc();
    doc.apply([
      { op: 'add', item: rect('a') },
      { op: 'add', item: rect('b', 200) },
    ]);
    let xRuns = 0,
      yRuns = 0,
      orderRuns = 0;
    const stopX = effect(() => {
        doc.fieldSignal('a', 'x').value;
        xRuns++;
      }),
      stopY = effect(() => {
        doc.fieldSignal('a', 'y').value;
        yRuns++;
      }),
      stopOrder = effect(() => {
        doc.childrenSignal('p_main').value;
        orderRuns++;
      });
    doc.apply([
      { op: 'set', id: 'a', patch: { x: 10 } },
      { op: 'set', id: 'a', patch: { x: 20 } },
    ]);
    expect(xRuns).toBe(2);
    expect(yRuns).toBe(1);
    expect(orderRuns).toBe(1);
    expect(Object.isFrozen(doc.itemSignal('a').value)).toBe(true);
    doc.apply([{ op: 'order', id: 'a', to: 'front' }]);
    expect(orderRuns).toBe(2);
    expect(doc.childrenSignal('p_main').value).toEqual(['b', 'a']);
    doc.undo();
    expect(doc.childrenSignal('p_main').value).toEqual(['a', 'b']);
    stopX();
    stopY();
    stopOrder();
  });
  it('restores middle page order through event inverses', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'page.add', page: { id: 'middle', name: 'Middle' } },
      { op: 'page.add', page: { id: 'last', name: 'Last' } },
    ]);
    const before = doc.toJSON();
    let inverse: Op[] = [];
    doc.on('change', (e) => (inverse = e.inverse));
    doc.apply([{ op: 'page.remove', id: 'middle' }]);
    doc.apply(inverse);
    expect(doc.toJSON()).toEqual(before);
  });
  it('allows agents to edit documents containing previously trusted external images', () => {
    const doc = createDoc();
    doc.apply(
      [
        {
          op: 'media.set',
          id: 'm',
          media: { mime: 'image/png', w: 10, h: 10, src: 'https://user-trusted.example/a.png' },
        },
        { op: 'add', item: { id: 'a', kind: 'image', media: 'm' } },
      ],
      { origin: 'user' },
    );
    expect(
      doc.apply([{ op: 'set', id: 'a', patch: { x: 100 } }], { origin: 'agent:helper' }).ok,
    ).toBe(true);
  });
});
describe('custom kind contracts', () => {
  it('applies kind defaults and validates custom schemas for add and set', async () => {
    const v = await import('valibot');
    const doc = createDoc(undefined, {
      kinds: [
        {
          kind: 'ticket',
          schema: v.looseObject({ status: v.picklist(['todo', 'done']) }),
          defaults: { status: 'todo', w: 220, h: 120, style: { fill: 'sky' } },
        },
      ],
    });
    expect(
      doc.apply([{ op: 'add', item: { id: 'ticket', kind: 'ticket', style: { stroke: 'coral' } } }])
        .ok,
    ).toBe(true);
    expect(doc.get('ticket')).toMatchObject({
      status: 'todo',
      w: 220,
      h: 120,
      style: { fill: 'sky', stroke: 'coral' },
    });
    expect(doc.apply([{ op: 'set', id: 'ticket', patch: { status: 'broken' } }]).ok).toBe(false);
    expect(doc.get('ticket')!.status).toBe('todo');
    expect(doc.apply([{ op: 'set', id: 'ticket', patch: { status: 'done' } }]).ok).toBe(true);
  });
});
it('uses an explicitly supplied HTML sanitizer and keeps the default inert', () => {
  const sanitizeHTML = (html: string) =>
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  expect(() => createDoc(undefined, { sanitizeHTML: (html) => html })).toThrow(/strip active HTML/);
  const doc = createDoc(undefined, { sanitizeHTML });
  expect(
    doc.apply(
      [
        {
          op: 'add',
          item: { kind: 'html', id: 'safe', html: '<b>Hello</b><script>unsafe()</script>' },
        },
      ],
      { origin: 'agent:writer' },
    ).ok,
  ).toBe(true);
  expect(doc.get('safe')!.html).toBe('<b>Hello</b>');
  expect(
    doc.apply(
      [{ op: 'set', id: 'safe', patch: { html: '<i>Changed</i><script>unsafe()</script>' } }],
      { origin: 'agent:writer' },
    ).ok,
  ).toBe(true);
  expect(doc.get('safe')!.html).toBe('<i>Changed</i>');
});
describe('adversarial transaction regressions', () => {
  it('accepts create-then-remove batches without a post-validation crash', () => {
    const doc = createDoc(),
      before = doc.toJSON();
    expect(
      doc.apply([
        { op: 'add', item: rect('temporary') },
        { op: 'remove', id: 'temporary' },
      ]).ok,
    ).toBe(true);
    expect(doc.toJSON()).toEqual(before);
    expect(doc.undo()).toBe(true);
    expect(doc.toJSON()).toEqual(before);
  });
  it('preserves explicit style overrides against kind-specific defaults', () => {
    const doc = createDoc();
    doc.apply([
      {
        op: 'add',
        item: { id: 'note', kind: 'note', style: { fill: 'none', strokeWidth: 2, corner: 8 } },
      },
    ]);
    expect(doc.toJSON().pages[0].items[0].style).toEqual({
      fill: 'none',
      strokeWidth: 2,
      corner: 8,
    });
    expect(createDoc(doc.toJSON()).get('note')!.style).toEqual({
      fill: 'none',
      strokeWidth: 2,
      corner: 8,
    });
  });
  it('rejects deletion of required geometry and normalizes replacement children', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: { id: 'f', kind: 'group' } }]);
    expect(doc.apply([{ op: 'set', id: 'f', patch: { x: undefined } }]).ok).toBe(false);
    expect(
      doc.apply([{ op: 'set', id: 'f', patch: { children: [{ kind: 'rect' } as never] } }]).ok,
    ).toBe(true);
    const child = doc.get('f')!.children![0];
    expect(child.id).toMatch(/^i_/);
    expect(child).toMatchObject({ x: 0, y: 0, w: 180, h: 110 });
    expect(doc.apply([{ op: 'page.set', id: 'p_main', patch: { items: [] } as never }]).ok).toBe(
      false,
    );
  });
  it('includes nested additions in the non-user batch item limit', () => {
    const doc = createDoc();
    expect(
      doc.apply(
        [
          {
            op: 'add',
            item: {
              kind: 'group',
              children: Array.from({ length: 1000 }, (_, i) => rect(`nested_${i}`)),
            },
          },
        ],
        { origin: 'agent:bot' },
      ).ok,
    ).toBe(false);
    expect(doc.query()).toEqual([]);
  });
  it('keeps default inert HTML escaping idempotent during inverse replay', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: { id: 'html', kind: 'html', html: '<b>safe text</b>' } }]);
    const before = doc.toJSON();
    let inverse: Op[] = [];
    doc.on('change', (event) => (inverse = event.inverse));
    doc.apply([{ op: 'remove', id: 'html' }]);
    expect(doc.apply(inverse).ok).toBe(true);
    expect(doc.toJSON()).toEqual(before);
  });
});
it('detaches connectors when a children replacement removes their target and undoes the transaction', () => {
  const doc = createDoc();
  doc.apply([
    { op: 'add', item: { id: 'f', kind: 'group', children: [rect('a')] } },
    {
      op: 'add',
      item: {
        id: 'c',
        kind: 'connector',
        from: { item: 'a', side: 'right' },
        to: { x: 300, y: 40 },
      },
    },
  ]);
  const before = doc.toJSON();
  expect(doc.apply([{ op: 'set', id: 'f', patch: { children: [] } }]).ok).toBe(true);
  expect(doc.get('c')!.from).toEqual({ x: 100, y: 40 });
  expect(doc.undo()).toBe(true);
  expect(doc.toJSON()).toEqual(before);
});
it('selectively undoes children replacement while preserving a later unrelated title change', () => {
  const doc = createDoc();
  doc.apply([{ op: 'add', item: { id: 'f', kind: 'group' } }]);
  doc.apply([{ op: 'set', id: 'f', patch: { children: [rect('a')] } }], {
    origin: 'agent:children',
  });
  doc.apply([{ op: 'meta.set', patch: { title: 'Human title' } }], { origin: 'user' });
  expect(doc.undo({ origin: 'agent:children' })).toBe(true);
  expect(doc.get('a')).toBeUndefined();
  expect(doc.toJSON().meta.title).toBe('Human title');
});
it('provides complete runtime snapshots separately from compact persistence', () => {
  const doc = createDoc(undefined, {
    kinds: [{ kind: 'ticket', defaults: { style: { fill: 'sky' } } }],
  });
  doc.apply([
    { op: 'add', item: { id: 'a', kind: 'ticket' } },
    { op: 'add', item: { id: 'c', kind: 'connector', from: { item: 'a' }, to: { x: 400, y: 50 } } },
  ]);
  expect(doc.toJSON().pages[0].items[0].style).toBeUndefined();
  expect(doc.toJSON({ compact: false }).pages[0].items[0].style).toEqual({ fill: 'sky' });
  expect(doc.toJSON().pages[0].items[1].x).toBeUndefined();
  expect(doc.toJSON({ compact: false }).pages[0].items[1].x).toBe(0);
});
describe('origin-specific batch limits', () => {
  it('allows a 2,000-item user move atomically while rejecting the same API batch', () => {
    const initial = defaultDoc();
    initial.pages[0].items = Array.from({ length: 2000 }, (_, index) =>
      rect(`large_${index}`, (index % 100) * 120, Math.floor(index / 100) * 100),
    );
    const doc = createDoc(initial);
    const ops: Op[] = initial.pages[0].items.map((item) => ({
      op: 'set',
      id: item.id,
      patch: { x: item.x + 25 },
    }));
    const events: ChangeEvent[] = [];
    doc.on('change', (event) => events.push(event));
    expect(doc.apply(ops, { origin: 'api' })).toMatchObject({
      ok: false,
      errors: [{ code: 'BATCH_LIMIT' }],
    });
    expect(doc.get('large_0')!.x).toBe(0);
    expect(doc.apply(ops, { origin: 'user', label: 'Move selection' }).ok).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].ops).toHaveLength(2000);
    expect(doc.get('large_0')!.x).toBe(25);
    expect(doc.get('large_1999')!.x).toBe(11905);
    expect(doc.undo()).toBe(true);
    expect(doc.get('large_1999')!.x).toBe(11880);
    expect(doc.canUndo).toBe(false);
  }, 1000);
  it('continues rejecting prototype-polluting data after selective actor undo', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: { ...rect('protected'), data: { owner: 'original' } } }], {
      origin: 'user',
    });
    doc.apply([{ op: 'set', id: 'protected', patch: { x: 120, data: { status: 'agent' } } }], {
      origin: 'agent:helper',
    });
    doc.apply([{ op: 'set', id: 'protected', patch: { y: 90 } }], { origin: 'user' });
    expect(doc.undo({ origin: 'agent:helper' })).toBe(true);
    const before = doc.toJSON();
    const malicious = [
      JSON.parse('{"__proto__":{"anniePolluted":true}}'),
      JSON.parse('{"nested":{"constructor":{"prototype":{"anniePolluted":true}}}}'),
    ];
    for (const data of malicious) {
      expect(
        doc.apply([{ op: 'set', id: 'protected', patch: { data } }], { origin: 'agent:helper' }),
      ).toMatchObject({ ok: false, errors: [{ code: 'INVALID_DATA' }] });
      expect(doc.toJSON()).toEqual(before);
      expect(({} as Record<string, unknown>).anniePolluted).toBeUndefined();
    }
    expect(doc.get('protected')).toMatchObject({ x: 0, y: 90, data: { owner: 'original' } });
  });
});
it('detaches custom outline endpoints at the rendered boundary and restores bindings on undo', () => {
  const doc = createDoc(undefined, {
    kinds: [
      {
        kind: 'triangle',
        outline: (item) => ({
          closed: true,
          points: [
            { x: 0, y: item.h },
            { x: item.w / 2, y: 0 },
            { x: item.w, y: item.h },
          ],
        }),
      },
    ],
  });
  doc.apply([
    {
      op: 'add',
      item: {
        id: 'container',
        kind: 'group',
        children: [{ id: 'triangle', kind: 'triangle', x: 100, y: 100, w: 100, h: 100 }],
      },
    },
    {
      op: 'add',
      item: {
        id: 'connector',
        kind: 'connector',
        from: { item: 'triangle', side: 'right' },
        to: { x: 400, y: 150 },
      },
    },
  ]);
  const before = doc.toJSON();
  expect(doc.apply([{ op: 'remove', id: 'triangle' }]).ok).toBe(true);
  expect(doc.get('connector')!.from).toEqual({ x: 175, y: 150 });
  expect(doc.undo()).toBe(true);
  expect(doc.toJSON()).toEqual(before);
  expect(doc.apply([{ op: 'set', id: 'container', patch: { children: [] } }]).ok).toBe(true);
  expect(doc.get('connector')!.from).toEqual({ x: 175, y: 150 });
  expect(doc.undo()).toBe(true);
  expect(doc.toJSON()).toEqual(before);
});

it('imports retired frames as ordinary groups without dropping contents, labels or bindings', () => {
  const legacy = defaultDoc();
  legacy.pages[0].items = [
    {
      id: 'old',
      kind: 'frame',
      x: 40,
      y: 80,
      w: 500,
      h: 300,
      title: 'My ideas',
      clip: true,
      style: { fill: 'rose', opacity: 0.7 },
      text: { value: 'Keep this text' },
      data: { owner: 'Pau' },
      children: [
        rect('child', 100, 120),
        {
          id: 'nested',
          kind: 'frame',
          x: 650,
          y: 80,
          w: 200,
          h: 160,
          title: 'Outside too',
          children: [rect('outside', 900, 120)],
        },
      ],
    },
    rect('old_background', 20, 20),
    {
      id: 'link',
      kind: 'connector',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      from: { item: 'old' },
      to: { item: 'child' },
    },
  ];
  const before = structuredClone(legacy);
  const doc = createDoc(legacy);
  expect(doc.query({ kind: 'frame' })).toEqual([]);
  expect(doc.get('old')).toMatchObject({ kind: 'group', name: 'My ideas', data: { owner: 'Pau' } });
  expect(doc.get('old')).not.toHaveProperty('clip');
  expect(doc.get('old_background_2')).toMatchObject({
    kind: 'rect',
    x: 40,
    y: 80,
    w: 500,
    h: 300,
    style: { fill: 'rose', opacity: 0.7 },
    text: { value: 'Keep this text' },
  });
  expect(doc.get('old_label')?.text?.value).toBe('My ideas');
  expect(doc.get('nested')).toMatchObject({ kind: 'group', name: 'Outside too' });
  expect(doc.get('child')).toEqual(rect('child', 100, 120));
  expect(doc.get('outside')).toEqual(rect('outside', 900, 120));
  expect(doc.get('link')).toMatchObject({ from: { item: 'old' }, to: { item: 'child' } });
  expect(createDoc(doc.toJSON()).toJSON()).toEqual(doc.toJSON());
  expect(legacy).toEqual(before);
});

describe('warnings and placement', () => {
  it('warns when a new item overlaps without rolling back', () => {
    const doc = createDoc();
    const result = doc.apply([
      { op: 'add', item: rect('a') },
      { op: 'add', item: rect('b', 20, 20) },
    ]);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((warning) => warning.code === 'OVERLAPS_EXISTING')).toBe(true);
    expect(doc.get('b')).toBeTruthy();
  });
  it('commits an empty batch without history', () => {
    const doc = createDoc();
    expect(doc.apply([])).toMatchObject({ ok: true, created: [] });
    expect(doc.canUndo).toBe(false);
  });
  it('places left, above, below and near, and rejects two relations', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: { ...rect('a'), x: 200, y: 200 } }]);
    expect(doc.apply([{ op: 'add', item: rect('left'), place: { leftOf: 'a', gap: 20 } }]).ok).toBe(
      true,
    );
    expect(doc.get('left')!.x + doc.get('left')!.w).toBe(180);
    expect(doc.apply([{ op: 'add', item: rect('up'), place: { above: 'a', gap: 10 } }]).ok).toBe(
      true,
    );
    expect(doc.get('up')!.y + doc.get('up')!.h).toBe(190);
    expect(doc.apply([{ op: 'add', item: rect('down'), place: { below: 'a' } }]).ok).toBe(true);
    expect(doc.get('down')!.y).toBe(312);
    expect(doc.apply([{ op: 'add', item: rect('n'), place: { near: 'a', gap: 16 } }]).ok).toBe(
      true,
    );
    expect(
      doc.apply([{ op: 'add', item: rect('bad'), place: { leftOf: 'a', rightOf: 'a' } }]).ok,
    ).toBe(false);
    expect(
      doc.apply([{ op: 'add', item: rect('missing'), place: { rightOf: 'nope' } }]).errors[0]
        .message,
    ).toContain('does not exist');
  });
  it('slides a second rightOf onto the next free slot', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: { ...rect('a'), x: 0, y: 0 } }]);
    expect(doc.apply([{ op: 'add', item: rect('b'), place: { rightOf: 'a', gap: 20 } }]).ok).toBe(
      true,
    );
    expect(doc.get('b')).toMatchObject({ x: 120, y: 0 });
    expect(doc.apply([{ op: 'add', item: rect('c'), place: { rightOf: 'a', gap: 20 } }]).ok).toBe(
      true,
    );
    expect(doc.get('c')).toMatchObject({ x: 240, y: 0 });
  });
  it('stores elbow on agent connectors that omit route', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'add', item: rect('a') },
      { op: 'add', item: rect('b', 200) },
      {
        op: 'add',
        item: { id: 'link', kind: 'connector', from: { item: 'a' }, to: { item: 'b' } },
      },
    ]);
    expect(doc.get('link')?.route).toBeUndefined();
    doc.apply(
      [
        {
          op: 'add',
          item: { id: 'flow', kind: 'connector', from: { item: 'a' }, to: { item: 'b' } },
        },
      ],
      { origin: 'agent:planner' },
    );
    expect(doc.get('flow')?.route).toBe('elbow');
  });
  it('remaps colliding agent create ids and rewires the same batch', () => {
    const doc = createDoc();
    const first = [
      { op: 'add' as const, item: { ...rect('api'), text: { value: 'API' } } },
      {
        op: 'add' as const,
        item: { ...rect('cache'), w: 100, h: 80, text: { value: 'Cache' } },
        place: { rightOf: 'api', gap: 40 },
      },
      {
        op: 'add' as const,
        item: {
          id: 'link',
          kind: 'connector' as const,
          from: { item: 'api' },
          to: { item: 'cache' },
        },
      },
    ];
    expect(doc.apply(first, { origin: 'agent:planner' }).ok).toBe(true);
    const retry = doc.apply(first, { origin: 'agent:planner' });
    expect(retry.ok).toBe(true);
    expect(retry.created).toEqual(['api_1', 'cache_1', 'link_1']);
    expect(
      retry.warnings
        .filter((warning) => warning.code === 'ID_REMAPPED')
        .map((warning) => warning.message),
    ).toEqual([
      'Item id api was already in use; stored as api_1.',
      'Item id cache was already in use; stored as cache_1.',
      'Item id link was already in use; stored as link_1.',
    ]);
    expect(doc.get('api')?.text?.value).toBe('API');
    expect(doc.get('api_1')?.text?.value).toBe('API');
    expect(doc.get('cache_1')!.x).toBeGreaterThan(doc.get('api_1')!.x);
    expect(doc.get('link_1')).toMatchObject({
      from: { item: 'api_1' },
      to: { item: 'cache_1' },
    });
    expect(doc.apply([{ op: 'add', item: rect('api') }]).ok).toBe(false);
  });
  it('assigns _2 when _1 is already taken and remaps group children', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'add', item: rect('note') },
      { op: 'add', item: rect('note_1') },
    ]);
    const result = doc.apply(
      [
        {
          op: 'add',
          item: {
            id: 'box',
            kind: 'group',
            x: 0,
            y: 0,
            w: 400,
            h: 200,
            children: [rect('note'), rect('other', 120)],
          },
        },
      ],
      { origin: 'agent:planner' },
    );
    expect(result.ok).toBe(true);
    expect(result.created).toEqual(['box', 'note_2', 'other']);
    expect(doc.get('note_2')?.kind).toBe('rect');
    expect(doc.get('note')).toBeTruthy();
    expect(doc.get('note_1')).toBeTruthy();
  });
  it('keeps agent refs before a colliding create on the existing item', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: rect('a') }]);
    const edit = doc.apply(
      [
        { op: 'set', id: 'a', patch: { x: 40 } },
        { op: 'add', item: rect('a', 900) },
      ],
      { origin: 'agent:planner' },
    );
    expect(edit.ok).toBe(true);
    expect(edit.created).toEqual(['a_1']);
    expect(doc.get('a')!.x).toBe(40);
    expect(doc.get('a_1')!.x).toBe(900);
  });
  it('lets an agent replace an item it removes in the same batch', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: rect('a') }]);
    const replaced = doc.apply(
      [
        { op: 'remove', id: 'a' },
        { op: 'add', item: rect('a', 500) },
      ],
      { origin: 'agent:planner' },
    );
    expect(replaced.ok).toBe(true);
    expect(replaced.created).toEqual(['a']);
    expect(replaced.warnings.some((warning) => warning.code === 'ID_REMAPPED')).toBe(false);
    expect(doc.get('a')!.x).toBe(500);
  });
  it('keeps child ids when an agent resends a group', () => {
    const doc = createDoc();
    doc.apply([
      {
        op: 'add',
        item: {
          id: 'g',
          kind: 'group',
          x: 0,
          y: 0,
          w: 300,
          h: 80,
          children: [rect('c1'), rect('c2', 200)],
        },
      },
      { op: 'add', item: rect('z', 0, 400) },
      { op: 'add', item: { id: 'k', kind: 'connector', from: { item: 'c1' }, to: { item: 'z' } } },
    ]);
    const children = doc.get('g')!.children!;
    children[0].text = { value: 'Hello' };
    const result = doc.apply([{ op: 'set', id: 'g', patch: { children } }], {
      origin: 'agent:planner',
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(doc.get('g')!.children!.map((child) => child.id)).toEqual(['c1', 'c2']);
    expect(doc.get('c1')!.text?.value).toBe('Hello');
    expect(doc.get('k')!.from).toEqual({ item: 'c1' });
  });
  it('rejects inside placement on a non-group', () => {
    const doc = createDoc();
    doc.apply([{ op: 'add', item: rect('a') }]);
    expect(
      doc.apply([{ op: 'add', item: rect('b'), place: { inside: 'a' } }]).errors[0].message,
    ).toContain('group');
  });
});

describe('query and signals', () => {
  it('filters hidden, locked, kind arrays, nested inside, and sticky RegExp', () => {
    const doc = createDoc();
    doc.apply([
      { op: 'add', item: { kind: 'group', id: 'g', x: 0, y: 0, w: 400, h: 300, children: [] } },
      {
        op: 'add',
        item: { ...rect('child'), text: { value: 'Hello' }, hidden: true },
        place: { inside: 'g' },
      },
      { op: 'add', item: { ...rect('lock', 500), locked: true } },
    ]);
    expect(doc.query({ hidden: true }).map((item) => item.id)).toEqual(['child']);
    expect(doc.query({ locked: true }).map((item) => item.id)).toEqual(['lock']);
    expect(
      doc
        .query({ kind: ['rect'] })
        .map((item) => item.id)
        .sort(),
    ).toEqual(['child', 'lock']);
    expect(doc.query({ inside: 'g' }).map((item) => item.id)).toEqual(['child']);
    const sticky = /hello/gi;
    sticky.lastIndex = 4;
    expect(doc.query({ text: sticky }).map((item) => item.id)).toEqual(['child']);
    expect(doc.query({ text: sticky }).map((item) => item.id)).toEqual(['child']);
  });
  it('notifies itemSignal after a missing id is created', () => {
    const doc = createDoc();
    const seen: (string | undefined)[] = [];
    doc.itemSignal('later').subscribe((item) => seen.push(item?.id));
    doc.apply([{ op: 'add', item: rect('later') }]);
    expect(seen).toEqual([undefined, 'later']);
  });
});
