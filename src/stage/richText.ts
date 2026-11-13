import { HEADING_SCALE, markerIndent, parseRichText } from '../core/richText';

/**
 * Fill a label element. Plain text is one text node. `md` text is one `div.annie-line` per source
 * line with `data-ad-line` set to `p`, `h1`, `h2`, `ul`, or `ol`. A list line holds a
 * `span.annie-marker` and a `span` with the content. Bold runs are `strong`, italic runs `em`
 * (bold italic is `strong > em`); other runs are text nodes. No markup is parsed by the browser.
 */
export function fillText(element: HTMLElement, value: string, md: boolean): void {
  if (!md) {
    element.textContent = value;
    return;
  }
  const owner = element.ownerDocument;
  const make = (tag: string, className = '') => {
    const node = owner.createElement(tag);
    if (className) node.className = className;
    return node;
  };
  element.replaceChildren(
    ...parseRichText(value).map((line) => {
      const row = make('div', 'annie-line');
      row.dataset.adLine = line.kind;
      const scale = HEADING_SCALE[line.kind];
      if (scale) row.style.cssText = `font-size:${scale}em;font-weight:700`;
      let body = row;
      if (line.marker) {
        const marker = make('span', 'annie-marker');
        marker.textContent = line.marker;
        marker.style.cssText = `flex:none;width:${markerIndent(line)}em`;
        body = make('span');
        body.style.minWidth = '0';
        row.style.display = 'flex';
        row.append(marker, body);
      }
      for (const run of line.runs) {
        let node: Node = owner.createTextNode(run.text);
        for (const [on, tag] of [
          [run.italic, 'em'],
          [run.bold, 'strong'],
        ] as const)
          if (on) {
            const wrap = make(tag);
            wrap.append(node);
            node = wrap;
          }
        body.append(node);
      }
      if (!line.runs.length) body.append(make('br'));
      return row;
    }),
  );
}
