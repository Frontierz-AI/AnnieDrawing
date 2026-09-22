import type { AnnieDoc, Box, Item, Point } from '../core/types';
import type { KindDef, KindView } from '../kinds/registry';
import { routeConnector, type OutlineResolver } from '../geo/index';
import {
  color,
  esc,
  fontFamily,
  fontSize,
  headsMarkup,
  shapeMarkup,
  labelColor,
  SVG_NS,
} from './paint';

/** Transform and opacity each view last painted, so an arrival animation can end on a later move. */
export const painted = new WeakMap<HTMLElement, { transform: string; opacity: string }>();
export class ItemView implements KindView {
  readonly element = document.createElement('div');
  readonly shape = document.createElementNS(SVG_NS, 'svg');
  readonly text = document.createElement('div');
  private auxiliary = document.createElement('div');
  private previous = new Map<string, string>();
  private currentKind?: string;
  private currentDefinition?: KindDef;
  private unmount?: () => void;
  doc!: AnnieDoc;
  item!: Item;
  bounds!: Box;
  constructor(readonly id: string) {
    this.element.className = 'ad-item';
    this.element.style.display = 'none';
    this.element.dataset.adId = id;
    this.element.tabIndex = 0;
    this.element.setAttribute('role', 'img');
    this.shape.classList.add('ad-shape');
    this.shape.setAttribute('aria-hidden', 'true');
    this.shape.setAttribute('overflow', 'visible');
    this.text.className = 'ad-text';
    this.auxiliary.className = 'ad-auxiliary';
    this.element.append(this.shape, this.text, this.auxiliary);
  }
  private remember(value: { transform?: string; opacity?: string }) {
    const last = painted.get(this.element) ?? { transform: '', opacity: '1' };
    painted.set(this.element, { ...last, ...value });
  }
  private changed(key: string, value: string): boolean {
    if (this.previous.get(key) === value) return false;
    this.previous.set(key, value);
    return true;
  }
  paint(
    item: Item,
    doc: AnnieDoc,
    lookup: Map<string, Item>,
    theme: 'light' | 'dark',
    definition?: KindDef,
    sanitizeHTML?: (html: string) => string,
    outline?: OutlineResolver,
  ): void {
    this.doc = doc;
    this.item = item;
    const changed = new Set<string>();
    const custom = !!(definition?.mount || definition?.paint);
    let mount = false;
    if (this.currentKind !== item.kind || this.currentDefinition !== definition) {
      this.unmount?.();
      this.unmount = undefined;
      this.currentKind = item.kind;
      this.currentDefinition = definition;
      this.previous.clear();
      const display = this.element.style.display;
      this.element.removeAttribute('style');
      this.element.style.display = display;
      this.element.className = 'ad-item';
      delete this.element.dataset.adInteractive;
      this.shape.removeAttribute('style');
      this.text.removeAttribute('style');
      this.auxiliary.removeAttribute('style');
      this.element.replaceChildren(this.shape, this.text, this.auxiliary);
      this.shape.replaceChildren();
      this.text.replaceChildren();
      this.auxiliary.replaceChildren();
      this.auxiliary.className = 'ad-auxiliary';
      this.shape.style.display = '';
      this.element.dataset.adKind = item.kind;
      if (['image', 'video', 'link'].includes(item.kind)) this.auxiliary.classList.add('ad-card');
      mount = true;
    }
    const connector = item.kind === 'connector' ? routeConnector(item, lookup, outline) : undefined;
    const transform = connector
      ? ''
      : `translate3d(${item.x}px,${item.y}px,0) rotate(${item.rotation ?? 0}deg)`;
    if (this.changed('transform', transform)) {
      this.element.style.transform = transform;
      this.remember({ transform });
      changed.add('transform');
    }
    const size = `${item.w}|${item.h}`;
    if (this.changed('size', size)) {
      this.element.style.width = `${connector ? 1 : item.w}px`;
      this.element.style.height = `${connector ? 1 : item.h}px`;
      this.shape.setAttribute('width', String(connector ? 1 : item.w));
      this.shape.setAttribute('height', String(connector ? 1 : item.h));
      changed.add('geometry');
    }
    const style = JSON.stringify([item.style, theme]);
    if (this.changed('style', style)) {
      const opacity = String(item.style?.opacity ?? 1);
      this.element.style.opacity = opacity;
      this.remember({ opacity });
      this.element.style.color = color('ink', theme);
      this.text.style.color = labelColor(item, theme);
      changed.add('style');
    }
    const geometry = JSON.stringify([
      size,
      item.kind,
      item.points,
      item.closed,
      item.heads,
      connector?.d,
      style,
    ]);
    if (this.changed('geometry', geometry)) {
      changed.add('geometry');
      if (!custom) {
        const shapeKinds = ['rect', 'ellipse', 'diamond', 'note', 'line', 'path', 'connector'];
        this.shape.style.display = shapeKinds.includes(item.kind) ? '' : 'none';
        if (shapeKinds.includes(item.kind)) {
          const points: Point[] =
            connector?.points ??
            (
              item.points ?? [
                [0, 0],
                [item.w, item.h],
              ]
            ).map(([x, y]) => ({ x, y }));
          this.shape.innerHTML =
            shapeMarkup(item, theme, this.id, connector?.d) +
            (item.kind === 'line' || connector ? headsMarkup(points, item, theme) : '');
        }
      }
    }
    const textKey = JSON.stringify([item.text, item.kind, connector?.midpoint, theme]);
    if (this.changed('text', textKey)) {
      changed.add('text');
      if (!custom) {
        if (!this.text.isContentEditable) this.text.textContent = item.text?.value ?? '';
        this.text.style.fontSize = `${fontSize(item.text)}px`;
        this.text.style.fontFamily = fontFamily(item.text?.font);
        this.text.style.textAlign = item.text?.align ?? (item.kind === 'text' ? 'start' : 'center');
        this.text.style.justifyContent =
          item.text?.valign === 'top'
            ? 'flex-start'
            : item.text?.valign === 'bottom'
              ? 'flex-end'
              : 'center';
        this.text.style.alignItems =
          item.text?.align === 'start' || (item.kind === 'text' && !item.text?.align)
            ? 'flex-start'
            : item.text?.align === 'end'
              ? 'flex-end'
              : 'center';
        this.text.style.display = item.text || this.text.isContentEditable ? 'flex' : 'none';
        if (connector) {
          this.text.style.left = `${connector.midpoint.x}px`;
          this.text.style.top = `${connector.midpoint.y}px`;
          this.text.style.backgroundColor = color('paper', theme);
        } else {
          this.text.style.left = '';
          this.text.style.top = '';
          this.text.style.backgroundColor = '';
        }
      }
    }
    const auxiliary = JSON.stringify([
      item.kind,
      item.name,
      item.html,
      item.href,
      item.description,
      item.text?.value,
      item.media,
      item.media ? doc.media[item.media]?.src : undefined,
      theme,
      !!definition,
      item.crop,
    ]);
    if (this.changed('auxiliary', auxiliary)) {
      changed.add('content');
      if (!custom) {
        this.auxiliary.replaceChildren();
        if (item.kind === 'image') {
          const media = item.media ? doc.media[item.media] : undefined;
          if (media) {
            const img = document.createElement('img');
            img.draggable = false;
            img.alt = item.name ?? item.text?.value ?? 'Image';
            // Only images accepted by the model are ever assigned here.
            img.src = media.src;
            if (item.crop && item.crop.w > 0 && item.crop.h > 0) {
              img.style.width = `${(media.w / item.crop.w) * 100}%`;
              img.style.height = `${(media.h / item.crop.h) * 100}%`;
              img.style.left = `${(-item.crop.x / item.crop.w) * 100}%`;
              img.style.top = `${(-item.crop.y / item.crop.h) * 100}%`;
            }
            this.auxiliary.append(img);
          } else this.placeholder('Image unavailable');
        } else if (item.kind === 'video' || item.kind === 'link') {
          const stamp = auxiliary;
          void import('./cards').then(({ paintCard }) => {
            if (this.previous.get('auxiliary') === stamp) paintCard(this.auxiliary, item, this.doc);
          });
        } else if (item.kind === 'html') {
          this.auxiliary.classList.add('ad-html-content');
          if (sanitizeHTML) this.auxiliary.innerHTML = sanitizeHTML(item.html ?? '');
          else this.auxiliary.textContent = item.html ?? 'HTML content';
        } else if (!definition) this.placeholder(`Unknown kind: ${item.kind}`);
      }
    }
    if (this.changed('access', `${item.locked}|${item.hidden}`)) {
      this.element.classList.toggle('ad-locked', !!item.locked);
      this.element.tabIndex = item.hidden ? -1 : 0;
    }
    const label =
      definition?.summarize?.(item) ??
      `${item.kind === 'rect' ? 'Rectangle' : item.kind[0].toUpperCase() + item.kind.slice(1)}${item.text?.value || item.name || item.href ? `: ${item.text?.value ?? item.name ?? item.href}` : ''}`;
    if (this.changed('aria', label)) this.element.setAttribute('aria-label', label);
    if (
      custom &&
      this.changed(
        'custom',
        JSON.stringify(
          Object.fromEntries(
            Object.entries(item).filter(
              ([key]) =>
                ![
                  'x',
                  'y',
                  'w',
                  'h',
                  'rotation',
                  'style',
                  'text',
                  'points',
                  'heads',
                  'closed',
                ].includes(key),
            ),
          ),
        ),
      )
    )
      changed.add('content');
    if (mount) {
      const cleanup = definition?.mount?.(this);
      if (typeof cleanup === 'function') this.unmount = cleanup;
    }
    definition?.paint?.(this, item, changed);
  }
  private placeholder(label: string): void {
    const placeholder = document.createElement('div');
    placeholder.className = 'ad-placeholder';
    placeholder.innerHTML = `<span aria-hidden="true">◇</span><span>${esc(label)}</span>`;
    this.auxiliary.append(placeholder);
  }
  destroy(): void {
    this.unmount?.();
    this.unmount = undefined;
    this.element.remove();
  }
}
