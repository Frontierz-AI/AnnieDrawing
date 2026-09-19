import { describe, expect, it } from 'vitest';
import { clipboardText } from '../src/core/clipboard';
import { hostnameOf, normalizeHref, parseVideo, videoEmbed } from '../src/core/links';
import {
  classifyPaste,
  decodeEntities,
  displayUrl,
  imageMime,
  linkFallback,
  parseLinkPreview,
  prettyTitle,
} from '../src/core/paste';
import { CARD_CORNER, createDoc } from '../src/core';
import { shapePath } from '../src/stage/paint';

describe('paste URL classification', () => {
  it('recognises YouTube, Vimeo, image and ordinary links', () => {
    expect(classifyPaste('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({
      kind: 'video',
      video: { provider: 'youtube', id: 'dQw4w9WgXcQ' },
    });
    expect(
      classifyPaste('https://www.youtube.com/watch?v=ihe1QbeGt7U&list=RDihe1QbeGt7U'),
    ).toMatchObject({
      kind: 'video',
      video: { provider: 'youtube', id: 'ihe1QbeGt7U' },
    });
    expect(
      classifyPaste('A mix\nhttps://www.youtube.com/watch?v=ihe1QbeGt7U&amp;list=RDihe1QbeGt7U'),
    ).toMatchObject({
      kind: 'video',
      video: { provider: 'youtube', id: 'ihe1QbeGt7U' },
    });
    expect(classifyPaste('https://youtu.be/dQw4w9WgXcQ?si=abc')).toMatchObject({
      kind: 'video',
      video: { provider: 'youtube', id: 'dQw4w9WgXcQ' },
    });
    expect(classifyPaste('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toMatchObject({
      kind: 'video',
      video: { provider: 'youtube', id: 'dQw4w9WgXcQ' },
    });
    expect(classifyPaste('https://www.youtube.com/embed/dQw4w9WgXcQ')).toMatchObject({
      kind: 'video',
      video: { provider: 'youtube', id: 'dQw4w9WgXcQ' },
    });
    expect(classifyPaste('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({
      kind: 'video',
      video: { provider: 'youtube', id: 'dQw4w9WgXcQ' },
    });
    expect(classifyPaste('https://player.vimeo.com/video/123456789')).toMatchObject({
      kind: 'video',
      video: { provider: 'vimeo', id: '123456789' },
    });
    expect(classifyPaste('https://vimeo.com/123456789')).toMatchObject({
      kind: 'video',
      video: { provider: 'vimeo', id: '123456789' },
    });
    expect(classifyPaste('https://example.com/photo.PNG?w=800')).toMatchObject({
      kind: 'image',
    });
    expect(classifyPaste('https://example.com/article')).toMatchObject({
      kind: 'link',
      href: 'https://example.com/article',
    });
    expect(classifyPaste('A pasted thought')).toEqual({
      kind: 'text',
      value: 'A pasted thought',
    });
  });
  it('accepts bare hosts and rejects javascript URLs', () => {
    expect(classifyPaste('example.com/path')).toMatchObject({
      kind: 'link',
      href: 'https://example.com/path',
    });
    expect(normalizeHref('javascript:alert(1)')).toBeUndefined();
    expect(parseVideo('https://vimeo.com/watch')).toBeUndefined();
    expect(classifyPaste('javascript:alert(1)')).toMatchObject({ kind: 'text' });
  });
  it('builds privacy-first embed URLs from parsed ids only', () => {
    expect(videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0',
    );
    expect(videoEmbed('https://vimeo.com/123/abc')).toBe(
      'https://player.vimeo.com/video/123?h=abc',
    );
    expect(videoEmbed('https://example.com')).toBeUndefined();
  });
});

describe('link preview parsing', () => {
  it('reads Open Graph tags and resolves relative images', () => {
    const preview = parseLinkPreview(
      `<html><head>
        <title>Fallback</title>
        <meta property="og:title" content="A &amp; B"/>
        <meta name="description" content="Plain"/>
        <meta property="og:description" content="Rich copy"/>
        <meta property="og:image" content="/cover.jpg"/>
      </head></html>`,
      'https://example.com/post',
    );
    expect(preview).toEqual({
      title: 'A & B',
      description: 'Rich copy',
      image: 'https://example.com/cover.jpg',
    });
    expect(decodeEntities('&#39;')).toBe("'");
    expect(hostnameOf('https://www.example.com/a')).toBe('example.com');
    expect(imageMime('https://cdn.example.com/a.webp')).toBe('image/webp');
    expect(prettyTitle('https://www.founderz.com/')).toBe('Founderz');
    expect(displayUrl('https://founderz.com/')).toBe('founderz.com');
    expect(displayUrl('https://www.founderz.com/notes/')).toBe('founderz.com/notes');
    expect(linkFallback('https://founderz.com/')).toMatchObject({
      title: 'Founderz',
      description: 'founderz.com',
    });
  });
  it('reads the first non-comment uri-list line', () => {
    expect(
      clipboardText({
        getData: (type: string) =>
          type === 'text/uri-list' ? '# comment\nhttps://example.com/a\nhttps://example.com/b' : '',
      } as DataTransfer),
    ).toBe('https://example.com/a');
    expect(clipboardText(null)).toBe('');
  });
});

describe('video and link documents', () => {
  it('stores http(s) hrefs and rejects unsafe or non-embed videos', () => {
    const doc = createDoc();
    expect(
      doc.apply([
        {
          op: 'add',
          item: { id: 'i_vid', kind: 'video', href: 'https://youtu.be/dQw4w9WgXcQ' },
        },
        {
          op: 'add',
          item: {
            id: 'i_link',
            kind: 'link',
            href: 'https://example.com/x',
            text: { value: 'Example' },
            description: 'A site',
          },
        },
      ]).ok,
    ).toBe(true);
    expect(doc.get('i_vid')).toMatchObject({
      kind: 'video',
      href: 'https://youtu.be/dQw4w9WgXcQ',
      w: 480,
      h: 270,
    });
    expect(doc.get('i_link')!.href).toBe('https://example.com/x');
    expect(
      doc.apply([{ op: 'add', item: { id: 'bad', kind: 'video', href: 'https://example.com' } }])
        .ok,
    ).toBe(false);
    expect(
      doc.apply([{ op: 'set', id: 'i_link', patch: { href: 'javascript:alert(1)' } }]).ok,
    ).toBe(false);
    expect(doc.get('i_link')!.href).toBe('https://example.com/x');
  });
  it('uses the shared card corner for sticky notes', () => {
    const path = shapePath({
      id: 'i_note',
      kind: 'note',
      x: 0,
      y: 0,
      w: 100,
      h: 80,
    });
    expect(CARD_CORNER).toBe(12);
    expect(path.startsWith(`M${CARD_CORNER},0`)).toBe(true);
  });
});
