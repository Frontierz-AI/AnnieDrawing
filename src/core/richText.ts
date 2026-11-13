import type { ItemText } from './types';
import { wrapPlainText } from './textFit';

/** A styled piece of one line. */
export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}
/** One source line of `format: 'md'` text. `marker` is `•` or the written number, such as `2.`. */
export interface TextLine {
  kind: 'p' | 'h1' | 'h2' | 'ul' | 'ol';
  marker?: string;
  runs: TextRun[];
}
/** One wrapped row. `size` is in px; `indent` is the hanging indent in px. */
export interface TextRow {
  line: TextLine;
  first: boolean;
  size: number;
  indent: number;
  runs: TextRun[];
}

/** Heading size relative to the item's text size. Headings are bold. */
export const HEADING_SCALE: Partial<Record<TextLine['kind'], number>> = { h1: 1.5, h2: 1.25 };
/** Bold glyphs are wider than regular ones by about this factor. */
const BOLD_ADVANCE = 1.08;
const space = (char?: string) => !char || /\s/.test(char);

/** Hanging indent of a list line in em. */
export function markerIndent(line: TextLine): number {
  return line.marker ? Math.max(1.2, line.marker.length * 0.6 + 0.3) : 0;
}

/**
 * `**bold**` and `*italic*` runs. A run of three or more `*` stays literal, as does any marker
 * without a partner. Linear: every delimiter is pushed and popped at most once.
 */
function parseRuns(source: string): TextRun[] {
  const marks: { at: number; len: number; on?: boolean }[] = [];
  const stack: number[] = [];
  const open = [0, 0, 0];
  for (let i = 0; i < source.length;) {
    if (source[i] !== '*') {
      i++;
      continue;
    }
    let end = i;
    while (source[end] === '*') end++;
    const len = end - i;
    if (len < 3) {
      const index = marks.push({ at: i, len }) - 1;
      if (!space(source[i - 1]) && open[len]) {
        let opener: number;
        do {
          opener = stack.pop()!;
          open[marks[opener].len]--;
        } while (marks[opener].len !== len);
        marks[opener].on = marks[index].on = true;
      } else if (!space(source[end])) {
        stack.push(index);
        open[len]++;
      }
    }
    i = end;
  }
  const runs: TextRun[] = [];
  let bold = false,
    italic = false,
    from = 0;
  const push = (to: number) => {
    if (to <= from) return;
    const text = source.slice(from, to),
      last = runs.at(-1);
    if (last && !!last.bold === bold && !!last.italic === italic) last.text += text;
    else runs.push({ text, ...(bold ? { bold } : {}), ...(italic ? { italic } : {}) });
  };
  for (const mark of marks)
    if (mark.on) {
      push(mark.at);
      if (mark.len === 2) bold = !bold;
      else italic = !italic;
      from = mark.at + mark.len;
    }
  push(source.length);
  return runs;
}

/** Parse the `md` subset: `# `, `## `, `- `, `1. ` line prefixes plus bold and italic runs. */
export function parseRichText(value: string): TextLine[] {
  return value.split('\n').map((source) => {
    const prefix = /^(?:(##?)|(-)|(\d{1,9}\.)) /.exec(source);
    const kind = !prefix
      ? 'p'
      : prefix[1]
        ? prefix[1] === '#'
          ? 'h1'
          : 'h2'
        : prefix[2]
          ? 'ul'
          : 'ol';
    const line: TextLine = {
      kind,
      runs: parseRuns(prefix ? source.slice(prefix[0].length) : source),
    };
    if (prefix?.[2]) line.marker = '•';
    if (prefix?.[3]) line.marker = prefix[3];
    return line;
  });
}

/** Text as a reader sees it, without markers. Plain text is returned unchanged. */
export function visibleText(text: ItemText): string {
  if (text.format !== 'md') return text.value;
  return parseRichText(text.value)
    .map((line) => (line.marker ? `${line.marker} ` : '') + line.runs.map((r) => r.text).join(''))
    .join('\n');
}

function lineMetrics(line: TextLine, fontPx: number) {
  const size = fontPx * (HEADING_SCALE[line.kind] ?? 1),
    heading = line.kind === 'h1' || line.kind === 'h2';
  let chars = 0,
    wide = 0;
  for (const run of line.runs) {
    chars += run.text.length;
    if (heading || run.bold) wide += run.text.length;
  }
  // One average advance per line keeps a single wrapping rule for plain and rich text.
  const factor = chars ? 1 + ((BOLD_ADVANCE - 1) * wide) / chars : 1;
  return { size, chars, glyph: size * factor, indent: markerIndent(line) * size };
}

/** Width of an unwrapped line at `advance` em per glyph. */
export function richLineWidth(line: TextLine, fontPx: number, advance: number): number {
  const { chars, glyph, indent } = lineMetrics(line, fontPx);
  return indent + chars * glyph * advance;
}

/** Split runs at the row breaks `wrapPlainText` chose; whitespace it collapsed is skipped. */
function splitRuns(runs: TextRun[], rows: string[]): TextRun[][] {
  let r = 0,
    o = 0;
  const peek = () => {
    while (r < runs.length && o >= runs[r].text.length) {
      r++;
      o = 0;
    }
    return runs[r]?.text[o];
  };
  const skip = () => {
    while (peek() !== undefined && space(peek())) o++;
  };
  return rows.map((row) => {
    const out: TextRun[] = [];
    for (let i = 0; i < row.length; i++) {
      const gap = row[i] === ' ';
      // A space takes the style of the first source whitespace it stands for.
      if (gap) peek();
      else skip();
      const run = runs[Math.min(r, runs.length - 1)] ?? { text: '' };
      if (gap) skip();
      else o++;
      const last = out.at(-1);
      if (last && last.bold === run.bold && last.italic === run.italic) last.text += row[i];
      else out.push({ text: row[i], bold: run.bold, italic: run.italic });
    }
    return out;
  });
}

/** Wrap parsed lines into rows at `width` px, with a hanging indent for list items. */
export function layoutRichText(
  lines: TextLine[],
  width: number,
  fontPx: number,
  advance: number,
): TextRow[] {
  const rows: TextRow[] = [];
  for (const line of lines) {
    const { size, glyph, indent } = lineMetrics(line, fontPx);
    const text = line.runs.map((run) => run.text).join('');
    const wrapped = wrapPlainText(text, width - indent, glyph, advance);
    splitRuns(line.runs, wrapped).forEach((runs, index) =>
      rows.push({ line, first: !index, size, indent, runs }),
    );
  }
  return rows;
}
