import { hostnameOf, normalizeHref, videoEmbed } from '../core/links';
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
    '.ad-video{display:block;width:100%;height:100%;border:0;pointer-events:none;background:#103639}.ad-item[data-ad-interactive=true] .ad-video{pointer-events:auto}.ad-link{display:flex;flex-direction:column;height:100%;background:var(--ad-paper,#fff);color:var(--ad-ink,#103639)}.ad-link-media{position:relative;flex:0 0 52%;background:#8f93f914}.ad-link-media img{object-fit:cover}.ad-link-mark{position:absolute;inset:0;display:grid;place-items:center;color:#8f93f9;font-size:42px;font-weight:800}.ad-link-body{display:flex;flex:1;flex-direction:column;gap:6px;min-height:0;padding:14px 16px 16px}.ad-link-title,.ad-link-description{overflow:hidden;max-height:2.8em;line-height:1.35}.ad-link-title{font-size:16px;font-weight:800}.ad-link-description{color:#606062;font-size:13px}.ad-root[data-theme=dark] .ad-link-description{color:#b6c5c1}.ad-link-open{margin-top:auto;align-self:start;padding:6px 12px;border-radius:999px;background:#05d9ab;color:#103639;font-size:12px;font-weight:800;text-decoration:none;pointer-events:auto}';
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
  const title = item.text?.value || item.name || (href ? hostnameOf(href) : 'Link');
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
  const description = el('div', 'ad-link-description', item.description ?? '');
  description.hidden = !item.description;
  const body = el('div', 'ad-link-body');
  body.append(el('div', 'ad-link-title', title), description, open);
  card.append(media, body);
  root.append(card);
}
