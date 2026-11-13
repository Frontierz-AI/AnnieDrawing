import type { AgentPresenceOptions, Box, Point } from '../core/types';
import { cursorArrow } from '../input/cursors';
import type { Lens } from './lens';
import { painted } from './itemView';
import { esc } from './paint';

interface Batch {
  elements: Set<HTMLElement>;
  done: () => void;
  /** `presentation.durationMs`, and when it runs out once the walk reaches the batch. */
  ms?: number;
  end?: number;
}
interface Placement {
  box: Box;
  elements: HTMLElement[];
  batch?: Batch;
}
/** A label to write: line boxes `[left, right, top, bottom]` in page units from the label's corner. */
interface Script {
  element: HTMLElement;
  text: HTMLElement;
  lines: number[][];
  origin: Point;
  chars: number;
  key: string;
  first: Node | null;
}
const pen = 'M5 31l2.5-7.4L25.1 5.9a3.5 3.5 0 0 1 5 5L12.4 28.5ZM7.5 23.6l4.9 4.9M21.6 9.4l5 5';

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

  private maxStops: number;
  private durationScale: number;
  /** Characters per second when labels are written; 0 keeps the fade. */
  private cps: number;
  private idle = new Set<() => void>();
  /** Per-batch arrivals: `done` runs once when every element of the batch has settled. */
  private batches = new Set<Batch>();
  /** Elements whose arrival ends when their label is written, and labels clipped meanwhile. */
  private writing = new Set<HTMLElement>();
  private clipped = new Set<HTMLElement>();

  constructor(
    private root: HTMLElement,
    private lens: Lens,
    options: AgentPresenceOptions = {},
  ) {
    this.maxStops = Math.max(1, options.maxStops ?? 8);
    this.durationScale = Math.min(2, Math.max(0.25, options.durationScale ?? 1));
    const write = options.write;
    this.cps = write
      ? Math.min(400, Math.max(5, (typeof write === 'object' && write.charsPerSecond) || 30))
      : 0;
    this.motion.addEventListener('change', this.preference);
    document.addEventListener('visibilitychange', this.preference);
  }

  holds(element: HTMLElement) {
    return this.pending.has(element);
  }

  busy() {
    return this.running || this.frame !== 0 || this.pending.size > 0;
  }

  whenIdle(callback: () => void) {
    if (!this.busy()) {
      callback();
      return;
    }
    this.idle.add(callback);
  }

  enqueue(placements: Placement[], name?: string, done = () => {}, ms?: number) {
    if (this.quiet()) return done();
    const label = name?.trim();
    if (label && !this.name) this.name = label;
    const batch: Batch = {
      elements: new Set(),
      done,
      ms: ms! >= 0 ? Math.min(6e4, ms!) : undefined,
    };
    for (const placement of placements) {
      placement.batch = batch;
      placement.elements = placement.elements.filter((element) => !this.pending.has(element));
      if (!placement.elements.length) continue;
      for (const element of placement.elements) {
        element.classList.add('annie-agent-pending');
        element.tabIndex = -1;
        this.pending.add(element);
        batch.elements.add(element);
      }
      this.queue.push(placement);
    }
    if (!batch.elements.size) return done();
    this.batches.add(batch);
    if (!this.running && !this.frame && this.queue.length)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        void this.run(this.generation).catch(() => this.clear());
      });
  }

  /** Drop items that left the document; keep the walk going for what remains. */
  prune() {
    let dropped = false;
    for (const element of [...this.pending]) {
      if (element.isConnected) continue;
      dropped = true;
      this.restore.get(element)?.();
      this.restore.delete(element);
      this.pending.delete(element);
      this.settle(element);
    }
    const keep = (placement: Placement) => {
      placement.elements = placement.elements.filter((element) => this.pending.has(element));
      return placement.elements.length > 0;
    };
    this.queue = this.queue.filter(keep);
    if (!this.pending.size && !this.writing.size && (dropped || (!this.running && !this.frame)))
      this.clear();
  }

  clear() {
    this.generation++;
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.tick);
    this.frame = 0;
    this.tick = 0;
    for (const restore of this.restore.values()) restore();
    this.restore.clear();
    for (const text of this.clipped) text.style.clipPath = '';
    this.clipped.clear();
    this.writing.clear();
    for (const element of this.pending) {
      element.classList.remove('annie-agent-pending');
      if (element.tabIndex < 0) element.tabIndex = 0;
    }
    this.pending.clear();
    this.queue = [];
    this.cursor?.remove();
    this.cursor = undefined;
    this.name = undefined;
    this.running = false;
    this.settle();
    const callbacks = [...this.idle];
    this.idle.clear();
    for (const callback of callbacks) callback();
  }

  destroy() {
    this.clear();
    this.motion.removeEventListener('change', this.preference);
    document.removeEventListener('visibilitychange', this.preference);
  }

  /** A frame that returns false ends the animation early. */
  private async play(
    generation: number,
    duration: number,
    frame: (t: number) => void | boolean,
    linear = false,
  ) {
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
        if (frame(linear ? t : 1 - (1 - t) ** 3) !== false && t < 1)
          this.tick = requestAnimationFrame(step);
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

  /** Default move duration between two page points. */
  private span(fromPage: Point, toPage: Point) {
    const from = this.lens.toScreen(fromPage);
    const to = this.lens.toScreen(toPage);
    return (
      Math.min(650, 320 + Math.hypot(to.x - from.x, to.y - from.y) * 0.35) * this.durationScale
    );
  }

  private async move(
    generation: number,
    cursor: HTMLElement,
    fromPage: Point,
    toPage: Point,
    ms = this.span(fromPage, toPage),
  ) {
    await this.play(generation, ms, (t) => {
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

  private show(generation: number, element: HTMLElement, ms = 220 * this.durationScale) {
    if (!this.pending.has(element)) return;
    element.classList.remove('annie-agent-pending');
    element.tabIndex = 0;
    this.pending.delete(element);
    // Standalone text is written, not faded. A batch with a duration ends its fades on time.
    if (this.writing.has(element) && element.dataset.adKind === 'text') return;
    const end = [...this.batches].find((batch) => batch.elements.has(element))?.end;
    this.reveal(generation, element, end ? Math.min(ms, Math.max(0, end - performance.now())) : ms);
  }

  private reveal(generation: number, element: HTMLElement, ms: number) {
    // Read what the item view painted on every frame, so a move or restyle during the fade sticks.
    const initial = { opacity: element.style.opacity || '1', transform: element.style.transform };
    const base = () => painted.get(element) ?? initial;
    const restore = () => {
      element.style.opacity = base().opacity;
      element.style.transform = base().transform;
    };
    this.restore.set(element, restore);
    void this.play(generation, ms, (t) => {
      element.style.opacity = String(Number(base().opacity) * t);
      if (element.dataset.adKind !== 'connector')
        element.style.transform = `${base().transform} scale(${0.97 + 0.03 * t})`;
    }).then(() => {
      if (generation !== this.generation) return;
      restore();
      this.restore.delete(element);
      if (!this.writing.has(element)) this.settle(element);
    });
  }

  /** Visible, unrotated labels of non-connectors, when writing is on. */
  private labels(placement: Placement) {
    return this.cps
      ? placement.elements.flatMap((element) => {
          const text = element.querySelector<HTMLElement>(':scope > .annie-text');
          return text?.textContent?.trim() &&
            text.style.display !== 'none' &&
            element.dataset.adKind !== 'connector' &&
            /rotate\(0deg\)$/.test(painted.get(element)?.transform ?? '')
            ? [[element, text] as const]
            : [];
        })
      : [];
  }

  private key(element: HTMLElement) {
    return `${painted.get(element)?.transform}|${element.style.width}|${element.style.height}`;
  }

  /** Line boxes are measured once, before the label shows; the clip and pen follow them. */
  private measure(element: HTMLElement, text: HTMLElement): Script {
    const zoom = this.lens.zoom;
    const box = text.getBoundingClientRect();
    const root = this.root.getBoundingClientRect();
    const lines: number[][] = [];
    const walk = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    while (walk.nextNode()) {
      range.selectNodeContents(walk.currentNode);
      for (const rect of range.getClientRects()) {
        if (!rect.width) continue;
        const [l, r, t, b] = [rect.left, rect.right, rect.top, rect.bottom].map(
          (value, index) => (value - (index < 2 ? box.left : box.top)) / zoom,
        );
        const line = lines[lines.length - 1];
        if (line && (t + b) / 2 > line[2] && (t + b) / 2 < line[3])
          lines[lines.length - 1] = [
            Math.min(line[0], l),
            Math.max(line[1], r),
            Math.min(line[2], t),
            Math.max(line[3], b),
          ];
        else lines.push([l, r, t, b]);
      }
    }
    return {
      element,
      text,
      lines,
      origin: this.lens.toPage({
        x: box.left - root.left - this.root.clientLeft,
        y: box.top - root.top - this.root.clientTop,
      }),
      chars: text.textContent!.length,
      key: this.key(element),
      first: text.firstChild,
    };
  }

  /** Pen tip on line `i` at local `x` (default: the line start), in page coordinates. */
  private tip({ lines, origin }: Script, i = 0, x = lines[i][0]): Point {
    const [, , t, b] = lines[i];
    return { x: origin.x + x, y: origin.y + b - (b - t) / 5 };
  }

  /** Show every line above line `i`, and line `i` up to `x`. */
  private clip({ lines, text }: Script, i = 0, x = lines[i][0]) {
    const [, , t, b] = lines[i];
    text.style.clipPath = `polygon(-9999px -9999px,9999px -9999px,9999px ${t}px,${x}px ${t}px,${x}px ${b}px,-9999px ${b}px)`;
    this.clipped.add(text);
  }

  /** Writing ends early, on the current document, when the label is edited, refilled, moved, resized or removed. */
  private async write(generation: number, cursor: HTMLElement, script: Script, ms: number) {
    const { element, text, lines, first, key } = script;
    const total = lines.reduce((sum, [l, r]) => sum + r - l, 0);
    let point = this.tip(script);
    await this.play(
      generation,
      ms,
      (t) => {
        if (
          !element.isConnected ||
          text.isContentEditable ||
          text.firstChild !== first ||
          key !== this.key(element)
        ) {
          return false;
        }
        let i = 0;
        let x = t * total;
        for (; i < lines.length - 1 && x > lines[i][1] - lines[i][0]; i++)
          x -= lines[i][1] - lines[i][0];
        x += lines[i][0];
        this.clip(script, i, x);
        this.put(cursor, this.lens.toScreen((point = this.tip(script, i, x))));
      },
      true,
    );
    if (generation !== this.generation) return point;
    text.style.clipPath = '';
    this.clipped.delete(text);
    this.writing.delete(element);
    this.settle(element);
    return point;
  }

  /** The one place a batch's arrival ends; omit `element` to finish every batch. */
  private settle(element?: HTMLElement) {
    for (const batch of [...this.batches]) {
      if (element) batch.elements.delete(element);
      if (element && batch.elements.size) continue;
      this.batches.delete(batch);
      batch.done();
    }
  }

  private async run(generation: number): Promise<void> {
    this.running = true;
    let position: Point | undefined;
    let stops = 0;
    const deferred: Placement[] = [];
    const fade = 220 * this.durationScale;
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
      // Written labels are always stops; the rest follow maxStops and then appear together.
      const scripts = this.labels(placement)
        .map(([element, text]) => this.measure(element, text))
        .filter((script) => script.lines.length);
      const last =
        !scripts.length &&
        (++stops >= this.maxStops ||
          !this.queue.some((entry) => this.visitable(entry) && !this.labels(entry).length));
      if (last) {
        const rest = this.queue.filter((entry) => !this.labels(entry).length);
        this.queue = this.queue.filter((entry) => !rest.includes(entry));
        placement.elements.push(
          ...(this.queue.length ? [] : this.take(deferred)),
          ...this.take(rest),
        );
      }
      const target = scripts.length ? this.tip(scripts[0]) : this.center(placement.box);
      if (!this.cursor) {
        this.cursor = document.createElement('div');
        this.cursor.className = 'annie-agent-cursor';
        this.cursor.setAttribute('aria-hidden', 'true');
        this.cursor.innerHTML = `<svg width="36" height="36" viewBox="0 0 36 36"><path d="${cursorArrow}"/></svg>${this.cps ? `<svg class="annie-pen" width="36" height="36" viewBox="0 0 36 36"><path d="${pen}"/></svg>` : ''}${this.name ? `<span>${esc(this.name)}</span>` : ''}`;
        const edge = this.edge(this.lens.toScreen(target));
        position = this.lens.toPage(edge);
        this.put(this.cursor, edge);
        this.cursor.dataset.adFrom = `${edge.x},${edge.y}`;
        this.root.append(this.cursor);
      }
      const cursor = this.cursor;
      // With a batch duration each stop gets a share of what is left, by characters written
      // (12 for a stop that writes nothing). Moves take at most 30% of a writing share.
      const span = this.span(position!, target);
      const labeled = scripts.some((script) => script.element.dataset.adKind !== 'text');
      const batch = placement.batch;
      let scale = 1;
      let budget: number | undefined;
      if (batch?.ms !== undefined) {
        const now = performance.now();
        batch.end ??= now + batch.ms;
        const weight = (entry: Placement) =>
          this.labels(entry).reduce((sum, [, text]) => sum + text.textContent!.length, 0) || 12;
        const share =
          (Math.max(0, batch.end - now) * weight(placement)) /
          [placement, ...this.queue]
            .filter((entry) => entry.batch === batch && this.visitable(entry))
            .reduce((sum, entry) => sum + weight(entry), 0);
        const natural = span + (scripts.length ? (labeled ? fade : 0) : 260 * this.durationScale);
        scale =
          natural > 0
            ? scripts.length
              ? Math.min(1, (share * 0.3) / natural)
              : share / natural
            : 0;
        budget = share - natural * scale;
      }
      cursor.classList.toggle('annie-agent-writing', scripts.length > 0);
      await this.move(generation, cursor, position!, target, span * scale);
      if (generation !== this.generation) return;
      const landed = this.lens.toScreen(target);
      cursor.dataset.adLanded = `${landed.x},${landed.y}`;
      position = target;
      for (const script of scripts) {
        this.writing.add(script.element);
        this.clip(script);
      }
      for (const element of placement.elements) this.show(generation, element, fade * scale);
      const svg = cursor.querySelector('svg');
      if (scripts.length) {
        // A shape fades in first, then its label is written.
        if (labeled) await this.play(generation, fade * scale, () => {});
        const chars = scripts.reduce((sum, script) => sum + script.chars, 0);
        for (const script of scripts) {
          if (generation !== this.generation) return;
          if (script !== scripts[0]) {
            const start = this.tip(script);
            await this.move(
              generation,
              cursor,
              position,
              start,
              this.span(position, start) * scale,
            );
          }
          if (generation !== this.generation) return;
          position = await this.write(
            generation,
            cursor,
            script,
            budget === undefined
              ? Math.min(1e4, Math.max(160, (script.chars / this.cps) * 1000)) * this.durationScale
              : (budget * script.chars) / chars,
          );
        }
      } else if (svg)
        await this.play(generation, 260 * this.durationScale * scale, (t) => {
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
      this.cursor.classList.remove('annie-agent-writing');
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
