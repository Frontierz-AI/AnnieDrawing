import { normalizeHref, videoEmbed } from '../core/links';
import { displayUrl, prettyTitle } from '../core/paste';
import type { AnnieDoc, Item } from '../core/types';

/** Injected once from this async chunk so video/link rules stay out of the 100 KiB editor CSS. */
function ensureCss() {
  if (document.getElementById('ad-card-css')) return;
  const style = document.createElement('style');
  style.id = 'ad-card-css';
  style.textContent = `.annie-video{display:block;width:100%;height:100%;border:0;pointer-events:none;background:#103639}.annie-item[data-ad-interactive=true] .annie-video{pointer-events:auto}.annie-link{display:flex;flex-direction:column;height:100%;min-width:0;min-height:0;overflow:hidden;container-type:size;background:var(--ad-paper,#fff);color:var(--ad-ink,#103639)}.annie-link-media{position:relative;flex:1 1 46%;min-height:0;background:#8f93f914}.annie-link-media img{width:100%;height:100%;object-fit:cover}.annie-link-mark{position:absolute;inset:0;display:grid;place-items:center;color:#8f93f9;font-size:36px;font-weight:800}.annie-link-body{display:flex;flex:0 0 auto;flex-direction:column;gap:4px;min-width:0;padding:10px 12px 12px}.annie-link-title,.annie-link-url{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.annie-link-title{font-size:15px;font-weight:800}.annie-link-url{color:#606062;font-size:12px}.annie-root[data-theme=dark] .annie-link-url{color:#b6c5c1}.annie-link-open{flex:0 0 auto;align-self:start;margin-top:2px;padding:5px 10px;border-radius:999px;background:#05d9ab;color:#103639;font-size:11px;font-weight:800;text-decoration:none;pointer-events:auto}@container (max-height:160px){.annie-link-media{flex-basis:34%}.annie-link-body{padding:8px 10px 10px}.annie-link-title{font-size:13px}.annie-link-url{font-size:11px}}@container (max-height:118px){.annie-link-media{display:none}.annie-link-open{padding:4px 8px}}@container (max-width:150px){.annie-link-title{font-size:12px}.annie-link-url{font-size:10px}.annie-link-open{padding:4px 8px;font-size:10px}}`;
  document.head.append(style);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

export function paintCard(root: HTMLElement, item: Item, doc: AnnieDoc) {
  ensureCss();
  if (item.kind === 'video') {
    const src = videoEmbed(item.href);
    if (!src) {
      root.innerHTML =
        '<div class="annie-placeholder"><span aria-hidden="true">◇</span><span>Video unavailable</span></div>';
      return;
    }
    const frame = document.createElement('iframe');
    frame.className = 'annie-video';
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
  const card = el('div', 'annie-link');
  const media = el('div', 'annie-link-media');
  const record = item.media ? doc.media[item.media] : undefined;
  if (record) {
    const img = el('img', '');
    img.draggable = false;
    img.alt = '';
    img.src = record.src;
    media.append(img);
  } else media.append(el('span', 'annie-link-mark', title.trim().slice(0, 1).toUpperCase() || '•'));
  const open = el('a', 'annie-link-open', 'Open');
  if (href) {
    open.href = href;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
  } else open.setAttribute('aria-disabled', 'true');
  const url = el('div', 'annie-link-url', href ? displayUrl(href) : '');
  url.hidden = !href;
  const body = el('div', 'annie-link-body');
  body.append(el('div', 'annie-link-title', title), url, open);
  card.append(media, body);
  root.append(card);
}
