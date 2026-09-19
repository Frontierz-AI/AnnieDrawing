import type { Box, Point } from '../core/types';
import { cursorArrow } from '../input/cursors';
import type { Lens } from './lens';

interface Placement {
  box: Box;
  elements: HTMLElement[];
}

/** Presentation only: documents, exports and history commit before the cursor arrives. */
export class AgentPresence {
  private queue: Placement[] = [];
  private pending = new Set<HTMLElement>();
  private animations = new Set<Animation>();
  private cursor?: HTMLElement;
  private frame = 0;
  private generation = 0;
  private running = false;
  private motion = matchMedia('(prefers-reduced-motion: reduce)');
  private preference = () => {
    if (this.motion.matches || document.hidden) this.clear();
  };

  constructor(
    private root: HTMLElement,
    private lens: Lens,
  ) {
    this.motion.addEventListener('change', this.preference);
    document.addEventListener('visibilitychange', this.preference);
  }

  enqueue(placements: Placement[]) {
    if (this.motion.matches || document.hidden) return;
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
    this.frame = 0;
    for (const element of this.pending) element.classList.remove('ad-agent-pending');
    this.pending.clear();
    for (const animation of this.animations) animation.cancel();
    this.animations.clear();
    this.queue = [];
    this.cursor?.remove();
    this.cursor = undefined;
    this.running = false;
  }

  destroy() {
    this.clear();
    this.motion.removeEventListener('change', this.preference);
    document.removeEventListener('visibilitychange', this.preference);
  }

  private async animate(element: Element, frames: Keyframe[], duration: number) {
    const animation = element.animate(frames, {
      duration,
      easing: 'cubic-bezier(.22,1,.36,1)',
      fill: 'forwards',
    });
    this.animations.add(animation);
    try {
      await animation.finished;
    } catch {
      /* Interrupted by a person's edit or navigation. */
    }
    this.animations.delete(animation);
    animation.cancel();
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

  private async move(cursor: HTMLElement, from: Point, to: Point) {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const bend = Math.min(36, distance / 8);
    const control = { x: (from.x + to.x) / 2 + bend, y: (from.y + to.y) / 2 - bend };
    const frames = Array.from({ length: 17 }, (_, index) => {
      const t = index / 16,
        s = 1 - t;
      return {
        transform: this.transform({
          x: s * s * from.x + 2 * s * t * control.x + t * t * to.x,
          y: s * s * from.y + 2 * s * t * control.y + t * t * to.y,
        }),
      };
    });
    await this.animate(cursor, frames, Math.min(650, 320 + distance * 0.35));
    cursor.style.transform = this.transform(to);
  }

  private async run(generation: number): Promise<void> {
    this.running = true;
    let position: Point | undefined;
    let stops = 0;
    while (this.queue.length && generation === this.generation) {
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
        this.cursor.innerHTML = `<svg width="36" height="36" viewBox="0 0 36 36"><path d="${cursorArrow}"/></svg><span>AI</span>`;
        position = this.edge(target);
        this.cursor.style.transform = this.transform(position);
        this.root.append(this.cursor);
      }
      const cursor = this.cursor;
      await this.move(cursor, position!, target);
      if (generation !== this.generation) return;
      position = target;
      for (const element of placement.elements) {
        element.classList.remove('ad-agent-pending');
        this.pending.delete(element);
        const transform = element.style.transform;
        const settled =
          element.dataset.adKind === 'connector' ? {} : { transform: `${transform} scale(.97)` };
        void this.animate(
          element,
          [
            { opacity: 0, ...settled },
            { opacity: element.style.opacity || 1, transform },
          ],
          220,
        );
      }
      await this.animate(
        cursor.querySelector('svg')!,
        [
          { transform: 'scale(1)' },
          { transform: 'scale(.9)', offset: 0.35 },
          { transform: 'scale(1)' },
        ],
        260,
      );
    }
    if (generation !== this.generation) return;
    if (this.cursor && position) await this.move(this.cursor, position, this.edge(position));
    if (generation !== this.generation) return;
    this.cursor?.remove();
    this.cursor = undefined;
    if (this.queue.length) return this.run(generation);
    this.clear();
  }
}
