import { signal } from '@preact/signals-core';
import { CARD_CORNER } from './core/defaults';
import { itemId, mediaId } from './core/ids';
import { createDoc } from './core/doc';
import type { LinkPreview } from './core/links';
import { lockedItems } from './core/locks';
import { describeDoc } from './agent/describe';
import type {
  AnnieDoc,
  ApplyOptions,
  ApplyResult,
  Box,
  ChangeEvent,
  DescribeOptions,
  DocModel,
  Endpoint,
  ExportOptions,
  Item,
  LensState,
  NewItem,
  Op,
  Point,
  Query,
  Scope,
  Style,
} from './core/types';
import { Stage } from './stage/stage';
import {
  SpatialIndex,
  boundsOf as geometryBounds,
  itemBounds,
  rotatePoint,
  resolveEndpoint,
} from './geo/index';
import { getKinds, type KindDef } from './kinds/index';
import { exportSVG } from './porter/svg';
import { exportPNG } from './porter/png';
import { mountUI, type UiOptions } from './ui/index';
import { openAutosave } from './input/autosave';
import { measureText } from './input/measure';
import { cursorForTool } from './input/cursors';

export interface BoardOptions {
  doc?: AnnieDoc;
  agentPresence?: boolean;
  readonly?: boolean;
  theme?: 'light' | 'dark' | 'auto';
  ui?: boolean | UiOptions;
  kinds?: KindDef[];
  autosaveKey?: string;
  exposeGlobal?: boolean;
  allowedImageOrigins?: string[];
  sanitizeHTML?: (html: string) => string;
  unfurl?: false | ((url: string) => Promise<LinkPreview | undefined>);
}
type Events = {
  change: ChangeEvent;
  select: string[];
  view: LensState;
  tool: string;
  page: string;
  save: { status: 'saving' | 'saved' | 'error'; message?: string };
};
type Drag = {
  kind: 'pan' | 'move' | 'resize' | 'rotate' | 'marquee' | 'draw' | 'erase';
  pointer: number;
  start: Point;
  screen: Point;
  last: Point;
  original: Item[];
  ids: string[];
  camera: LensState;
  handle?: string;
  item?: Item;
  points?: [number, number, number?][];
  moved: boolean;
  alt?: boolean;
};
const clone = <T>(value: T): T => structuredClone(value);
export function flatten(items: Item[]): Item[] {
  return items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
}
function boxOf(items: Item[]): Box {
  const list = items.filter((i) => i.kind !== 'connector');
  if (!list.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...list.map((i) => i.x)),
    y = Math.min(...list.map((i) => i.y));
  return {
    x,
    y,
    w: Math.max(...list.map((i) => i.x + i.w)) - x,
    h: Math.max(...list.map((i) => i.y + i.h)) - y,
  };
}
const shortcuts: Record<string, string> = {
  v: 'select',
  h: 'hand',
  r: 'rect',
  o: 'ellipse',
  d: 'diamond',
  l: 'line',
  a: 'connector',
  p: 'path',
  t: 'text',
  n: 'note',
  e: 'eraser',
};
const uid = itemId;
function translation(item: Item, dx: number, dy: number): Partial<Item> {
  const patch: Partial<Item> = { x: (item.x ?? 0) + dx, y: (item.y ?? 0) + dy };
  if (item.kind === 'connector') {
    for (const key of ['from', 'to'] as const) {
      const endpoint = item[key];
      if (endpoint && !('item' in endpoint))
        patch[key] = { x: endpoint.x + dx, y: endpoint.y + dy };
    }
    if (item.waypoints) patch.waypoints = item.waypoints.map(([x, y]) => [x + dx, y + dy]);
  }
  return patch;
}

export class Board {
  readonly host: HTMLElement;
  readonly stage: Stage;
  readonly model: DocModel;
  readonly ready: Promise<void>;
  readonly readonly: boolean;
  readonly selectionSignal = signal<string[]>([]);
  readonly toolSignal = signal('select');
  readonly drafts = new Map<string, Partial<Item>>();
  defaultStyle: Style = { stroke: 'ink', strokeWidth: 2, fill: 'paper', corner: 12 };
  grid = true;
  pageId: string;
  private document: AnnieDoc;
  private spatial = new SpatialIndex();
  private geometryLookup = new Map<string, Item>();
  private hiddenGeometry = new Set<string>();
  private lockedGeometry = new Set<string>();
  private listeners = new Map<keyof Events, Set<(event: never) => void>>();
  private cleanup: (() => void)[] = [];
  private uiCleanup?: () => void;
  private frame = 0;
  private drag?: Drag;
  private rect: DOMRect;
  private space = false;
  private clipboard: Item[] = [];
  private pointers = new Map<number, Point>();
  private pinch?: { distance: number; zoom: number; center: Point; anchor: Point };
  private editor?: HTMLElement;
  private finishEditor?: (save?: boolean) => void;
  private longPressTimer?: ReturnType<typeof setTimeout>;
  private lastTouchTap?: { at: number; screen: Point };
  private touchDoubleAt = 0;
  private enteredGroup?: string;
  private destroyed = false;
  private themeValue: 'light' | 'dark' | 'auto';
  private drawPreview?: Item;
  private previewDocument?: AnnieDoc;
  private previewBase?: AnnieDoc;
  private observer: ResizeObserver;
  private unfurl?: false | ((url: string) => Promise<LinkPreview | undefined>);

