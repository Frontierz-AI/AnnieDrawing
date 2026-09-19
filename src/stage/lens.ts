import type { Box, LensState, Point } from '../core/types';

/** Camera values are screen-pixel translation followed by page-space scaling. */
export class Lens {
  private value: LensState = { x: 0, y: 0, zoom: 1 };
  private listeners = new Set<(state: LensState) => void>();
  private observer?: ResizeObserver;
  private animation = 0;
  width: number;
  height: number;
  constructor(readonly host: HTMLElement) {
    this.width = host.clientWidth || 800;
    this.height = host.clientHeight || 600;
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (!rect || (rect.width === this.width && rect.height === this.height)) return;
        this.width = rect.width;
        this.height = rect.height;
        this.emit();
      });
      this.observer.observe(host);
    }
  }
  get state(): LensState {
    return { ...this.value };
  }
  get zoom(): number {
    return this.value.zoom;
  }
  get center(): Point {
    return this.toPage({ x: this.width / 2, y: this.height / 2 });
  }
  set(patch: Partial<LensState>): void {
    this.stop();
    const next = { ...this.value, ...patch };
    if (![next.x, next.y, next.zoom].every(Number.isFinite)) return;
    next.zoom = Math.max(0.05, Math.min(8, next.zoom));
    if (next.x === this.value.x && next.y === this.value.y && next.zoom === this.value.zoom) return;
    this.value = next;
    this.emit();
  }
  private emit(): void {
    for (const callback of this.listeners) callback(this.state);
  }
  toPage(point: Point): Point {
    return {
      x: (point.x - this.value.x) / this.value.zoom,
      y: (point.y - this.value.y) / this.value.zoom,
    };
  }
  toScreen(point: Point): Point {
    return {
      x: point.x * this.value.zoom + this.value.x,
      y: point.y * this.value.zoom + this.value.y,
    };
  }
  viewport(margin = 0): Box {
    const p = this.toPage({ x: -margin, y: -margin });
    return {
      ...p,
      w: (this.width + margin * 2) / this.zoom,
      h: (this.height + margin * 2) / this.zoom,
    };
  }
  private fitState(box: Box, padding = 96): LensState {
    const usableW = Math.max(120, this.width - Math.min(padding * 2, this.width * 0.3));
    const usableH = Math.max(120, this.height - Math.min(padding * 2, this.height * 0.35));
    const zoom = Math.max(
      0.05,
      Math.min(1.5, usableW / Math.max(1, box.w), usableH / Math.max(1, box.h)),
    );
    return {
      x: this.width / 2 - (box.x + box.w / 2) * zoom,
      y: this.height / 2 - (box.y + box.h / 2) * zoom,
      zoom,
    };
  }
  fit(box: Box, padding = 96): void {
    this.stop();
    this.set(this.fitState(box, padding));
  }
  flyTo(box: Box): void {
    this.stop();
    const target = this.fitState(box);
    if (
      typeof matchMedia === 'undefined' ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      this.set(target);
      return;
    }
    const initial = this.state;
    const started = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / 280);
      const ease = 1 - (1 - progress) ** 3;
      this.set({
        x: initial.x + (target.x - initial.x) * ease,
        y: initial.y + (target.y - initial.y) * ease,
        zoom: initial.zoom + (target.zoom - initial.zoom) * ease,
      });
      if (progress < 1) this.animation = requestAnimationFrame(step);
      else this.animation = 0;
    };
    this.animation = requestAnimationFrame(step);
  }
  private stop(): void {
    if (this.animation) cancelAnimationFrame(this.animation);
    this.animation = 0;
  }
  onChange(callback: (state: LensState) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  destroy(): void {
    this.stop();
    this.observer?.disconnect();
    this.listeners.clear();
  }
}
