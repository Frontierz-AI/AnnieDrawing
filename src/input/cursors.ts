function svgCursor(markup: string, size: number, hotspot: number[], fallback: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${markup}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotspot.join(' ')}, ${fallback}`;
}

export const cursorArrow =
  'M8.5 6.5c-1.3-.5-2.5.7-2 2l6.1 19.4c.5 1.6 2.7 1.7 3.3.1l3.1-8a1.5 1.5 0 0 1 .9-.9l8-3.1c1.6-.6 1.5-2.8-.1-3.3Z';

// Native cursor artwork stays outside the document and tracks the hardware pointer.
export const selectionCursor = svgCursor(
  `<defs><radialGradient id="a"><stop stop-color="#c4b5fd" stop-opacity=".22"/><stop offset="1" stop-color="#c4b5fd" stop-opacity="0"/></radialGradient></defs><circle cx="17" cy="18" r="18" fill="url(#a)"/><path d="${cursorArrow}" fill="none" stroke="#b9a6e6" stroke-width="5" stroke-opacity=".14" stroke-linejoin="round"/><path d="${cursorArrow}" fill="#18252a" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>`,
  36,
  [7, 7],
  'default',
);

const cross = 'M14 4v6m0 8v6M4 14h6m8 0h6';
export const drawingCursor = svgCursor(
  `<circle cx="14" cy="14" r="10" fill="#c4b5fd" fill-opacity=".06"/><path d="${cross}" stroke="#b9a6e6" stroke-opacity=".15" stroke-width="6" stroke-linecap="round"/><path d="${cross}" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="${cross}" stroke="#18252a" stroke-width="1.7" stroke-linecap="round"/><circle cx="14" cy="14" r="1" fill="#18252a"/>`,
  28,
  [14, 14],
  'crosshair',
);

export function cursorForTool(
  tool: string,
  state: { space?: boolean; readonly?: boolean; panning?: boolean } = {},
) {
  if (state.panning) return 'grabbing';
  if (state.space || state.readonly || tool === 'hand') return 'grab';
  if (tool === 'text') return 'text';
  return tool === 'select' ? selectionCursor : drawingCursor;
}
