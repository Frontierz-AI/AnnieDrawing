import RBush from 'rbush';
import type { AgentPresenceOptions, AnnieDoc, Box, Item, Point } from '../core/types';
import { applyDraft } from '../core/item';
import { lockedItems } from '../core/locks';
import { boundsOf, boxCorners, flattenItems, itemBounds, type OutlineResolver } from '../geo/index';
import { createKindRegistry, type KindDef } from '../kinds/registry';
import { ItemView } from './itemView';
import { Lens } from './lens';
import { AgentPresence } from './presence';
import { color, esc, pathFromPoints, SVG_NS } from './paint';

export interface StageOptions {
  agentPresence?: boolean | AgentPresenceOptions;
  theme?: 'light' | 'dark' | 'auto';
  kinds?: KindDef[];
  sanitizeHTML?: (html: string) => string;
}
interface Entry {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
}
interface RecordView {
  view: ItemView;
  entry: Entry;
  hidden: boolean;
}
export class Stage {
  readonly root = document.createElement('div');
  readonly world = document.createElement('div');
  readonly overlay = document.createElementNS(SVG_NS, 'svg');
  readonly lens: Lens;
  readonly kinds: Map<string, KindDef>;
  readonly resolveOutline: OutlineResolver = (item) => this.kinds.get(item.kind)?.outline?.(item);
  private grid = document.createElement('div');
  private records = new Map<string, RecordView>();
  private lookup = new Map<string, Item>();
  private originals = new Map<string, Item>();
  private ancestors = new Map<string, string[]>();
  private locked = new Set<string>();
  private presence?: AgentPresence;
  private dependencies = new Map<string, Set<string>>();
  private previousDrafts = new Set<string>();
  private paintedTheme?: 'light' | 'dark';
  private index = new RBush<Entry>();
  private visible = new Set<string>();
  private selected: string[] = [];
  private marquee?: Box;
  private overlayMarkup = '';
  private theme: 'light' | 'dark' = 'light';
  private mediaQuery?: MediaQueryList;
  private mediaListener?: () => void;
  private settleTimer?: ReturnType<typeof setTimeout>;
  private cameraFrame = 0;
  private disposed = false;
  private doc?: AnnieDoc;
  private pageId?: string;
  private drafts?: Map<string, Partial<Item>>;
  constructor(
    readonly host: HTMLElement,
    readonly options: StageOptions = {},
  ) {
    this.kinds = createKindRegistry(options.kinds);
    this.root.className = 'ad-root';
    this.root.tabIndex = 0;
    this.root.setAttribute('role', 'application');
    this.root.setAttribute('aria-label', 'Drawing board');
    this.grid.className = 'ad-grid';
    this.world.className = 'ad-world';
    this.overlay.classList.add('ad-overlay');
    this.overlay.setAttribute('aria-label', 'Selection controls');
    this.root.append(this.grid, this.world, this.overlay);
    host.append(this.root);
    this.lens = new Lens(this.root);
    this.lens.onChange(() => {
      if (!this.cameraFrame)
        this.cameraFrame = requestAnimationFrame(() => {
          this.cameraFrame = 0;
          this.updateCamera();
        });
    });
    if (typeof matchMedia !== 'undefined') {
      this.mediaQuery = matchMedia('(prefers-color-scheme: dark)');
      this.mediaListener = () => {
        if (!options.theme || options.theme === 'auto') this.setTheme('auto');
      };
      this.mediaQuery.addEventListener('change', this.mediaListener);
    }
    this.setTheme(options.theme ?? 'light');
    this.updateCamera();
  }
  setTheme(theme: 'light' | 'dark' | 'auto'): void {
    this.options.theme = theme;
    this.theme = theme === 'auto' ? (this.mediaQuery?.matches ? 'dark' : 'light') : theme;
    this.root.dataset.theme = this.theme;
    if (this.doc && this.pageId) this.render(this.doc, this.pageId, this.drafts);
  }
  get resolvedTheme(): 'light' | 'dark' {
    return this.theme;
  }
  whenPresentationIdle(callback: () => void) {
    if (!this.presence) callback();
    else this.presence.whenIdle(callback);
  }
  present(ids: string[], name?: string) {
    if (this.options.agentPresence === false) return;
    const added = new Set(ids);
    const placements = ids
      .filter((id) => !this.ancestors.get(id)?.some((id) => added.has(id)))
      .flatMap((id) => {
        const record = this.records.get(id),
          item = this.lookup.get(id);
        if (!record || !item || record.hidden) return [];
        return [
          {
            box: record.view.bounds,
            elements: flattenItems([item]).flatMap((child) => {
              const record = this.records.get(child.id);
              return record && !record.hidden ? [record.view.element] : [];
            }),
          },
        ];
      });
    if (placements.length) {
      this.presence ??= new AgentPresence(
        this.root,
        this.lens,
        typeof this.options.agentPresence === 'object' ? this.options.agentPresence : undefined,
      );
      this.presence.enqueue(placements, name);
    }
  }
  finishPresentation() {
    this.presence?.clear();
  }
  prunePresentation() {
    this.presence?.prune();
  }
  isPending(id: string) {
    const element = this.records.get(id)?.view.element;
    return !!element && !!this.presence?.holds(element);
  }
  render(doc: AnnieDoc, pageId: string, drafts?: Map<string, Partial<Item>>): void {
    if (this.disposed) return;
    const incremental =
      this.doc === doc && this.pageId === pageId && this.paintedTheme === this.theme;
    this.doc = doc;
    this.pageId = pageId;
    this.drafts = drafts;
    if (incremental) {
      this.renderDrafts(drafts);
      return;
    }
    this.paintedTheme = this.theme;
    const page = doc.pages.find((candidate) => candidate.id === pageId);
    this.root.style.backgroundColor = color(
      page?.background ?? (this.theme === 'dark' ? '#122f32' : '#fbfcfa'),
      this.theme,
    );
    const entries: { item: Item; hidden: boolean }[] = [];
    this.lookup.clear();
    this.originals.clear();
    this.ancestors.clear();
    this.dependencies.clear();
    const walk = (items: Item[], parents: Item[], parentHidden: boolean) => {
      for (const original of items) {
        const item = applyDraft(original, drafts?.get(original.id));
        const hidden = parentHidden || !!item.hidden;
        this.lookup.set(item.id, item);
        this.originals.set(item.id, original);
        this.ancestors.set(
          item.id,
          parents.map((parent) => parent.id),
        );
        if (item.kind === 'connector')
          for (const endpoint of [item.from, item.to]) {
            if (!endpoint || !('item' in endpoint)) continue;
            const dependents = this.dependencies.get(endpoint.item) ?? new Set<string>();
            dependents.add(item.id);
            this.dependencies.set(endpoint.item, dependents);
          }
        entries.push({ item, hidden });
        if (item.children) walk(item.children, [...parents, item], hidden);
      }
    };
    walk(page?.items ?? [], [], false);
    this.locked = lockedItems(page?.items ?? []);
    const retained = new Set<string>();
    for (let order = 0; order < entries.length; order++) {
      const { item, hidden } = entries[order];
      retained.add(item.id);
      let record = this.records.get(item.id);
      const box = itemBounds(item, this.lookup, this.resolveOutline);
      const entry = {
        minX: box.x,
        minY: box.y,
        maxX: box.x + box.w,
        maxY: box.y + box.h,
        id: item.id,
      };
      if (!record) {
        const view = new ItemView(item.id);
        record = { view, entry, hidden };
        this.records.set(item.id, record);
        this.index.insert(entry);
      } else if (
        record.entry.minX !== entry.minX ||
        record.entry.minY !== entry.minY ||
        record.entry.maxX !== entry.maxX ||
        record.entry.maxY !== entry.maxY
      ) {
        this.index.remove(record.entry);
        record.entry = entry;
        this.index.insert(entry);
      }
      record.hidden = hidden;
      record.view.bounds = box;
      record.view.paint(
        item,
        doc,
        this.lookup,
        this.theme,
        this.kinds.get(item.kind),
        this.options.sanitizeHTML,
        this.resolveOutline,
      );
      if (record.view.element.style.zIndex !== String(order))
        record.view.element.style.zIndex = String(order);
    }
    for (const [id, record] of this.records) {
      if (retained.has(id)) continue;
      this.index.remove(record.entry);
      record.view.destroy();
      this.records.delete(id);
      this.visible.delete(id);
    }
    // DOM order follows reading order; explicit stacking preserves the document's paint order.
    const readingOrder = entries
      .map(({ item }) => this.records.get(item.id)!)
      .sort((a, b) => a.view.bounds.y - b.view.bounds.y || a.view.bounds.x - b.view.bounds.x);
    for (let position = 0; position < readingOrder.length; position++) {
      const element = readingOrder[position].view.element;
      if (this.world.children[position] !== element)
        this.world.insertBefore(element, this.world.children[position] ?? null);
    }
    this.previousDrafts = new Set(drafts?.keys());
    this.updateCulling();
    this.paintOverlay();
    this.presence?.prune();
  }
  private renderDrafts(drafts?: Map<string, Partial<Item>>): void {
    const dirty = new Set([...this.previousDrafts, ...(drafts?.keys() ?? [])]);
    for (const id of dirty) {
      const original = this.originals.get(id);
      if (!original) continue;
      const patch = drafts?.get(id);
      this.lookup.set(id, applyDraft(original, patch));
      for (const ancestor of this.ancestors.get(id) ?? []) dirty.add(ancestor);
      if (original.children)
        for (const child of flattenItems(original.children)) dirty.add(child.id);
    }
    for (const id of [...dirty])
      for (const dependent of this.dependencies.get(id) ?? []) dirty.add(dependent);
    // Automatic elbows also depend on other nodes and earlier connector lanes.
    if (dirty.size)
      for (const item of this.lookup.values())
        if (item.kind === 'connector' && item.route === 'elbow' && !item.waypoints?.length)
          dirty.add(item.id);
    for (const id of dirty) {
      const item = this.lookup.get(id),
        record = this.records.get(id);
      if (!item || !record) continue;
      const box = itemBounds(item, this.lookup, this.resolveOutline);
      const entry = { minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h, id };
      if (JSON.stringify(entry) !== JSON.stringify(record.entry)) {
        this.index.remove(record.entry);
        this.index.insert(entry);
        record.entry = entry;
      }
      record.view.bounds = box;
      const parents = (this.ancestors.get(id) ?? [])
        .map((parent) => this.lookup.get(parent)!)
        .filter(Boolean);
      record.hidden = !!item.hidden || parents.some((parent) => parent.hidden);
      record.view.paint(
        item,
        this.doc!,
        this.lookup,
        this.theme,
        this.kinds.get(item.kind),
        this.options.sanitizeHTML,
        this.resolveOutline,
      );
    }
    this.previousDrafts = new Set(drafts?.keys());
    if (dirty.size) {
      this.updateCulling();
      this.paintOverlay();
    }
    this.presence?.prune();
  }
  setSelection(ids: string[]): void {
    if (
      ids.length === this.selected.length &&
      ids.every((id, index) => id === this.selected[index])
    )
      return;
    const previous = new Set(this.selected);
    this.selected = [...ids];
    for (const id of previous)
      if (!ids.includes(id)) this.records.get(id)?.view.element.removeAttribute('data-ad-selected');
    for (const id of ids)
      this.records.get(id)?.view.element.setAttribute('data-ad-selected', 'true');
    this.paintOverlay();
  }
  setMarquee(box?: Box): void {
    this.marquee = box;
    this.paintOverlay();
  }
  private updateCamera(): void {
    const { x, y, zoom } = this.lens.state;
    this.world.style.transform = `translate3d(${x}px,${y}px,0) scale(${zoom})`;
    this.world.style.willChange = 'transform';
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.world.style.willChange = '';
    }, 150);
    const gridSize = 24 * zoom * (zoom < 0.3 ? 4 : zoom < 0.6 ? 2 : 1);
    this.grid.style.backgroundSize = `${gridSize}px ${gridSize}px`;
    this.grid.style.backgroundPosition = `${x}px ${y}px`;
    this.updateCulling();
    this.paintOverlay();
  }
  private updateCulling(): void {
    const viewport = this.lens.viewport(200);
    const candidates = this.index.search({
      minX: viewport.x,
      minY: viewport.y,
      maxX: viewport.x + viewport.w,
      maxY: viewport.y + viewport.h,
    });
    const visible = new Set(
      candidates
        .filter((candidate) => !this.records.get(candidate.id)?.hidden)
        .map((candidate) => candidate.id),
    );
    for (const id of this.visible) {
      if (!visible.has(id)) {
        const record = this.records.get(id);
        if (record) record.view.element.style.display = 'none';
      }
    }
    for (const id of visible) {
      if (!this.visible.has(id)) {
        const record = this.records.get(id);
        if (record) record.view.element.style.display = '';
      }
    }
    this.visible = visible;
  }
  private paintOverlay(): void {
    const parts: string[] = [];
    const items = this.selected
      .map((id) => this.lookup.get(id))
      .filter((item): item is Item => !!item && !item.hidden);
    if (items.length) {
      const single =
        items.length === 1 && !['connector', 'line', 'path', 'group'].includes(items[0].kind);
      const box = single ? items[0] : boundsOf(items, this.lookup, this.resolveOutline);
      const rotation = single ? (items[0].rotation ?? 0) : 0;
      const points = boxCorners(box, rotation).map((point) => this.lens.toScreen(point));
      parts.push(`<path class="ad-selection-outline" d="${pathFromPoints(points, true)}"/>`);
      const positions: [string, Point, string][] = [
        ['nw', points[0], 'nwse-resize'],
        [
          'n',
          { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
          'ns-resize',
        ],
        ['ne', points[1], 'nesw-resize'],
        [
          'e',
          { x: (points[1].x + points[2].x) / 2, y: (points[1].y + points[2].y) / 2 },
          'ew-resize',
        ],
        ['se', points[2], 'nwse-resize'],
        [
          's',
          { x: (points[2].x + points[3].x) / 2, y: (points[2].y + points[3].y) / 2 },
          'ns-resize',
        ],
        ['sw', points[3], 'nesw-resize'],
        [
          'w',
          { x: (points[3].x + points[0].x) / 2, y: (points[3].y + points[0].y) / 2 },
          'ew-resize',
        ],
      ];
      if (!items.some((item) => this.locked.has(item.id))) {
        for (const [handle, point, cursor] of positions)
          parts.push(
            `<rect class="ad-selection-handle" data-ad-handle="${handle}" x="${point.x - 4}" y="${point.y - 4}" width="8" height="8" rx="2" style="cursor:${cursor}" aria-label="Resize ${handle}"/>`,
          );
        {
          const top = positions[1][1];
          const theta = (rotation * Math.PI) / 180;
          const point = { x: top.x + Math.sin(theta) * 26, y: top.y - Math.cos(theta) * 26 };
          parts.push(
            `<path class="ad-selection-outline" d="M${top.x},${top.y}L${point.x},${point.y}"/><circle class="ad-selection-handle" data-ad-handle="rotate" cx="${point.x}" cy="${point.y}" r="4.5" style="cursor:grab" aria-label="Rotate"/>`,
          );
        }
      }
    }
    if (items.length === 1 && !this.locked.has(items[0].id)) {
      const item = items[0],
        handles = this.kinds.get(item.kind)?.handles?.(item) ?? [];
      const angle = ((item.rotation ?? 0) * Math.PI) / 180;
      for (const handle of handles) {
        const dx = handle.x - item.w / 2,
          dy = handle.y - item.h / 2;
        const point = this.lens.toScreen({
          x: item.x + item.w / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
          y: item.y + item.h / 2 + dx * Math.sin(angle) + dy * Math.cos(angle),
        });
        parts.push(
          `<circle class="ad-selection-handle ad-custom-handle" data-ad-custom-handle="${esc(handle.id)}" data-ad-handle="custom:${esc(handle.id)}" cx="${point.x}" cy="${point.y}" r="5" style="cursor:${esc(handle.cursor ?? 'crosshair')}" aria-label="${esc(handle.label ?? handle.id)}"/>`,
        );
      }
    }
    if (this.marquee) {
      const p = this.lens.toScreen(this.marquee);
      parts.push(
        `<rect class="ad-marquee" x="${p.x}" y="${p.y}" width="${Math.max(0, this.marquee.w * this.lens.zoom)}" height="${Math.max(0, this.marquee.h * this.lens.zoom)}"/>`,
      );
    }
    const markup = parts.join('');
    if (markup !== this.overlayMarkup) {
      this.overlayMarkup = markup;
      this.overlay.innerHTML = markup;
    }
  }
  destroy(): void {
    this.disposed = true;
    this.presence?.destroy();
    clearTimeout(this.settleTimer);
    cancelAnimationFrame(this.cameraFrame);
    if (this.mediaQuery && this.mediaListener)
      this.mediaQuery.removeEventListener('change', this.mediaListener);
    this.lens.destroy();
    for (const record of this.records.values()) record.view.destroy();
    this.records.clear();
    this.index.clear();
    this.root.remove();
  }
}
