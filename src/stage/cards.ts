import { normalizeHref, videoEmbed } from '../core/links';
import { displayUrl, prettyTitle } from '../core/paste';
import type { AnnieDoc, Item } from '../core/types';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

function ensureCss() {
  if (document.getElementById('ad-card-css')) return;
  const style = document.createElement('style');
  style.id = 'ad-card-css';
  style.textContent =
    '.ad-video{display:block;width:100%;height:100%;border:0;pointer-events:none;background:#103639}.ad-item[data-ad-interactive=true] .ad-video{pointer-events:auto}.ad-link{display:flex;flex-direction:column;height:100%;min-width:0;min-height:0;overflow:hidden;container-type:size;background:var(--ad-paper,#fff);color:var(--ad-ink,#103639)}.ad-link-media{position:relative;flex:1 1 46%;min-height:0;background:#8f93f914}.ad-link-media img{width:100%;height:100%;object-fit:cover}.ad-link-mark{position:absolute;inset:0;display:grid;place-items:center;color:#8f93f9;font-size:36px;font-weight:800}.ad-link-body{display:flex;flex:0 0 auto;flex-direction:column;gap:4px;min-width:0;padding:10px 12px 12px}.ad-link-title,.ad-link-url{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.ad-link-title{font-size:15px;font-weight:800}.ad-link-url{color:#606062;font-size:12px}.ad-root[data-theme=dark] .ad-link-url{color:#b6c5c1}.ad-link-open{flex:0 0 auto;align-self:start;margin-top:2px;padding:5px 10px;border-radius:999px;background:#05d9ab;color:#103639;font-size:11px;font-weight:800;text-decoration:none;pointer-events:auto}@container (max-height:160px){.ad-link-media{flex-basis:34%}.ad-link-body{padding:8px 10px 10px}.ad-link-title{font-size:13px}.ad-link-url{font-size:11px}}@container (max-height:118px){.ad-link-media{display:none}.ad-link-open{padding:4px 8px}}@container (max-width:150px){.ad-link-title{font-size:12px}.ad-link-url{font-size:10px}.ad-link-open{padding:4px 8px;font-size:10px}}';
  document.head.append(style);
}

export function paintCard(root: HTMLElement, item: Item, doc: AnnieDoc) {
  ensureCss();
  if (item.kind === 'video') {
    const src = videoEmbed(item.href);
    if (!src) {
      root.innerHTML =
        '<div class="ad-placeholder"><span aria-hidden="true">◇</span><span>Video unavailable</span></div>';
      return;
    }
    const frame = document.createElement('iframe');
    frame.className = 'ad-video';
    frame.src = src;
    frame.title = item.name ?? item.text?.value ?? 'Video';
    frame.allow = 'autoplay; fullscreen; picture-in-picture';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-presentation allow-popups',
    );
    root.append(frame);
    return;
  }
  const href = normalizeHref(item.href);
  const title = item.text?.value || (href ? prettyTitle(href) : item.name || 'Link');
  const card = el('div', 'ad-link');
  const media = el('div', 'ad-link-media');
  const record = item.media ? doc.media[item.media] : undefined;
  if (record) {
    const img = el('img', '');
    img.draggable = false;
    img.alt = '';
    img.src = record.src;
    media.append(img);
  } else media.append(el('span', 'ad-link-mark', title.trim().slice(0, 1).toUpperCase() || '•'));
  const open = el('a', 'ad-link-open', 'Open');
  if (href) {
    open.href = href;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
  } else open.setAttribute('aria-disabled', 'true');
  const url = el('div', 'ad-link-url', href ? displayUrl(href) : '');
  url.hidden = !href;
  const body = el('div', 'ad-link-body');
  body.append(el('div', 'ad-link-title', title), url, open);
  card.append(media, body);
  root.append(card);
}
