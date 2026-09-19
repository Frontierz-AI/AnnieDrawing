import type { Box, Point } from '../core/types';
import { cursorArrow } from '../input/cursors';
import type { Lens } from './lens';
import { esc } from './paint';

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

  enqueue(placements: Placement[], name?: string) {
    if (this.quiet()) return;
    const label = name?.trim();
    if (label && !this.name) this.name = label;
    for (const placement of placements) {
      placement.elements = placement.elements.filter((element) => !this.pending.has(element));
      if (!placement.elements.length) continue;
      for (const element of placement.elements) {
        element.classList.add('ad-agent-pending');
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

  viewChanged() {
    if (this.running) this.clear();
  }

  clear() {
    this.generation++;
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.tick);
    this.frame = 0;
    this.tick = 0;
    for (const restore of this.restore.values()) restore();
    this.restore.clear();
    for (const element of this.pending) element.classList.remove('ad-agent-pending');
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
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const step = (now: number) => {
        if (generation !== this.generation) {
          this.tick = 0;
          resolve();
          return;
        }
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

  private async move(generation: number, cursor: HTMLElement, from: Point, to: Point) {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const bend = Math.min(36, distance / 8);
    const control = { x: (from.x + to.x) / 2 + bend, y: (from.y + to.y) / 2 - bend };
    const at = (t: number) => {
      const s = 1 - t;
      return {
        x: s * s * from.x + 2 * s * t * control.x + t * t * to.x,
        y: s * s * from.y + 2 * s * t * control.y + t * t * to.y,
      };
    };
    await this.play(generation, Math.min(650, 320 + distance * 0.35), (t) => {
      cursor.style.transform = this.transform(at(t));
    });
    if (generation === this.generation) cursor.style.transform = this.transform(to);
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
    while (this.queue.length && generation === this.generation) {
      if (this.quiet()) {
        this.clear();
        return;
      }
      const placement = this.queue.shift()!;
      const corner = this.lens.toScreen(placement.box);
      const right = corner.x + placement.box.w * this.lens.zoom;
      const bottom = corner.y + placement.box.h * this.lens.zoom;
      const { width, height } = this.lens;
      if (right < 0 || bottom < 0 || corner.x > width || corner.y > height) {
        for (const element of placement.elements) {
          element.classList.remove('ad-agent-pending');
          this.pending.delete(element);
        }
        continue;
      }
      // Finish large batches together after eight visible stops.
      if (++stops >= 8)
        placement.elements.push(...this.queue.splice(0).flatMap((entry) => entry.elements));
      const target = {
        x: Math.max(12, Math.min(width - 12, (Math.max(0, corner.x) + Math.min(width, right)) / 2)),
        y: Math.max(
          12,
          Math.min(height - 12, (Math.max(0, corner.y) + Math.min(height, bottom)) / 2),
        ),
      };
      if (!this.cursor) {
        this.cursor = document.createElement('div');
        this.cursor.className = 'ad-agent-cursor';
        this.cursor.setAttribute('aria-hidden', 'true');
        this.cursor.innerHTML = `<svg width="36" height="36" viewBox="0 0 36 36"><path d="${cursorArrow}"/></svg>${this.name ? `<span>${esc(this.name)}</span>` : ''}`;
        position = this.edge(target);
        this.cursor.style.transform = this.transform(position);
        this.cursor.dataset.adFrom = `${position.x},${position.y}`;
        this.root.append(this.cursor);
      }
      const cursor = this.cursor;
      await this.move(generation, cursor, position!, target);
      if (generation !== this.generation) return;
      position = target;
      for (const element of placement.elements) {
        element.classList.remove('ad-agent-pending');
        this.pending.delete(element);
        this.reveal(generation, element);
      }
      const svg = cursor.querySelector('svg');
      if (svg)
        await this.play(generation, 260, (t) => {
          svg.style.transform = `scale(${t < 0.35 ? 1 - (t / 0.35) * 0.1 : 0.9 + ((t - 0.35) / 0.65) * 0.1})`;
        });
      if (svg && generation === this.generation) svg.style.transform = '';
    }
    if (generation !== this.generation) return;
    if (this.cursor && position)
      await this.move(generation, this.cursor, position, this.edge(position));
    if (generation !== this.generation) return;
    this.cursor?.remove();
    this.cursor = undefined;
    if (this.queue.length) return this.run(generation);
    this.clear();
  }
}
