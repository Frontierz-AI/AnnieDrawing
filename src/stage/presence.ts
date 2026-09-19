import type { Box, Point } from '../core/types';
import { cursorArrow } from '../input/cursors';
import type { Lens } from './lens';
import { esc } from './paint';

/** In-view non-connector placements visited one by one before the rest appear together. */
const SEQUENTIAL_STOPS = 8;

interface Placement {
  box: Box;
  elements: HTMLElement[];
}

/** Presentation only: documents, exports and history commit before the cursor arrives. */
export class AgentPresence {
  private queue: Placement[] = [];
  private pending = new Set<HTMLElement>();
  private restore = new Map<HTMLElement, () => void>();
  private cursor?: HTMLElement;
  private name?: string;
  private frame = 0;
  private tick = 0;
  private generation = 0;
  private running = false;
  private motion = matchMedia('(prefers-reduced-motion: reduce)');
  private quiet = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden;
  private preference = () => {
    if (this.quiet()) this.clear();
  };

  constructor(
    private root: HTMLElement,
    private lens: Lens,
  ) {
    this.motion.addEventListener('change', this.preference);
    document.addEventListener('visibilitychange', this.preference);
  }

  holds(element: HTMLElement) {
    return this.pending.has(element);
  }

  enqueue(placements: Placement[], name?: string) {
    if (this.quiet()) return;
    const label = name?.trim();
    if (label && !this.name) this.name = label;
    for (const placement of placements) {
      placement.elements = placement.elements.filter((element) => !this.pending.has(element));
      if (!placement.elements.length) continue;
      for (const element of placement.elements) {
        element.classList.add('ad-agent-pending');
        element.tabIndex = -1;
        this.pending.add(element);
      }
      this.queue.push(placement);
    }
    if (!this.running && !this.frame && this.queue.length)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        void this.run(this.generation).catch(() => this.clear());
      });
  }

  /** Drop items that left the document; keep the walk going for what remains. */
  prune() {
    for (const element of [...this.pending]) {
      if (element.isConnected) continue;
      this.restore.get(element)?.();
      this.restore.delete(element);
      this.pending.delete(element);
    }
    const keep = (placement: Placement) => {
      placement.elements = placement.elements.filter((element) => this.pending.has(element));
      return placement.elements.length > 0;
    };
    this.queue = this.queue.filter(keep);
    if (!this.pending.size) this.clear();
  }

  clear() {
    this.generation++;
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.tick);
    this.frame = 0;
    this.tick = 0;
    for (const restore of this.restore.values()) restore();
    this.restore.clear();
    for (const element of this.pending) {
      element.classList.remove('ad-agent-pending');
      if (element.tabIndex < 0) element.tabIndex = 0;
    }
    this.pending.clear();
    this.queue = [];
    this.cursor?.remove();
    this.cursor = undefined;
    this.name = undefined;
    this.running = false;
  }

  destroy() {
    this.clear();
    this.motion.removeEventListener('change', this.preference);
    document.removeEventListener('visibilitychange', this.preference);
  }

  private async play(generation: number, duration: number, frame: (t: number) => void) {
    if (generation !== this.generation) return;
    if (this.quiet() || duration <= 0) {
      frame(1);
      return;
    }
    let started = 0;
    await new Promise<void>((resolve) => {
      const step = (now: number) => {
        if (generation !== this.generation) {
          this.tick = 0;
          resolve();
          return;
        }
        if (!started) started = now;
        const t = Math.min(1, (now - started) / duration);
        frame(1 - (1 - t) ** 3);
        if (t < 1) this.tick = requestAnimationFrame(step);
        else {
          this.tick = 0;
          resolve();
        }
      };
      this.tick = requestAnimationFrame(step);
    });
  }

  private edge(point: Point): Point {
    const { width, height } = this.lens;
    return [
      { x: -70, y: point.y + 40 },
      { x: width + 70, y: point.y - 40 },
      { x: point.x - 40, y: -70 },
      { x: point.x + 40, y: height + 70 },
    ].sort(
      (a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y),
    )[0];
  }

  private transform(point: Point) {
    return `translate(${point.x - 7}px,${point.y - 7}px)`;
  }

  /** Screen-pixel hotspot. Some engines leave getBoundingClientRect at the start. */
  private put(cursor: HTMLElement, point: Point) {
    cursor.style.transform = this.transform(point);
    cursor.dataset.adAt = `${point.x},${point.y}`;
  }

  private center(box: Box): Point {
    return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  }

  private async move(generation: number, cursor: HTMLElement, fromPage: Point, toPage: Point) {
    const from0 = this.lens.toScreen(fromPage);
    const to0 = this.lens.toScreen(toPage);
    const distance = Math.hypot(to0.x - from0.x, to0.y - from0.y);
    await this.play(generation, Math.min(650, 320 + distance * 0.35), (t) => {
      const from = this.lens.toScreen(fromPage);
      const to = this.lens.toScreen(toPage);
      const bend = Math.min(36, Math.hypot(to.x - from.x, to.y - from.y) / 8);
      const s = 1 - t;
      this.put(cursor, {
        x: s * s * from.x + 2 * s * t * ((from.x + to.x) / 2 + bend) + t * t * to.x,
        y: s * s * from.y + 2 * s * t * ((from.y + to.y) / 2 - bend) + t * t * to.y,
      });
    });
    if (generation === this.generation) this.put(cursor, this.lens.toScreen(toPage));
  }

  private connector(placement: Placement) {
    return (
      placement.elements.length > 0 &&
      placement.elements.every((element) => element.dataset.adKind === 'connector')
    );
  }

  private onScreen(placement: Placement) {
    const corner = this.lens.toScreen(placement.box);
    const right = corner.x + placement.box.w * this.lens.zoom;
    const bottom = corner.y + placement.box.h * this.lens.zoom;
    const { width, height } = this.lens;
    return right >= 0 && bottom >= 0 && corner.x <= width && corner.y <= height;
  }

  private visitable(placement: Placement) {
    return (
      placement.elements.some((element) => element.isConnected) &&
      !this.connector(placement) &&
      this.onScreen(placement)
    );
  }

  private take(list: Placement[]) {
    return list.splice(0).flatMap((entry) => entry.elements);
  }

  private show(generation: number, element: HTMLElement) {
    if (!this.pending.has(element)) return;
    element.classList.remove('ad-agent-pending');
    element.tabIndex = 0;
    this.pending.delete(element);
    this.reveal(generation, element);
  }

  private reveal(generation: number, element: HTMLElement) {
    const opacity = element.style.opacity || '1';
    const transform = element.style.transform;
    const to = Number(opacity);
    const restore = () => {
      element.style.opacity = opacity;
      element.style.transform = transform;
    };
    this.restore.set(element, restore);
    void this.play(generation, 220, (t) => {
      element.style.opacity = String(to * t);
      if (element.dataset.adKind !== 'connector')
        element.style.transform = `${transform} scale(${0.97 + 0.03 * t})`;
    }).then(() => {
      if (generation !== this.generation) return;
      restore();
      this.restore.delete(element);
    });
  }

  private async run(generation: number): Promise<void> {
    this.running = true;
    let position: Point | undefined;
    let stops = 0;
    const deferred: Placement[] = [];
    while (this.queue.length && generation === this.generation) {
      if (this.quiet()) {
        this.clear();
        return;
      }
      this.prune();
      if (generation !== this.generation) return;
      const placement = this.queue.shift();
      if (!placement) break;
      if (!this.visitable(placement)) {
        deferred.push(placement);
        continue;
      }
      const last =
        ++stops >= SEQUENTIAL_STOPS || !this.queue.some((entry) => this.visitable(entry));
      if (last) placement.elements.push(...this.take(deferred), ...this.take(this.queue));
      const target = this.center(placement.box);
      if (!this.cursor) {
        this.cursor = document.createElement('div');
        this.cursor.className = 'ad-agent-cursor';
        this.cursor.setAttribute('aria-hidden', 'true');
        this.cursor.innerHTML = `<svg width="36" height="36" viewBox="0 0 36 36"><path d="${cursorArrow}"/></svg>${this.name ? `<span>${esc(this.name)}</span>` : ''}`;
        const edge = this.edge(this.lens.toScreen(target));
        position = this.lens.toPage(edge);
        this.put(this.cursor, edge);
        this.cursor.dataset.adFrom = `${edge.x},${edge.y}`;
        this.root.append(this.cursor);
      }
      const cursor = this.cursor;
      await this.move(generation, cursor, position!, target);
      if (generation !== this.generation) return;
      const landed = this.lens.toScreen(target);
      cursor.dataset.adLanded = `${landed.x},${landed.y}`;
      position = target;
      for (const element of placement.elements) this.show(generation, element);
      const svg = cursor.querySelector('svg');
      if (svg)
        await this.play(generation, 260, (t) => {
          svg.style.transform = `scale(${t < 0.35 ? 1 - (t / 0.35) * 0.1 : 0.9 + ((t - 0.35) / 0.65) * 0.1})`;
        });
      if (svg && generation === this.generation) svg.style.transform = '';
    }
    if (generation !== this.generation) return;
    if (deferred.length) {
      for (const element of this.take(deferred)) this.show(generation, element);
    }
    if (generation !== this.generation) return;
    if (this.cursor && position) {
      const leave = this.lens.toPage(this.edge(this.lens.toScreen(position)));
      await this.move(generation, this.cursor, position, leave);
    }
    if (generation !== this.generation) return;
    this.cursor?.remove();
    this.cursor = undefined;
    if (this.queue.length) return this.run(generation);
    this.clear();
  }
}
