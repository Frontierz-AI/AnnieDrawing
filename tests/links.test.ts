import { describe, expect, it, vi } from 'vitest';
import { clipboardText } from '../src/core/clipboard';
import {
  hostnameOf,
  isPublicHttpUrl,
  normalizeHref,
  parseVideo,
  videoEmbed,
} from '../src/core/links';
import {
  classifyPaste,
  decodeEntities,
  displayUrl,
  imageMime,
  linkFallback,
  parseLinkPreview,
  prettyTitle,
  unfurlPage,
} from '../src/core/paste';
import { CARD_CORNER, createDoc } from '../src/core';
import { updateHref, type PasteHost } from '../src/input/urlPaste';
import { shapePath } from '../src/stage/paint';
import type { ApplyOptions, ApplyResult, Item, Op } from '../src/core/types';

function pasteHost(
  doc: ReturnType<typeof createDoc>,
  unfurl: PasteHost['unfurl'] = false,
): PasteHost {
  return {
    pageId: doc.toJSON().pages[0].id,
    items: [],
    destroyed: false,
    unfurl,
    view: { center: { x: 0, y: 0 } },
    host: { dispatchEvent() {} } as unknown as HTMLElement,
    apply: (ops: Op[], options?: ApplyOptions): ApplyResult => doc.apply(ops, options),
    select() {},
    get: (id: string): Item | undefined => doc.get(id),
  };
}

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
    expect(
      classifyPaste(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgvBn6PwAE+QKJBZFmAAAAAElFTkSuQmCC',
      ),
    ).toMatchObject({ kind: 'image' });
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
    expect(prettyTitle('https://www.frontierz.com/')).toBe('Frontierz');
    expect(displayUrl('https://frontierz.com/')).toBe('frontierz.com');
    expect(displayUrl('https://www.frontierz.com/notes/')).toBe('frontierz.com/notes');
    expect(linkFallback('https://frontierz.com/')).toMatchObject({
      title: 'Frontierz',
      description: 'frontierz.com',
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
  it('replaces a video or link href and rejects a non-embed video URL', async () => {
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
            media: 'm_old',
          },
        },
      ]).ok,
    ).toBe(true);
    const host = pasteHost(doc);
    expect(updateHref(host, 'i_vid', 'https://vimeo.com/123456789').ok).toBe(true);
    expect(doc.get('i_vid')!.href).toBe('https://vimeo.com/123456789');
    expect(updateHref(host, 'i_vid', 'https://example.com/article').ok).toBe(false);
    expect(doc.get('i_vid')!.href).toBe('https://vimeo.com/123456789');
    expect(updateHref(host, 'i_link', 'frontierz.com/notes').ok).toBe(true);
    expect(doc.get('i_link')).toMatchObject({
      href: 'https://frontierz.com/notes',
      name: 'frontierz.com',
      description: 'frontierz.com/notes',
      text: { value: 'Frontierz' },
    });
    expect(doc.get('i_link')!.media).toBeUndefined();
    expect(updateHref(host, 'i_link', 'javascript:alert(1)').ok).toBe(false);
    let fetched = '';
    const previewHost = pasteHost(doc, async (url) => {
      fetched = url;
      return { title: 'Fetched title' };
    });
    expect(updateHref(previewHost, 'i_link', 'https://example.com/next').ok).toBe(true);
    await vi.waitFor(() => expect(doc.get('i_link')!.text?.value).toBe('Fetched title'));
    expect(fetched).toBe('https://example.com/next');
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

describe('public http(s) URLs', () => {
  it('allows ordinary sites and rejects loopback, private, and credentialed URLs', () => {
    expect(isPublicHttpUrl('https://example.com/x')).toBe(true);
    expect(isPublicHttpUrl('http://127.0.0.1:5173/__ad-unfurl')).toBe(false);
    expect(isPublicHttpUrl('http://localhost/meta')).toBe(false);
    expect(isPublicHttpUrl('http://192.168.1.9/router')).toBe(false);
    expect(isPublicHttpUrl('http://169.254.169.254/latest')).toBe(false);
    expect(isPublicHttpUrl('http://10.0.0.4/internal')).toBe(false);
    expect(isPublicHttpUrl('https://user:token@example.com/x')).toBe(false);
    expect(isPublicHttpUrl('http://[::ffff:127.0.0.1]/')).toBe(false);
    expect(isPublicHttpUrl('http://[::ffff:10.0.0.1]/')).toBe(false);
    expect(isPublicHttpUrl('http://[::ffff:169.254.169.254]/')).toBe(false);
    expect(isPublicHttpUrl('http://[64:ff9b::7f00:1]/')).toBe(false);
    expect(isPublicHttpUrl('http://[::1]/')).toBe(false);
    expect(isPublicHttpUrl('http://[fd12:3456::1]/')).toBe(false);
    expect(isPublicHttpUrl('http://127.0.0.1.nip.io/meta')).toBe(false);
    expect(isPublicHttpUrl('http://10.0.0.4.example.test/')).toBe(false);
    expect(isPublicHttpUrl('https://[2001:4860:4860::8888]/')).toBe(true);
  });
  it('does not fetch loopback addresses when unfurling', async () => {
    expect(await unfurlPage('http://127.0.0.1/')).toBeUndefined();
    expect(await unfurlPage('http://localhost:5173/docs')).toBeUndefined();
    expect(await unfurlPage('http://[::ffff:127.0.0.1]/')).toBeUndefined();
  });
  it('drops Open Graph images that are not public http(s) URLs', () => {
    expect(
      parseLinkPreview(
        '<meta property="og:image" content="http://127.0.0.1:6379/cover.jpg"/>',
        'https://example.com/post',
      ).image,
    ).toBeUndefined();
    expect(
      parseLinkPreview(
        '<meta property="og:image" content="http://[::ffff:169.254.169.254]/latest"/>',
        'https://example.com/post',
      ).image,
    ).toBeUndefined();
    expect(
      parseLinkPreview(
        '<meta property="og:image" content="https://cdn.example.com/cover.jpg"/>',
        'https://example.com/post',
      ).image,
    ).toBe('https://cdn.example.com/cover.jpg');
  });
});