  constructor(host: HTMLElement, options: BoardOptions = {}) {
    this.host = host;
    this.readonly = options.readonly ?? false;
    this.model = createDoc(options.doc, {
      readonly: this.readonly,
      allowedImageOrigins: options.allowedImageOrigins,
      kinds: [...getKinds(), ...(options.kinds ?? [])],
      sanitizeHTML: options.sanitizeHTML,
    });
    this.document = this.model.toJSON({ compact: false });
    this.pageId = this.document.pages[0].id;
    this.themeValue = options.theme ?? 'light';
    this.unfurl = options.unfurl;
    this.stage = new Stage(host, {
      agentPresence: options.agentPresence,
      theme: this.themeValue,
      kinds: options.kinds,
      sanitizeHTML: options.sanitizeHTML,
    });
    this.updateCursor();
    this.refreshGeometry();
    this.rect = this.stage.root.getBoundingClientRect();
    this.stage.root.setAttribute('aria-label', 'Drawing board');
    this.stage.root.dataset.adBoard = '';
    this.cleanup.push(
      this.model.on('change', (event) => {
        if (
          !event.origin.startsWith('agent:') ||
          event.ops.some((op) => op.op !== 'add' && op.op !== 'media.set')
        )
          this.stage.finishPresentation();
        this.document = this.model.toJSON({ compact: false });
        if (!this.document.pages.some((s) => s.id === this.pageId))
          this.pageId = this.document.pages[0].id;
        this.refreshGeometry();
        if (
          (this.drag &&
            ['move', 'resize', 'rotate', 'erase'].includes(this.drag.kind) &&
            this.drag.ids.some((id) => this.isLocked(id))) ||
          (this.editor &&
            this.isLocked(this.editor.closest<HTMLElement>('[data-ad-id]')?.dataset.adId ?? ''))
        )
          this.cancel();
        this.select(this.selection.filter((id) => !!this.get(id)));
        this.schedule();
        this.emit('change', event);
      }),
    );
    this.cleanup.push(
      this.stage.lens.onChange((state) => {
        this.schedule();
        this.emit('view', state);
      }),
    );
    const bind = <K extends keyof HTMLElementEventMap>(
      name: K,
      handler: (event: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      this.stage.root.addEventListener(name, handler as EventListener, opts);
      this.cleanup.push(() =>
        this.stage.root.removeEventListener(name, handler as EventListener, opts),
      );
    };
    bind('pointerdown', this.pointerDown);
    bind('pointermove', this.pointerMove);
    bind('pointerup', this.pointerUp);
    bind('pointercancel', this.pointerCancel);
    bind('wheel', this.wheel, { passive: false });
    bind('keydown', this.keyDown);
    bind('keyup', (e) => {
      if (e.code === 'Space') {
        this.space = false;
        this.updateCursor();
      }
    });
    bind('dblclick', this.doubleClick);
    bind('contextmenu', (e) => {
      if (this.isUI(e.target)) return;
      e.preventDefault();
      const targetId = (e.target as Element).closest<HTMLElement>('[data-ad-id]')?.dataset.adId;
      this.openContext(this.point(e), targetId);
    });
    bind('copy', this.copyEvent);
    bind('cut', this.cutEvent);
    bind('paste', this.pasteEvent);
    bind('dragover', (e) => {
      if (!this.readonly) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      }
    });
    bind('drop', this.drop);
    bind('focusin', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-ad-id]');
      if (item && e.target === item && !this.drag) this.select([item.dataset.adId!]);
    });
    const release = () => {
      this.space = false;
      this.finishEditor?.(true);
      this.cancel();
      this.updateCursor();
    };
    window.addEventListener('blur', release);
    this.cleanup.push(() => window.removeEventListener('blur', release));
    this.observer = new ResizeObserver(() => {
      this.rect = this.stage.root.getBoundingClientRect();
      this.schedule();
    });
    this.observer.observe(this.stage.root);
    const scroll = () => {
      this.rect = this.stage.root.getBoundingClientRect();
    };
    window.addEventListener('scroll', scroll, true);
    this.cleanup.push(() => window.removeEventListener('scroll', scroll, true));
    if (options.ui !== false)
      this.uiCleanup = mountUI(this, typeof options.ui === 'object' ? options.ui : {});
    this.render();
    this.view.fit();
    if (options.exposeGlobal !== false) {
      window.__anniedrawing ??= [];
      window.__anniedrawing.push(this);
    }
    this.ready =
      options.autosaveKey && !this.readonly
        ? openAutosave(this, options.autosaveKey)
        : Promise.resolve();
  }
  get selection() {
    return [...this.selectionSignal.value];
  }
  get tool() {
    return this.toolSignal.value;
  }
  get theme() {
    return this.themeValue;
  }
  get canUndo() {
    return this.model.canUndo;
  }
  get canRedo() {
    return this.model.canRedo;
  }
  get items() {
    return flatten(this.document.pages.find((s) => s.id === this.pageId)?.items ?? []);
  }
  get view() {
    const board = this;
    return {
      fit(ids?: string[]) {
        board.stage.lens.fit(board.boundsOf(ids));
      },
      flyTo(box: Box) {
        board.stage.lens.flyTo(box);
      },
      get zoom() {
        return board.stage.lens.state.zoom;
      },
      set zoom(zoom: number) {
        board.zoomAt(zoom, { x: board.rect.width / 2, y: board.rect.height / 2 });
      },
      get center() {
        return board.stage.lens.toPage({ x: board.rect.width / 2, y: board.rect.height / 2 });
      },
      set center(point: Point) {
        const zoom = board.view.zoom;
        board.stage.lens.set({
          x: board.rect.width / 2 - point.x * zoom,
          y: board.rect.height / 2 - point.y * zoom,
        });
      },
    };
  }
  read(scope: Scope | { scope?: Scope; includeDrafts?: boolean } = 'doc'): AnnieDoc {
    const options = typeof scope === 'string' ? { scope } : scope;
    const doc = this.model.toJSON();
    if (options.includeDrafts && this.drawPreview)
      doc.pages.find((s) => s.id === this.pageId)?.items.push(clone(this.drawPreview));
    if (options.scope && options.scope !== 'doc')
      doc.pages = doc.pages.filter((s) => s.id === this.pageId);
    if (options.scope === 'selection' || options.scope === 'viewport') {
      const ids =
        options.scope === 'selection'
          ? new Set(this.selection)
          : new Set(this.items.filter((i) => !i.hidden && this.visible(i)).map((i) => i.id));
      const filter = (items: Item[]): Item[] =>
        items.flatMap((item) => (ids.has(item.id) ? [item] : filter(item.children ?? [])));
      for (const page of doc.pages) page.items = filter(page.items);
    }
    if (options.includeDrafts)
      for (const item of doc.pages.flatMap((s) => flatten(s.items)))
        Object.assign(item, this.drafts.get(item.id));
    if (options.scope && options.scope !== 'doc') {
      const media = new Set(doc.pages.flatMap((s) => flatten(s.items)).map((item) => item.media));
      doc.media = Object.fromEntries(Object.entries(doc.media).filter(([id]) => media.has(id)));
    }
    return doc;
  }
  get(id: string) {
    return this.model.get(id);
  }
  isLocked(id: string) {
    return this.lockedGeometry.has(id);
  }
  private lockedResult(index = 0): ApplyResult {
    return {
      ok: false,
      created: [],
      errors: [{ index, code: 'LOCKED', message: 'Unlock the selection before editing it.' }],
      warnings: [],
    };
  }
  query(selector: Query = {}) {
    return this.model.query(selector);
  }
  describe(options: DescribeOptions = {}) {
    return describeDoc(this.read(options.scope ?? 'doc'), {
      ...options,
      page: options.page ?? (options.scope === 'doc' ? undefined : this.pageId),
      selection: this.selection,
    });
  }
  boundsOf(ids?: string[]): Box {
    const idsSet = ids ? new Set(ids) : undefined;
    const visible = this.spatial.search({ x: -1e7, y: -1e7, w: 2e7, h: 2e7 });
    const selection = idsSet ? visible.filter((item) => idsSet.has(item.id)) : visible;
    return geometryBounds(selection, this.geometryLookup, this.outline);
  }
  apply(ops: Op[], options: ApplyOptions = {}): ApplyResult {
    if (options.origin === 'user' && Array.isArray(ops)) {
      const blocked = ops.findIndex((op) => {
        if (!op || typeof op !== 'object') return false;
        if (op.op === 'set' && op.patch?.locked === false && Object.keys(op.patch).length === 1)
          return false;
        return (
          (['set', 'remove', 'order', 'reparent'].includes(op.op) &&
            'id' in op &&
            this.isLocked(op.id)) ||
          ((op.op === 'add' || op.op === 'reparent') && !!op.parent && this.isLocked(op.parent))
        );
      });
      if (blocked !== -1) return this.lockedResult(blocked);
    }
    const prepare = (op: Op): Op => {
      if (!op || typeof op !== 'object') return op;
      if (op.op === 'add' && op.item) {
        let item = op.item;
        if (
          item.kind === 'text' &&
          item.autoWidth &&
          typeof item.text?.value === 'string' &&
          item.text.value.length <= 100000
        )
          item = { ...item, ...measureText(this.host.ownerDocument, item.text) };
        return { ...op, item, ...(!op.page && !op.parent ? { page: this.pageId } : {}) };
      }
      if (op.op === 'set' && op.patch) {
        const item = this.get(op.id);
        if (
          item?.kind === 'text' &&
          (op.patch.autoWidth ?? item.autoWidth) &&
          (op.patch.text || op.patch.autoWidth)
        ) {
          const text = { ...item.text, ...op.patch.text };
          if (typeof text.value === 'string' && text.value.length <= 100000)
            return {
              ...op,
              patch: {
                ...op.patch,
                ...measureText(this.host.ownerDocument, text as { value: string }),
              },
            };
        }
      }
      return op;
    };
    const result = this.model.apply(Array.isArray(ops) ? ops.map(prepare) : ops, {
      origin: 'api',
      ...options,
    });
    if (
      result.ok &&
      !options.dryRun &&
      options.origin?.startsWith('agent:') &&
      result.created.length
    ) {
      this.render();
      this.stage.present(result.created, options.agentName);
    }
    return result;
  }
  undo(options?: { origin?: string }) {
    this.cancel();
    return this.model.undo(options);
  }
  redo() {
    this.cancel();
    return this.model.redo();
  }
  load(doc: AnnieDoc) {
    this.cancel();
    this.model.load(doc);
    this.document = this.model.toJSON({ compact: false });
    this.pageId = this.document.pages[0].id;
    this.refreshGeometry();
    this.select([]);
    this.render();
    this.view.fit();
  }
  clear() {
    return this.apply(
      (this.document.pages.find((s) => s.id === this.pageId)?.items ?? []).map((i) => ({
        op: 'remove',
        id: i.id,
      })),
      { origin: 'user', label: 'Clear page' },
    );
  }
  select(ids: string[]) {
    const next = [...new Set(ids)].filter((id) => !!this.get(id));
    if (next.join(',') === this.selectionSignal.value.join(',')) return;
    this.selectionSignal.value = next;
    this.stage.setSelection(next);
    this.emit('select', next);
  }
  setTool(id: string) {
    this.cancel();
    this.toolSignal.value = id;
    this.updateCursor();
    this.emit('tool', id);
  }
  setTheme(theme: 'light' | 'dark' | 'auto') {
    this.themeValue = theme;
    this.stage.setTheme(theme);
    this.render();
  }
  setPage(id: string) {
    if (!this.document.pages.some((s) => s.id === id)) return;
    this.cancel();
    this.pageId = id;
    this.refreshGeometry();
    this.enteredGroup = undefined;
    this.select([]);
    this.render();
    this.view.fit();
    this.emit('page', id);
  }
  setGrid(value: boolean) {
    this.grid = value;
    this.stage.root.classList.toggle('ad-no-grid', !value);
  }
  on<K extends keyof Events>(name: K, callback: (event: Events[K]) => void) {
    const set = this.listeners.get(name) ?? new Set();
    set.add(callback as (event: never) => void);
    this.listeners.set(name, set);
    return () => set.delete(callback as (event: never) => void);
  }
  emit<K extends keyof Events>(name: K, event: Events[K]) {
    this.listeners.get(name)?.forEach((fn) => fn(event as never));
  }
  async export(
    format: 'json' | 'svg' | 'png',
    options: ExportOptions = {},
  ): Promise<string | Blob> {
    const doc = this.read(options.scope ?? 'page');
    if (format === 'json') {
      const items = doc.pages.flatMap((s) => flatten(s.items)),
        ids = new Set(items.map((i) => i.id));
      for (const item of items)
        for (const key of ['from', 'to'] as const) {
          const endpoint = item[key];
          if (endpoint && 'item' in endpoint && !ids.has(endpoint.item))
            item[key] = resolveEndpoint(
              endpoint,
              item[key === 'from' ? 'to' : 'from'],
              this.geometryLookup,
              this.outline,
            );
        }
      return JSON.stringify(doc, null, 2);
    }
    const items = doc.pages.flatMap((s) => s.items).map((item) => this.get(item.id) ?? item);
    const svg = exportSVG(this.document, items, {
      ...options,
      theme: this.stage.resolvedTheme,
      kinds: [...this.stage.kinds.values()],
      ...(options.scope === 'viewport' ? { bounds: this.stage.lens.viewport(), padding: 0 } : {}),
    });
    return format === 'svg' ? svg : exportPNG(svg, options.scale ?? 2);
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancel();
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.cleanup.forEach((fn) => fn());
    this.uiCleanup?.();
    this.stage.destroy();
    this.listeners.clear();
    if (window.__anniedrawing)
      window.__anniedrawing = window.__anniedrawing.filter((b) => b !== this);
  }
  addCleanup(fn: () => void) {
    this.cleanup.push(fn);
  }
  focus() {
    this.stage.root.focus({ preventScroll: true });
  }
  add(kind: string, point?: Point) {
    const p = point ?? this.view.center;
    const w = kind === 'text' ? 250 : kind === 'note' ? 210 : 180,
      h = kind === 'text' ? 60 : kind === 'note' ? 180 : 110;
    const result = this.apply(
      [
        {
          op: 'add',
          page: this.pageId,
          item: {
            kind,
            x: p.x - w / 2,
            y: p.y - h / 2,
            w,
            h,
            style: clone(this.defaultStyle),
            ...(kind === 'note'
              ? {
                  style: {
                    ...this.defaultStyle,
                    fill: 'moss',
                    stroke: 'none',
                    corner: CARD_CORNER,
                  },
                  text: { value: 'A little idea', size: 'l' },
                }
              : {}),
            ...(kind === 'text'
              ? {
                  autoWidth: true,
                  text: { value: 'Type something…', size: 'l' },
                  style: { fill: 'none', stroke: 'ink' },
                }
              : {}),
          },
        },
      ],
      { origin: 'user', label: `Add ${kind}` },
    );
    if (result.ok) {
      this.select(result.created);
      if (kind === 'text' || kind === 'note') this.editText(result.created[0]);
    }
    return result;
  }
  updateSelection(patch: Partial<Item>) {
    if (patch.locked === false && Object.keys(patch).length === 1) {
      const selected = new Set(this.selection),
        ids: string[] = [];
      const visit = (item: Item, inside = false): boolean => {
        inside ||= selected.has(item.id);
        let contains = false;
        for (const child of item.children ?? []) contains = visit(child, inside) || contains;
        if (item.locked && (inside || contains)) ids.push(item.id);
        return inside || contains;
      };
      this.document.pages.forEach((page) => page.items.forEach((item) => visit(item)));
      return this.apply(
        ids.map((id) => ({ op: 'set', id, patch })),
        {
          origin: 'user',
          label: 'Unlock selection',
        },
      );
    }
    return this.apply(
      this.selection.map((id) => ({ op: 'set', id, patch })),
      { origin: 'user', label: 'Change style' },
    );
  }
  deleteSelection() {
    if (this.selection.some((id) => this.isLocked(id))) return;
    const ids = this.topSelection();
    this.apply(
      ids.map((id) => ({ op: 'remove', id })),
      { origin: 'user', label: 'Delete' },
    );
    this.select([]);
    this.focus();
  }
  duplicate(offset = 24) {
    if (this.selection.some((id) => this.isLocked(id))) return this.lockedResult();
    const items = this.topSelection()
      .map((id) => this.get(id)!)
      .filter(Boolean);
    const copies = this.copyItems(items, offset);
    const result = this.apply(
      copies.map((item) => ({ op: 'add', item, page: this.pageId })),
      { origin: 'user', label: 'Duplicate' },
    );
    if (result.ok) this.select(copies.map((i) => i.id));
    return result;
  }
  group() {
    if (this.selection.length < 2 || this.selection.some((id) => this.isLocked(id))) return;
    const ids = this.topSelection(),
      box = this.boundsOf(ids),
      id = uid();
    this.apply(
      [
        { op: 'add', page: this.pageId, item: { kind: 'group', id, ...box, children: [] } },
        ...ids.map((childId) => ({ op: 'reparent' as const, id: childId, parent: id })),
      ],
      { origin: 'user', label: 'Group' },
    );
    this.select([id]);
  }
  ungroup() {
    if (this.selection.some((id) => this.isLocked(id))) return;
    const ops: Op[] = [];
    for (const id of this.selection) {
      const item = this.get(id);
      if (item?.kind === 'group') {
        for (const child of item.children ?? [])
          ops.push({ op: 'reparent', id: child.id, parent: null });
        ops.push({ op: 'remove', id });
      }
    }
    this.apply(ops, { origin: 'user', label: 'Ungroup' });
    this.select([]);
  }
  align(
    mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'horizontal' | 'vertical',
  ) {
    if (this.selection.some((id) => this.isLocked(id))) return;
    const items = this.topSelection()
        .map((id) => this.get(id)!)
        .filter((i) => i && !i.locked && i.kind !== 'connector'),
      box = boxOf(items);
    const sorted = [...items].sort((a, b) => (mode === 'horizontal' ? a.x - b.x : a.y - b.y));
    let cursor = mode === 'horizontal' ? box.x : box.y;
    const gap =
      items.length > 1
        ? ((mode === 'horizontal' ? box.w : box.h) -
            items.reduce((s, i) => s + (mode === 'horizontal' ? i.w : i.h), 0)) /
          (items.length - 1)
        : 0;
    const ops = sorted.flatMap((i) => {
      const patch: Partial<Item> = {};
      if (mode === 'left') patch.x = box.x;
      if (mode === 'center') patch.x = box.x + (box.w - i.w) / 2;
      if (mode === 'right') patch.x = box.x + box.w - i.w;
      if (mode === 'top') patch.y = box.y;
      if (mode === 'middle') patch.y = box.y + (box.h - i.h) / 2;
      if (mode === 'bottom') patch.y = box.y + box.h - i.h;
      if (mode === 'horizontal') {
        patch.x = cursor;
        cursor += i.w + gap;
      }
      if (mode === 'vertical') {
        patch.y = cursor;
        cursor += i.h + gap;
      }
      return this.movable([i.id]).map((child) => ({
        op: 'set' as const,
        id: child.id,
        patch: translation(child, (patch.x ?? i.x) - i.x, (patch.y ?? i.y) - i.y),
      }));
    });
    this.apply(ops, { origin: 'user', label: 'Align selection' });
  }
  async addImage(file: File, point?: Point) {
    if (this.readonly) return;
    if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type))
      throw new Error('Choose a PNG, JPEG, GIF, WebP or AVIF image.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Images must be under 10 MB.');
    const src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const image = new Image();
    image.src = src;
    await image.decode();
    const scale = Math.min(1, 480 / image.width, 360 / image.height),
      w = image.width * scale,
      h = image.height * scale,
      p = point ?? this.view.center,
      id = mediaId();
    const result = this.apply(
      [
        { op: 'media.set', id, media: { src, mime: file.type, w: image.width, h: image.height } },
        {
          op: 'add',
          page: this.pageId,
          item: { kind: 'image', x: p.x - w / 2, y: p.y - h / 2, w, h, media: id, name: file.name },
        },
      ],
      { origin: 'user', label: 'Add image' },
    );
    if (result.ok) this.select(result.created);
  }
  editText(id: string) {
    if (this.readonly || this.editor) return;
    this.render();
    const item = this.get(id);
    if (!item || this.isLocked(id)) return;
    const view = this.stage.world.querySelector<HTMLElement>(`[data-ad-id="${CSS.escape(id)}"]`);
    if (!view) return;
    let text = view.querySelector<HTMLElement>('.ad-text');
    if (!text) {
      text = document.createElement('div');
      text.className = 'ad-text';
      view.append(text);
    }
    text.contentEditable = 'plaintext-only';
    text.setAttribute('role', 'textbox');
    text.setAttribute('aria-label', 'Edit text');
    text.style.pointerEvents = 'auto';
    text.style.display = 'flex';
    text.classList.add('ad-editing');
    this.editor = text;
    const before = item.text?.value ?? '';
    text.textContent = before;
    text.focus();
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const finish = (save = true) => {
      if (this.editor !== text) return;
      this.editor = undefined;
      this.finishEditor = undefined;
      const value = text!.innerText;
      text!.contentEditable = 'false';
      text!.classList.remove('ad-editing');
      text!.removeAttribute('role');
      text!.removeAttribute('aria-label');
      text!.removeEventListener('blur', blur);
      text!.removeEventListener('keydown', key);
      if (save && value !== before) {
        const updatedText = { ...this.get(id)?.text, value };
        const dimensions =
          item.kind === 'text' && item.autoWidth
            ? measureText(this.host.ownerDocument, updatedText)
            : {};
        this.apply([{ op: 'set', id, patch: { ...dimensions, text: { value } } }], {
          origin: 'user',
          label: 'Edit text',
        });
      }
      const saved = this.get(id);
      text!.textContent = saved?.text?.value ?? before;
      text!.style.display = saved?.text ? 'flex' : 'none';
      this.render();
      this.focus();
    };
    this.finishEditor = finish;
    const blur = () => finish();
    const key = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        finish();
      }
    };
    text.addEventListener('blur', blur);
    text.addEventListener('keydown', key);
  }
  cancel() {
    this.stage.finishPresentation();
    this.clearInteractive();
    clearTimeout(this.longPressTimer);
    this.lastTouchTap = undefined;
    this.finishEditor?.(false);
    if (this.drag) {
      this.drag = undefined;
      this.drafts.clear();
      this.drawPreview = undefined;
      this.stage.setMarquee(undefined);
      this.render();
    }
    this.pointers.clear();
    this.pinch = undefined;
    this.updateCursor();
  }
  private schedule() {
    if (!this.frame && !this.destroyed)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.render();
      });
  }
  private render() {
    if (this.destroyed) return;
    let doc = this.document;
    if (this.drawPreview) {
      if (!this.previewDocument || this.previewBase !== doc) {
        this.previewBase = doc;
        this.previewDocument = {
          ...doc,
          pages: doc.pages.map((s) =>
            s.id === this.pageId ? { ...s, items: [...s.items, this.drawPreview!] } : s,
          ),
        };
      }
      doc = this.previewDocument;
      this.drafts.set(this.drawPreview.id, { ...this.drawPreview });
    } else {
      this.previewDocument = undefined;
      this.previewBase = undefined;
    }
    this.stage.render(doc, this.pageId, this.drafts);
    this.stage.setSelection(this.selection);
  }
  private visible(item: Item) {
    if (this.hiddenGeometry.has(item.id)) return false;
    const viewport = this.stage.lens.viewport(),
      box = itemBounds(item, this.geometryLookup, this.outline);
    return (
      box.x + box.w >= viewport.x &&
      box.y + box.h >= viewport.y &&
      box.x <= viewport.x + viewport.w &&
      box.y <= viewport.y + viewport.h
    );
  }
  private isUI(target: EventTarget | null) {
    return (
      target instanceof Element &&
      !!target.closest(
        '.ad-ui, .ad-dialog, input, textarea, select, button, [contenteditable="plaintext-only"], [data-ad-interactive="true"], a',
      )
    );
  }
  private point(e: { clientX: number; clientY: number }) {
    return { x: e.clientX - this.rect.left, y: e.clientY - this.rect.top };
  }
  private updateCursor() {
    this.stage.root.style.cursor = cursorForTool(this.tool, {
      space: this.space,
      readonly: this.readonly,
      panning: this.drag?.kind === 'pan',
    });
  }
  private topSelection() {
    const selected = new Set(this.selection),
      result: string[] = [];
    const visit = (items: Item[], ancestorSelected = false) => {
      for (const item of items) {
        const included = selected.has(item.id);
        if (included && !ancestorSelected) result.push(item.id);
        if (item.children) visit(item.children, ancestorSelected || included);
      }
    };
    visit(this.document.pages.find((s) => s.id === this.pageId)?.items ?? []);
    return result;
  }
  private movable(ids: string[]) {
    if (ids.some((id) => this.isLocked(id))) return [];
    const all = new Map<string, Item>();
    for (const id of ids) {
      const item = this.get(id);
      if (item && !item.locked)
        for (const child of [item, ...flatten(item.children ?? [])]) all.set(child.id, child);
    }
    return [...all.values()];
  }
  private outline = (item: Item) => this.stage.kinds.get(item.kind)?.outline?.(item);
  private refreshGeometry() {
    const items = this.document.pages.find((page) => page.id === this.pageId)?.items ?? [];
    this.geometryLookup = new Map(flatten(items).map((item) => [item.id, item]));
    this.lockedGeometry = lockedItems(this.document.pages.flatMap((page) => page.items));
    this.hiddenGeometry.clear();
    const walk = (nodes: Item[], hidden = false) => {
      for (const item of nodes) {
        const inherited = hidden || !!item.hidden;
        if (inherited) this.hiddenGeometry.add(item.id);
        if (item.children) walk(item.children, inherited);
      }
    };
    walk(items);
    this.spatial.set(items, this.outline);
  }
  private hit(point: Point, includeLocked = false): Item | undefined {
    const item = this.spatial.pick(point, {
      includeLocked: true,
      tolerance: 6 / this.view.zoom,
      enteredGroup: this.enteredGroup,
      outline: (item) => this.stage.kinds.get(item.kind)?.outline?.(item),
    });
    if (!item || item.id === this.enteredGroup || (!includeLocked && this.isLocked(item.id)))
      return undefined;
    return item;
  }
  private distanceToLine(p: Point, a: Point, b: Point) {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
      );
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
  private endpoint(value?: Endpoint): Point | undefined {
    if (!value) return;
    if ('item' in value) {
      const i = this.get(value.item);
      return i ? { x: i.x + i.w / 2, y: i.y + i.h / 2 } : undefined;
    }
    return value;
  }
  private zoomAt(zoom: number, screen: Point) {
    zoom = Math.max(0.05, Math.min(8, zoom));
    const p = this.stage.lens.toPage(screen);
    this.stage.lens.set({ zoom, x: screen.x - p.x * zoom, y: screen.y - p.y * zoom });
  }
  private pointerDown = (e: PointerEvent) => {
    if (this.isUI(e.target) || e.button > 1) return;
    this.clearInteractive(e.target);
    this.stage.finishPresentation();
    clearTimeout(this.longPressTimer);
    if (e.pointerType !== 'touch') this.lastTouchTap = undefined;
    const screen = this.point(e);
    this.pointers.set(e.pointerId, screen);
    if (this.pointers.size === 2) {
      this.lastTouchTap = undefined;
      this.drag = undefined;
      this.updateCursor();
      this.drafts.clear();
      this.drawPreview = undefined;
      const [a, b] = [...this.pointers.values()],
        center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        zoom: this.view.zoom,
        center,
        anchor: this.stage.lens.toPage(center),
      };
      return;
    }
    e.preventDefault();
    try {
      this.stage.root.setPointerCapture(e.pointerId);
    } catch {
      /* Synthetic and already-ended pointers cannot be captured. */
    }
    this.focus();
    const start = this.stage.lens.toPage(screen),
      camera = { ...this.stage.lens.state };
    const handle = (e.target as Element).closest<HTMLElement>('[data-ad-handle]')?.dataset.adHandle;
    if (this.space || this.tool === 'hand' || e.button === 1 || this.readonly) {
      this.drag = {
        kind: 'pan',
        pointer: e.pointerId,
        start,
        screen,
        last: screen,
        original: [],
        ids: [],
        camera,
        moved: false,
      };
      this.updateCursor();
      return;
    }
    if (handle && this.selection.length) {
      if (this.selection.some((id) => this.isLocked(id))) return;
      this.drag = {
        kind: handle === 'rotate' ? 'rotate' : 'resize',
        pointer: e.pointerId,
        start,
        screen,
        last: start,
        original: this.movable(this.topSelection()),
        ids: this.topSelection(),
        camera,
        handle,
        moved: false,
      };
      return;
    }
    if (this.tool === 'select') {
      const targetId = (e.target as Element).closest<HTMLElement>('[data-ad-id]')?.dataset.adId;
      const item =
        this.hit(start, true) ??
        (targetId && this.isLocked(targetId) ? this.get(targetId) : undefined);
      if (item) {
        if (e.shiftKey) {
          this.select(
            this.selection.includes(item.id)
              ? this.selection.filter((id) => id !== item.id)
              : [...this.selection, item.id],
          );
        } else if (!this.selection.includes(item.id)) this.select([item.id]);
        const ids = this.topSelection();
        this.drag = {
          kind: 'move',
          pointer: e.pointerId,
          start,
          screen,
          last: start,
          original: this.movable(ids),
          ids,
          camera,
          moved: false,
          alt: e.altKey,
        };
      } else {
        if (!e.shiftKey) this.select([]);
        this.drag = {
          kind: 'marquee',
          pointer: e.pointerId,
          start,
          screen,
          last: start,
          original: [],
          ids: this.selection,
          camera,
          moved: false,
        };
      }
      if (e.pointerType === 'touch') {
        const drag = this.drag;
        this.longPressTimer = setTimeout(() => {
          if (this.drag !== drag || drag.moved || this.pointers.size !== 1) return;
          this.cancel();
          const targetId = (e.target as Element).closest<HTMLElement>('[data-ad-id]')?.dataset.adId;
          this.openContext(screen, targetId);
        }, 500);
      }
      return;
    }
    if (this.tool === 'eraser') {
      const item = this.hit(start);
      this.drag = {
        kind: 'erase',
        pointer: e.pointerId,
        start,
        screen,
        last: start,
        original: [],
        ids: item ? [item.id] : [],
        camera,
        moved: false,
      };
      if (item) this.drafts.set(item.id, { hidden: true });
      this.schedule();
      return;
    }
    const kind = this.tool;
    const from = this.hit(start);
    const item = {
      id: uid(),
      kind,
      x: start.x,
      y: start.y,
      w: 0,
      h: 0,
      style: clone(this.defaultStyle),
      ...(kind === 'path' ? { points: [[0, 0, e.pressure || 0.5]] } : {}),
      ...(kind === 'connector'
        ? {
            from: from ? { item: from.id, side: 'auto' } : start,
            to: start,
            route: 'elbow',
            heads: { end: 'arrow' },
          }
        : {}),
      ...(kind === 'note'
        ? {
            style: { ...this.defaultStyle, fill: 'moss', stroke: 'none', corner: CARD_CORNER },
            text: { value: '', size: 'l' },
          }
        : {}),
      ...(kind === 'text' ? { autoWidth: true, text: { value: '', size: 'l' } } : {}),
    } as Item;
    this.drag = {
      kind: 'draw',
      pointer: e.pointerId,
      start,
      screen,
      last: start,
      original: [],
      ids: [],
      camera,
      item,
      points: kind === 'path' ? [[0, 0, e.pressure || 0.5]] : undefined,
      moved: false,
    };
    this.drawPreview = item;
    this.select([]);
    this.schedule();
  };
  private pointerMove = (e: PointerEvent) => {
    const screen = this.point(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, screen);
    if (this.pinch && this.pointers.size >= 2) {
      e.preventDefault();
      const [a, b] = [...this.pointers.values()],
        center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        zoom = Math.max(
          0.05,
          Math.min(
            8,
            (this.pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(1, this.pinch.distance),
          ),
        );
      this.stage.lens.set({
        zoom,
        x: center.x - this.pinch.anchor.x * zoom,
        y: center.y - this.pinch.anchor.y * zoom,
      });
      return;
    }
    const drag = this.drag;
    if (!drag || drag.pointer !== e.pointerId) return;
    const p = this.stage.lens.toPage(screen);
    const distance = Math.hypot(screen.x - drag.screen.x, screen.y - drag.screen.y);
    if (!drag.moved && distance < (e.pointerType === 'touch' ? 8 : 4)) return;
    clearTimeout(this.longPressTimer);
    this.lastTouchTap = undefined;
    drag.moved = true;
    drag.last = p;
    if (drag.kind === 'pan') {
      this.stage.lens.set({
        x: drag.camera.x + screen.x - drag.screen.x,
        y: drag.camera.y + screen.y - drag.screen.y,
      });
      return;
    }
    if (drag.kind === 'move') {
      let dx = p.x - drag.start.x,
        dy = p.y - drag.start.y;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      for (const item of drag.original) {
        this.drafts.set(item.id, translation(item, dx, dy));
      }
      this.schedule();
      return;
    }
    if (drag.kind === 'resize') {
      if (drag.handle?.startsWith('custom:')) {
        const item =
          drag.ids.length === 1 ? drag.original.find((item) => item.id === drag.ids[0]) : undefined;
        const callback = item ? this.stage.kinds.get(item.kind)?.dragHandle : undefined;
        if (item && callback) {
          const point = rotatePoint(
            p,
            { x: item.x + item.w / 2, y: item.y + item.h / 2 },
            -(item.rotation ?? 0),
          );
          try {
            this.drafts.set(
              item.id,
              callback(
                clone(item),
                drag.handle.slice(7),
                { x: point.x - item.x, y: point.y - item.y },
                { shift: e.shiftKey, alt: e.altKey },
              ),
            );
            this.schedule();
          } catch (error) {
            this.cancel();
            this.host.dispatchEvent(
              new CustomEvent('ad-error', {
                detail: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        }
        return;
      }
      const selected = drag.original.filter((item) => drag.ids.includes(item.id));
      const oriented =
        selected.length === 1 && !['connector', 'line', 'path', 'group'].includes(selected[0].kind);
      const box = oriented
          ? selected[0]
          : geometryBounds(selected, this.geometryLookup, this.outline),
        handle = drag.handle ?? 'se',
        angle = oriented ? (selected[0].rotation ?? 0) : 0;
      const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
      const localStart = rotatePoint(drag.start, center, -angle);
      const localPointer = rotatePoint(p, center, -angle);
      const dx = localPointer.x - localStart.x,
        dy = localPointer.y - localStart.y;
      const horizontal = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0,
        vertical = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
      let width = box.w + horizontal * dx * (e.altKey ? 2 : 1),
        height = box.h + vertical * dy * (e.altKey ? 2 : 1);
      if (e.shiftKey) {
        const sx = width / Math.max(1, box.w),
          sy = height / Math.max(1, box.h);
        const scale = Math.max(
          12 / Math.max(1, box.w),
          12 / Math.max(1, box.h),
          !horizontal ? sy : !vertical ? sx : Math.abs(sx - 1) >= Math.abs(sy - 1) ? sx : sy,
        );
        width = box.w * scale;
        height = box.h * scale;
      } else {
        width = Math.max(12, width);
        height = Math.max(12, height);
      }
      const localCenter = {
        x: center.x + (e.altKey ? 0 : (horizontal * (width - box.w)) / 2),
        y: center.y + (e.altKey ? 0 : (vertical * (height - box.h)) / 2),
      };
      const x = localCenter.x - width / 2,
        y = localCenter.y - height / 2,
        sx = width / Math.max(1, box.w),
        sy = height / Math.max(1, box.h);
      const transformPoint = (point: Point) => {
        const local = rotatePoint(point, center, -angle);
        return rotatePoint(
          { x: x + (local.x - box.x) * sx, y: y + (local.y - box.y) * sy },
          center,
          angle,
        );
      };
      for (const item of drag.original) {
        const nextCenter = transformPoint({ x: item.x + item.w / 2, y: item.y + item.h / 2 });
        const w = Math.max(1, item.w * sx),
          h = Math.max(1, item.h * sy);
        const patch: Partial<Item> = { x: nextCenter.x - w / 2, y: nextCenter.y - h / 2, w, h };
        if (item.points)
          patch.points = item.points.map((point) =>
            point.length > 2
              ? [point[0] * sx, point[1] * sy, point[2]]
              : [point[0] * sx, point[1] * sy],
          );
        if (item.kind === 'connector') {
          for (const key of ['from', 'to'] as const) {
            const endpoint = item[key];
            if (endpoint && !('item' in endpoint)) patch[key] = transformPoint(endpoint);
          }
          if (item.waypoints)
            patch.waypoints = item.waypoints.map(([x, y]) => {
              const point = transformPoint({ x, y });
              return [point.x, point.y];
            });
        }
        this.drafts.set(item.id, patch);
      }
      this.schedule();
      return;
    }
    if (drag.kind === 'rotate') {
      const selected = drag.original.filter((item) => drag.ids.includes(item.id)),
        box = geometryBounds(selected, this.geometryLookup, this.outline),
        center = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
      const delta =
        ((Math.atan2(p.y - center.y, p.x - center.x) -
          Math.atan2(drag.start.y - center.y, drag.start.x - center.x)) *
          180) /
        Math.PI;
      for (const item of drag.original) {
        const nextCenter = rotatePoint(
          { x: item.x + item.w / 2, y: item.y + item.h / 2 },
          center,
          delta,
        );
        const patch: Partial<Item> = {
          x: nextCenter.x - item.w / 2,
          y: nextCenter.y - item.h / 2,
          rotation: (item.rotation ?? 0) + delta,
        };
        if (item.kind === 'connector') {
          patch.rotation = 0;
          for (const key of ['from', 'to'] as const) {
            const endpoint = item[key];
            if (endpoint && !('item' in endpoint))
              patch[key] = rotatePoint(endpoint, center, delta);
          }
          if (item.waypoints)
            patch.waypoints = item.waypoints.map(([x, y]) => {
              const point = rotatePoint({ x, y }, center, delta);
              return [point.x, point.y];
            });
        }
        this.drafts.set(item.id, patch);
      }
      this.schedule();
      return;
    }
    if (drag.kind === 'marquee') {
      this.stage.setMarquee({
        x: Math.min(p.x, drag.start.x),
        y: Math.min(p.y, drag.start.y),
        w: Math.abs(p.x - drag.start.x),
        h: Math.abs(p.y - drag.start.y),
      });
      return;
    }
    if (drag.kind === 'erase') {
      const item = this.hit(p);
      if (item && !drag.ids.includes(item.id)) {
        drag.ids.push(item.id);
        this.drafts.set(item.id, { hidden: true });
        this.schedule();
      }
      return;
    }
    if (drag.item) {
      const item = drag.item;
      if (item.kind === 'path') {
        const events = e.getCoalescedEvents?.() ?? [e];
        for (const point of events.length ? events : [e]) {
          const p = this.stage.lens.toPage(this.point(point));
          drag.points!.push([p.x - drag.start.x, p.y - drag.start.y, point.pressure || 0.5]);
        }
        item.points = drag.points;
        item.w = Math.max(1, ...drag.points!.map((v) => v[0]));
        item.h = Math.max(1, ...drag.points!.map((v) => v[1]));
      } else if (item.kind === 'connector') {
        const target = this.hit(p);
        item.to = target ? { item: target.id, side: 'auto' } : p;
      } else {
        let w = Math.abs(p.x - drag.start.x),
          h = Math.abs(p.y - drag.start.y);
        if (e.shiftKey) w = h = Math.max(w, h);
        item.x = p.x < drag.start.x ? drag.start.x - w : drag.start.x;
        item.y = p.y < drag.start.y ? drag.start.y - h : drag.start.y;
        item.w = w;
        item.h = h;
        if (item.kind === 'line') {
          item.points = [
            [drag.start.x - item.x, drag.start.y - item.y],
            [p.x - item.x, p.y - item.y],
          ];
        }
      }
      this.drawPreview = item;
      this.schedule();
    }
  };
  private pointerUp = (e: PointerEvent) => {
    clearTimeout(this.longPressTimer);
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = undefined;
      return;
    }
    const drag = this.drag;
    if (!drag || drag.pointer !== e.pointerId) return;
    this.drag = undefined;
    this.updateCursor();
    const touchTap =
      e.pointerType === 'touch' && !drag.moved && ['move', 'marquee'].includes(drag.kind);
    const ops: Op[] = [];
    if (drag.kind === 'move' || drag.kind === 'resize' || drag.kind === 'rotate') {
      if (drag.moved && drag.original.length) {
        if (drag.kind === 'move' && drag.alt) {
          const originals = drag.ids
            .map((id) => drag.original.find((i) => i.id === id)!)
            .filter(Boolean);
          const changed = originals.map((item) => this.withDrafts(item));
          const copies = this.copyItems(changed, 0);
          ops.push(...copies.map((item) => ({ op: 'add' as const, item, page: this.pageId })));
          this.selectionSignal.value = copies.map((i) => i.id);
        } else for (const [id, patch] of this.drafts) ops.push({ op: 'set', id, patch });
      }
    }
    if (drag.kind === 'marquee' && drag.moved) {
      const p = drag.last,
        b = {
          x: Math.min(p.x, drag.start.x),
          y: Math.min(p.y, drag.start.y),
          w: Math.abs(p.x - drag.start.x),
          h: Math.abs(p.y - drag.start.y),
        };
      this.select([
        ...drag.ids,
        ...this.spatial.enclosed(b, { enteredGroup: this.enteredGroup }).map((i) => i.id),
      ]);
    }
    if (drag.kind === 'erase') ops.push(...drag.ids.map((id) => ({ op: 'remove' as const, id })));
    if (drag.kind === 'draw' && drag.item) {
      const item = drag.item;
      if (!drag.moved) {
        item.w = item.kind === 'note' ? 210 : item.kind === 'text' ? 260 : 180;
        item.h = item.kind === 'note' ? 180 : item.kind === 'text' ? 60 : 110;
        if (item.kind === 'connector') {
          item.to = { x: item.x + 160, y: item.y };
        }
        if (item.kind === 'line')
          item.points = [
            [0, 0],
            [180, 0],
          ];
        if (item.kind === 'path') {
          item.w = item.h = 1;
          item.points = [
            [0, 0, 0.5],
            [0.1, 0.1, 0.5],
          ];
        }
      }
      if (item.kind === 'path' && item.points?.length) {
        const minX = Math.min(...item.points.map((p) => p[0])),
          minY = Math.min(...item.points.map((p) => p[1])),
          maxX = Math.max(...item.points.map((p) => p[0])),
          maxY = Math.max(...item.points.map((p) => p[1]));
        item.x += minX;
        item.y += minY;
        item.w = Math.max(1, maxX - minX);
        item.h = Math.max(1, maxY - minY);
        item.points = this.simplify(
          item.points.map((p) => [p[0] - minX, p[1] - minY, p[2]]),
          0.5 / this.view.zoom,
        );
      }
      if (item.kind === 'note' && !item.text?.value)
        item.text = { value: 'A little idea', size: 'l' };
      if (item.kind === 'text' && !item.text?.value)
        item.text = { value: 'Type something…', size: 'l' };
      ops.push({ op: 'add', item, page: this.pageId });
    }
    this.drafts.clear();
    this.drawPreview = undefined;
    this.stage.setMarquee(undefined);
    if (ops.length) {
      const result = this.apply(ops, {
        origin: 'user',
        label:
          drag.kind === 'draw'
            ? `Draw ${drag.item!.kind}`
            : drag.kind === 'move'
              ? 'Move'
              : drag.kind === 'resize'
                ? 'Resize'
                : drag.kind === 'rotate'
                  ? 'Rotate'
                  : 'Erase',
      });
      if (result.ok && result.created.length) {
        this.select(
          drag.alt
            ? result.created.filter(
                (id) => !this.items.some((p) => flatten(p.children ?? []).some((c) => c.id === id)),
              )
            : [result.created[0]],
        );
      }
      if (!result.ok)
        this.host.dispatchEvent(new CustomEvent('ad-error', { detail: result.errors[0]?.message }));
    }
    this.render();
    if (drag.kind === 'draw' && drag.item) {
      const kind = drag.item.kind;
      if (kind !== 'path') this.setTool('select');
      if (kind === 'text' || kind === 'note') this.editText(drag.item.id);
    }
    this.emit('select', this.selection);
    if (touchTap) {
      const screen = this.point(e),
        at = Date.now(),
        previous = this.lastTouchTap;
      this.lastTouchTap = { at, screen };
      if (
        previous &&
        at - previous.at < 350 &&
        Math.hypot(screen.x - previous.screen.x, screen.y - previous.screen.y) < 24
      ) {
        this.lastTouchTap = undefined;
        this.touchDoubleAt = at;
        this.activateAt(screen);
      }
    }
  };
  private pointerCancel = () => this.cancel();
  private wheel = (e: WheelEvent) => {
    if (this.isUI(e.target)) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey)
      this.zoomAt(this.view.zoom * Math.exp(-e.deltaY * 0.008), this.point(e));
    else
      this.stage.lens.set({
        x: this.stage.lens.state.x - e.deltaX,
        y: this.stage.lens.state.y - e.deltaY,
      });
  };
  private doubleClick = (e: MouseEvent) => {
    if (this.isUI(e.target) || Date.now() - this.touchDoubleAt < 500) return;
    const target = e.target instanceof Element ? e.target : undefined;
    const targetId = target?.closest<HTMLElement>('[data-ad-id]')?.dataset.adId;
    this.activateAt(this.point(e), targetId);
  };
  private openContext(screen: Point, targetId?: string) {
    const item =
      this.spatial.pick(this.stage.lens.toPage(screen), {
        tolerance: 6 / this.view.zoom,
        includeLocked: true,
        enteredGroup: this.enteredGroup,
        outline: this.outline,
      }) ?? (targetId ? this.get(targetId) : undefined);
    if (item) {
      this.setTool('select');
      this.select([item.id]);
    }
    this.host.dispatchEvent(new CustomEvent('ad-context', { detail: { ...screen, id: item?.id } }));
  }
  private activateAt(screen: Point, targetId?: string) {
    const fromDom = targetId ? this.get(targetId) : undefined;
    const item =
      (fromDom && (fromDom.kind === 'html' || fromDom.kind === 'video') ? fromDom : undefined) ??
      this.hit(this.stage.lens.toPage(screen), true) ??
      fromDom;
    if (item && this.isLocked(item.id)) {
      this.select([item.id]);
      return;
    }
    if (item?.kind === 'group') {
      this.enteredGroup = item.id;
      this.select([]);
      return;
    }
    if (item?.kind === 'html' || item?.kind === 'video') {
      this.activateEmbedded(item);
      return;
    }
    if (item && !['image', 'path', 'line', 'link'].includes(item.kind)) this.editText(item.id);
    else if (!item && !this.readonly) this.add('text', this.stage.lens.toPage(screen));
  }
  private activateEmbedded(item: Item) {
    const view = this.stage.world.querySelector<HTMLElement>(
      `[data-ad-id="${CSS.escape(item.id)}"]`,
    );
    if (!view) return;
    this.clearInteractive();
    view.dataset.adInteractive = 'true';
    if (item.kind !== 'html') return;
    const content = view.querySelector<HTMLElement>('.ad-html-content');
    if (!content) return;
    content.tabIndex = 0;
    content.focus();
    const close = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && content.contains(event.relatedTarget)) return;
      delete view.dataset.adInteractive;
      content.tabIndex = -1;
      content.removeEventListener('focusout', close);
    };
    content.addEventListener('focusout', close);
  }
  private clearInteractive(inside?: EventTarget | null) {
    for (const node of this.stage.world.querySelectorAll<HTMLElement>('[data-ad-interactive]')) {
      if (inside instanceof Node && node.contains(inside)) continue;
      delete node.dataset.adInteractive;
    }
  }
  private keyDown = (e: KeyboardEvent) => {
    if (this.isUI(e.target)) return;
    this.stage.finishPresentation();
    const mod = e.metaKey || e.ctrlKey,
      key = e.key.toLowerCase();
    if (key === 'contextmenu' || (key === 'f10' && e.shiftKey)) {
      e.preventDefault();
      const item = this.selection.length === 1 ? this.get(this.selection[0]) : undefined;
      if (item) {
        const box = itemBounds(item, this.geometryLookup, this.outline);
        const screen = this.stage.lens.toScreen({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
        this.host.dispatchEvent(
          new CustomEvent('ad-context', { detail: { ...screen, id: item.id } }),
        );
      }
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      this.space = true;
      this.updateCursor();
      return;
    }
    if (key === 'escape') {
      this.cancel();
      this.enteredGroup = undefined;
      this.select([]);
      this.setTool('select');
      return;
    }
    if (mod && key === 'a') {
      e.preventDefault();
      this.select(this.items.filter((i) => !i.hidden && !i.locked).map((i) => i.id));
      return;
    }
    if (key === '1' && !mod) {
      this.view.zoom = 1;
      return;
    }
    if (key === '2' && !mod) {
      this.view.fit();
      return;
    }
    if (key === '+' || key === '=') {
      this.view.zoom *= 1.2;
      return;
    }
    if (key === '-') {
      this.view.zoom /= 1.2;
      return;
    }
    if (this.readonly) return;
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && key === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    if (mod && key === 'd') {
      e.preventDefault();
      this.duplicate();
      return;
    }
    if (mod && key === 'g') {
      e.preventDefault();
      if (e.shiftKey) this.ungroup();
      else this.group();
      return;
    }
    if (key === 'delete' || key === 'backspace') {
      e.preventDefault();
      this.deleteSelection();
      return;
    }
    if (key === 'enter' && this.selection.length === 1) {
      e.preventDefault();
      const selected = this.get(this.selection[0]);
      if (selected?.kind === 'html' || selected?.kind === 'video') this.activateEmbedded(selected);
      else if (selected && !['image', 'path', 'line', 'link'].includes(selected.kind))
        this.editText(selected.id);
      return;
    }
    if (key === '[' || key === ']') {
      e.preventDefault();
      this.apply(
        this.selection.map((id) => ({
          op: 'order',
          id,
          to: key === ']' ? (e.shiftKey ? 'front' : 'forward') : e.shiftKey ? 'back' : 'backward',
        })),
        { origin: 'user', label: 'Reorder' },
      );
      return;
    }
    if (key.startsWith('arrow')) {
      e.preventDefault();
      const delta = e.shiftKey ? 10 : 1,
        dx = key === 'arrowleft' ? -delta : key === 'arrowright' ? delta : 0,
        dy = key === 'arrowup' ? -delta : key === 'arrowdown' ? delta : 0;
      this.apply(
        this.movable(this.topSelection()).map((i) => ({
          op: 'set',
          id: i.id,
          patch: translation(i, dx, dy),
        })),
        { origin: 'user', label: 'Nudge' },
      );
      return;
    }
    if (!mod && shortcuts[key]) {
      e.preventDefault();
      this.setTool(shortcuts[key]);
    }
  };
  private withDrafts(item: Item): Item {
    return {
      ...item,
      ...this.drafts.get(item.id),
      ...(item.children ? { children: item.children.map((i) => this.withDrafts(i)) } : {}),
    };
  }
  private copyItems(items: Item[], offset: number): Item[] {
    const ids = new Map(flatten(items).map((i) => [i.id, uid()]));
    const copy = (i: Item): Item => {
      const out = {
        ...clone(i),
        id: ids.get(i.id)!,
        x: (i.x ?? 0) + offset,
        y: (i.y ?? 0) + offset,
      };
      if (i.children) out.children = i.children.map(copy);
      if (i.waypoints) out.waypoints = i.waypoints.map(([x, y]) => [x + offset, y + offset]);
      for (const key of ['from', 'to'] as const) {
        const end = i[key];
        if (end) {
          if ('item' in end) out[key] = { ...end, item: ids.get(end.item) ?? end.item };
          else out[key] = { x: end.x + offset, y: end.y + offset };
        }
      }
      return out;
    };
    return items.map(copy);
  }
  private copyEvent = (e: ClipboardEvent) => {
    if (this.isUI(e.target) || !this.selection.length) return;
    e.preventDefault();
    this.clipboard = this.topSelection()
      .map((id) => this.get(id)!)
      .filter(Boolean);
    const ids = new Set(flatten(this.clipboard).map((i) => i.id));
    const media: AnnieDoc['media'] = {};
    for (const item of flatten(this.clipboard)) {
      if (item.media && this.document.media[item.media])
        media[item.media] = clone(this.document.media[item.media]);
      for (const key of ['from', 'to'] as const) {
        const endpoint = item[key];
        if (endpoint && 'item' in endpoint && !ids.has(endpoint.item))
          item[key] = resolveEndpoint(
            endpoint,
            item[key === 'from' ? 'to' : 'from'],
            this.geometryLookup,
            this.outline,
          );
      }
    }
    const value = JSON.stringify({
      format: 'anniedrawing-clipboard',
      items: this.clipboard,
      media,
    });
    e.clipboardData?.setData('application/vnd.anniedrawing+json', value);
    e.clipboardData?.setData('text/plain', value);
  };
  private cutEvent = (e: ClipboardEvent) => {
    if (this.readonly || this.isUI(e.target)) return;
    this.copyEvent(e);
    this.deleteSelection();
  };
  private pasteEvent = (e: ClipboardEvent) => {
    if (this.readonly || this.isUI(e.target)) return;
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) {
      e.preventDefault();
      files.forEach(
        (file) =>
          void this.addImage(file).catch((error) =>
            this.host.dispatchEvent(new CustomEvent('ad-error', { detail: String(error) })),
          ),
      );
      return;
    }
    if (!e.clipboardData) return;
    e.preventDefault();
    void this.pasteFrom(e.clipboardData);
  };
  private pasteFrom(data: DataTransfer | null, point?: Point) {
    const text =
      data?.getData('application/vnd.anniedrawing+json') ||
      data?.getData('text/plain') ||
      data?.getData('text/uri-list') ||
      data?.getData('text/html') ||
      '';
    if (!text) return;
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed.items)) throw new Error('t');
      const copies = this.copyItems(parsed.items, 24),
        mediaIds = new Map(Object.keys(parsed.media ?? {}).map((id) => [id, mediaId()])),
        ops: Op[] = Object.entries(parsed.media ?? {}).map(([id, media]) => ({
          op: 'media.set',
          id: mediaIds.get(id)!,
          media: media as AnnieDoc['media'][string],
        }));
      for (const item of flatten(copies))
        if (item.media && mediaIds.has(item.media)) item.media = mediaIds.get(item.media);
      ops.push(...copies.map((item) => ({ op: 'add' as const, item, page: this.pageId })));
      const result = this.apply(ops, { origin: 'user', label: 'Paste' });
      if (result.ok) this.select(copies.map((i) => i.id));
      else
        this.host.dispatchEvent(new CustomEvent('ad-error', { detail: result.errors[0]?.message }));
    } catch {
      void import('./input/urlPaste').then(({ pastePlain }) =>
        pastePlain(this as never, text, point),
      );
    }
  }
  private drop = (e: DragEvent) => {
    if (this.readonly) return;
    e.preventDefault();
    const p = this.stage.lens.toPage(this.point(e));
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) {
      for (const file of files)
        void (async () => {
          try {
            if (file.name.endsWith('.annie') || file.type === 'application/json')
              this.load(JSON.parse(await file.text()));
            else await this.addImage(file, p);
          } catch (error) {
            this.host.dispatchEvent(new CustomEvent('ad-error', { detail: String(error) }));
          }
        })();
      return;
    }
    if (e.dataTransfer) void this.pasteFrom(e.dataTransfer, p);
  };
  private simplify(
    points: [number, number, number?][],
    epsilon: number,
  ): [number, number, number?][] {
    if (points.length < 3) return points;
    let max = 0,
      index = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const distance = this.distanceToLine(
        { x: points[i][0], y: points[i][1] },
        { x: points[0][0], y: points[0][1] },
        { x: points.at(-1)![0], y: points.at(-1)![1] },
      );
      const ratio = i / (points.length - 1),
        pressure = (points[0][2] ?? 0.5) * (1 - ratio) + (points.at(-1)![2] ?? 0.5) * ratio;
      const error = Math.max(
        distance,
        Math.abs((points[i][2] ?? 0.5) - pressure) > 0.08 ? epsilon * 2 : 0,
      );
      if (error > max) {
        max = error;
        index = i;
      }
    }
    return max > epsilon
      ? [
          ...this.simplify(points.slice(0, index + 1), epsilon).slice(0, -1),
          ...this.simplify(points.slice(index), epsilon),
        ]
      : [points[0], points.at(-1)!];
  }
}
export function createBoard(host: HTMLElement, options?: BoardOptions) {
  return new Board(host, options);
}
declare global {
  interface Window {
    __anniedrawing?: Board[];
  }
}
