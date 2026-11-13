import { describe, expect, it } from 'vitest';
import { createDoc, OpSchema } from '../src/core';
import { layoutRichText, parseRichText, visibleText } from '../src/core/richText';
import { labeledBoxSize } from '../src/core/textFit';
import { exportSVG } from '../src/porter/svg';
import * as v from 'valibot';

const lesson = '# Plan\n- First **bold** step\n- Second step\n\nPlain *italic* close';
const fellow = { origin: 'agent:fellow' } as const;

describe('md text parser', () => {
  it('reads headings, list items, bold, and italic', () => {
    expect(parseRichText(lesson)).toEqual([
      { kind: 'h1', runs: [{ text: 'Plan' }] },
      {
        kind: 'ul',
        marker: '•',
        runs: [{ text: 'First ' }, { text: 'bold', bold: true }, { text: ' step' }],
      },
      { kind: 'ul', marker: '•', runs: [{ text: 'Second step' }] },
      { kind: 'p', runs: [] },
      {
        kind: 'p',
        runs: [{ text: 'Plain ' }, { text: 'italic', italic: true }, { text: ' close' }],
      },
    ]);
    expect(parseRichText('## Sub\n12. Twelfth')).toEqual([
      { kind: 'h2', runs: [{ text: 'Sub' }] },
      { kind: 'ol', marker: '12.', runs: [{ text: 'Twelfth' }] },
    ]);
    expect(parseRichText('**b *bi* b**')[0].runs).toEqual([
      { text: 'b ', bold: true },
      { text: 'bi', bold: true, italic: true },
      { text: ' b', bold: true },
    ]);
  });

  it('shows anything outside the subset literally', () => {
    for (const value of [
      '### Three',
      '#Tight',
      '* star item',
      '  - indented',
      '1) paren',
      '2 * 3 * 4',
      '**unclosed',
      'unopened**',
      '***both***',
      '<b>tag</b> &amp;',
      '`code` [link](x)',
    ])
      expect(parseRichText(value)).toEqual([{ kind: 'p', runs: [{ text: value }] }]);
    expect(parseRichText('**a *b** c*')[0].runs).toEqual([
      { text: 'a *b', bold: true },
      { text: ' c*' },
    ]);
    expect(visibleText({ value: lesson, format: 'md' })).toBe(
      'Plan\n• First bold step\n• Second step\n\nPlain italic close',
    );
    expect(visibleText({ value: lesson })).toBe(lesson);
  });

  it('stays linear and literal on hostile input', () => {
    const inputs = [
      '*'.repeat(100_000),
      '**a '.repeat(25_000),
      '*a '.repeat(33_000),
      'a*'.repeat(50_000),
      '**'.repeat(50_000),
      `${'x'.repeat(99_990)} **y**`,
      '- '.repeat(50_000),
    ];
    const started = performance.now();
    for (const value of inputs) {
      const lines = parseRichText(value);
      const shown = lines.map((line) => line.runs.map((run) => run.text).join('')).join('');
      expect(shown.length).toBeLessThanOrEqual(value.length);
      expect(shown.length).toBeGreaterThan(value.length / 3);
      layoutRichText(lines, 600, 18, 0.62);
      labeledBoxSize('text', { value, format: 'md' });
    }
    expect(parseRichText('*'.repeat(100_000))[0].runs[0].text).toHaveLength(100_000);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('wraps list items with a hanging indent and keeps run styles across rows', () => {
    const rows = layoutRichText(
      parseRichText('- one **two three** four five six seven'),
      120,
      18,
      0.62,
    );
    expect(rows.length).toBeGreaterThan(2);
    expect(rows.every((row) => row.indent > 0)).toBe(true);
    expect(rows.map((row) => row.first)).toEqual(rows.map((_, index) => index === 0));
    const bold = rows.flatMap((row) => row.runs.filter((run) => run.bold).map((run) => run.text));
    expect(bold.join(' ').replace(/\s+/g, ' ').trim()).toBe('two three');
  });
});

describe('md text size and storage', () => {
  it('leaves plain sizes alone and measures md with the same rule', () => {
    for (const kind of ['rect', 'ellipse', 'diamond', 'note', 'text']) {
      const value = 'A plain label that is long enough to wrap inside a box';
      const plain = labeledBoxSize(kind, { value });
      expect(labeledBoxSize(kind, { value, format: 'plain' })).toEqual(plain);
      const md = labeledBoxSize(kind, { value, format: 'md' });
      expect(Math.ceil(md.w)).toBe(Math.ceil(plain.w));
      expect(Math.ceil(md.h)).toBe(Math.ceil(plain.h));
    }
    const base = labeledBoxSize('rect', { value: 'Plan' });
    expect(labeledBoxSize('rect', { value: '**Plan**', format: 'md' }).w).toBeGreaterThan(base.w);
    expect(labeledBoxSize('rect', { value: '# Plan', format: 'md' }).h).toBeGreaterThan(base.h);
    expect(labeledBoxSize('rect', { value: '- Plan', format: 'md' }).w).toBeGreaterThan(base.w);
  });

  it('grows agent boxes for md structure and keeps the raw value on read', () => {
    const doc = createDoc();
    const result = doc.apply(
      [
        { op: 'add', item: { id: 'card', kind: 'rect', text: { value: lesson, format: 'md' } } },
        { op: 'add', item: { id: 'flat', kind: 'rect', text: { value: lesson } } },
      ],
      fellow,
    );
    expect(result.ok).toBe(true);
    const card = doc.get('card')!;
    expect(card.text).toEqual({ value: lesson, format: 'md' });
    const fit = labeledBoxSize('rect', card.text!, 180, 110);
    expect(card.w).toBe(Math.ceil(fit.w));
    expect(card.h).toBe(Math.ceil(fit.h));
    expect(doc.query({ kind: 'rect' }).find((item) => item.id === 'card')!.text!.value).toBe(
      lesson,
    );
    expect(doc.describe()).toContain('# Plan');
    const saved = doc.toJSON();
    const copy = createDoc();
    copy.load(JSON.parse(JSON.stringify(saved)));
    expect(copy.get('card')!.text).toEqual({ value: lesson, format: 'md' });
    expect(copy.toJSON()).toEqual(saved);
  });

  it('keeps format on string and object text patches', () => {
    const doc = createDoc();
    doc.apply([
      {
        op: 'add',
        item: { id: 't', kind: 'text', text: { value: '# A', format: 'md', size: 'l' } },
      },
    ]);
    doc.apply([{ op: 'set', id: 't', patch: { text: '## B' } }]);
    expect(doc.get('t')!.text).toEqual({ value: '## B', format: 'md', size: 'l' });
    doc.apply([{ op: 'set', id: 't', patch: { text: { value: '- C' } } }], fellow);
    expect(doc.get('t')!.text).toEqual({ value: '- C', format: 'md', size: 'l' });
    doc.apply([{ op: 'set', id: 't', patch: { text: { value: '- C', format: 'plain' } } }]);
    expect(doc.get('t')!.text!.format).toBe('plain');
  });

  it('validates format', () => {
    const add = (format: string) =>
      v.safeParse(OpSchema, {
        op: 'add',
        item: { kind: 'rect', text: { value: 'x', format } },
      }).success;
    expect(add('md')).toBe(true);
    expect(add('plain')).toBe(true);
    expect(add('html')).toBe(false);
    const doc = createDoc();
    expect(
      doc.apply([
        { op: 'add', item: { kind: 'rect', text: { value: 'x', format: 'html' as 'md' } } },
      ]).ok,
    ).toBe(false);
  });
});

describe('md SVG export', () => {
  it('emits matching tspans and no markers', () => {
    const doc = createDoc();
    doc.apply(
      [
        {
          op: 'add',
          item: {
            id: 'card',
            kind: 'rect',
            x: 0,
            y: 0,
            w: 320,
            h: 220,
            text: { value: lesson, format: 'md', align: 'start', size: 20 },
          },
        },
      ],
      fellow,
    );
    const svg = exportSVG(doc.toJSON(), doc.toJSON().pages[0].items, { labels: true });
    expect(svg).toContain('font-size="30" font-weight="700">Plan</tspan>');
    expect(svg).toContain('<tspan font-weight="700">bold</tspan>');
    expect(svg).toContain('<tspan font-style="italic">italic</tspan>');
    // Start-aligned list items: the marker at the padding, the content one hanging indent further.
    expect(svg).toMatch(/<tspan x="12" y="[\d.]+">•<\/tspan><tspan x="36" y="[\d.]+">First /);
    const visible = svg.replace(/<title>[^<]*<\/title>/g, '').replace(/<[^>]+>/g, '');
    expect(visible).not.toContain('**');
    expect(visible).not.toContain('# ');
    expect(visible).not.toContain('- ');
    expect(svg).toContain('>card</text>');
    const ys = [...svg.matchAll(/<tspan x="[\d.]+" y="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(Math.max(...ys)).toBeLessThan(220);
  });

  it('centers rows with the marker in front and keeps plain export unchanged', () => {
    const doc = createDoc();
    doc.apply([
      {
        op: 'add',
        item: {
          id: 'c',
          kind: 'note',
          x: 0,
          y: 0,
          w: 240,
          h: 200,
          text: { value: '1. One', format: 'md' },
        },
      },
      {
        op: 'add',
        item: {
          id: 'p',
          kind: 'rect',
          x: 0,
          y: 300,
          w: 180,
          h: 110,
          text: { value: '# Not a heading' },
        },
      },
    ]);
    const svg = exportSVG(doc.toJSON(), doc.toJSON().pages[0].items, { theme: 'dark' });
    expect(svg).toMatch(/text-anchor="middle"[^>]*><tspan x="120" y="[\d.]+">1\. One<\/tspan>/);
    expect(svg).toContain('<tspan x="90" dy="0"># Not a heading</tspan>');
  });
});

describe('text placement gap', () => {
  it('stacks eleven text lines in less than 600 px under the Fellow defaults', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    doc.apply([{ op: 'add', item: { id: 'l0', kind: 'text', text: 'Line 0' } }], fellow);
    for (let index = 1; index < 11; index++)
      expect(
        doc.apply(
          [
            {
              op: 'add',
              item: { id: `l${index}`, kind: 'text', text: `Line ${index}` },
              place: { below: `l${index - 1}` },
            },
          ],
          fellow,
        ).ok,
      ).toBe(true);
    const lines = Array.from({ length: 11 }, (_, index) => doc.get(`l${index}`)!);
    const top = Math.min(...lines.map((item) => item.y));
    const bottom = Math.max(...lines.map((item) => item.y + item.h));
    expect(bottom - top).toBeLessThan(600);
    const line = Math.ceil(18 * 1.35);
    for (let index = 1; index < 11; index++)
      expect(lines[index].y).toBe(lines[index - 1].y + lines[index - 1].h + line);
  });

  it('uses the larger text, an explicit gap, and the node gap for other kinds', () => {
    const doc = createDoc(undefined, { agentPlaceGap: 120 });
    doc.apply(
      [
        { op: 'add', item: { id: 'big', kind: 'text', text: { value: 'Title', size: 'xl' } } },
        { op: 'add', item: { id: 'small', kind: 'text', text: 'Body' }, place: { below: 'big' } },
        {
          op: 'add',
          item: { id: 'far', kind: 'text', text: 'Far' },
          place: { below: 'small', gap: 70 },
        },
        { op: 'add', item: { id: 'box', kind: 'rect', text: 'Box' }, place: { below: 'far' } },
        { op: 'add', item: { id: 'side', kind: 'text', text: 'Side' }, place: { rightOf: 'big' } },
      ],
      fellow,
    );
    const get = (id: string) => doc.get(id)!;
    expect(get('small').y).toBe(get('big').y + get('big').h + Math.ceil(36 * 1.35));
    expect(get('far').y).toBe(get('small').y + get('small').h + 70);
    expect(get('box').y).toBe(get('far').y + get('far').h + 120);
    expect(get('side').x).toBe(get('big').x + get('big').w + Math.ceil(36 * 1.35));
    expect(get('big').h).toBe(Math.ceil(36 * 1.35));
  });
});
