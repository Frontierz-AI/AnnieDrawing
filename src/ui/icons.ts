const paths: Record<string, string> = {
  select:
    '<path d="M5.8 3.8c-1-.4-1.7.4-1.4 1.4l4.9 14.4c.4 1.1 1.8 1.1 2.2 0l2.2-5.8 5.8-2.2c1.1-.4 1.1-1.8 0-2.2Z"/>',
  hand: '<path d="M8 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v8c0 5-4 7-7 7-3 0-4-2-6-5l-3-4c-1-2 1-4 3-2l2 2"/>',
  rect: '<rect x="3.75" y="4.75" width="16.5" height="14.5" rx="4"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.25" ry="7.25"/>',
  diamond:
    '<path d="m13.4 3.8 6.8 6.8a2 2 0 0 1 0 2.8l-6.8 6.8a2 2 0 0 1-2.8 0l-6.8-6.8a2 2 0 0 1 0-2.8l6.8-6.8a2 2 0 0 1 2.8 0Z"/>',
  line: '<path d="m5.5 18.5 13-13"/><circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="5" r="1.5" fill="currentColor" stroke="none"/>',
  connector: '<path d="M4 18h5a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3h5m-4-4 4 4-4 4"/>',
  path: '<path d="M3.5 17.5c1.8-5 3.2-11 6-11 4 0-1 12 3 12 2.8 0 3.2-8 5.5-8 1.6 0 2.3 2 2.5 4"/>',
  text: '<path d="M5 7V4.5h14V7M12 4.5v15M8.5 19.5h7"/>',
  note: '<path d="M7 3.75h10a3.25 3.25 0 0 1 3.25 3.25v7.1a2 2 0 0 1-.6 1.4l-4.2 4.2a2 2 0 0 1-1.4.6H7A3.25 3.25 0 0 1 3.75 17V7A3.25 3.25 0 0 1 7 3.75Z"/><path d="M20 14h-3.5a2.5 2.5 0 0 0-2.5 2.5V20"/>',

  lock: '<rect x="5" y="10" width="14" height="11" rx="3.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  unlock:
    '<rect x="5" y="10" width="14" height="11" rx="3.5"/><path d="M8 10V7a4 4 0 0 1 7.5-2M12 14v3"/>',
  opacity:
    '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none"/>',
  front:
    '<rect x="8" y="3.5" width="12.5" height="12.5" rx="3.5"/><path d="M15.5 16v1A3.5 3.5 0 0 1 12 20.5H7A3.5 3.5 0 0 1 3.5 17v-5A3.5 3.5 0 0 1 7 8.5h1"/>',
  back: '<rect x="3.5" y="8" width="12.5" height="12.5" rx="3.5"/><path d="M8.5 8V7A3.5 3.5 0 0 1 12 3.5h5A3.5 3.5 0 0 1 20.5 7v5A3.5 3.5 0 0 1 17 15.5h-1"/>',
  eraser:
    '<path d="m13.2 4.3-9 9a2.4 2.4 0 0 0 0 3.4L7.5 20h4l8.2-8.2a2.4 2.4 0 0 0 0-3.4l-4.1-4.1a1.7 1.7 0 0 0-2.4 0ZM8 10.5l7.5 7.5M11.5 20H21"/>',
  undo: '<path d="m8 5-4.5 4.5L8 14M4 9.5h9.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m16 5 4.5 4.5L16 14m4-4.5h-9.5a5.5 5.5 0 0 0 0 11H13"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  minus: '<path d="M5.5 12h13"/>',
  fit: '<path d="M8.5 3.75h-3a1.75 1.75 0 0 0-1.75 1.75v3m11.75-4.75h3a1.75 1.75 0 0 1 1.75 1.75v3M3.75 15.5v3a1.75 1.75 0 0 0 1.75 1.75h3m11.75-4.75v3a1.75 1.75 0 0 1-1.75 1.75h-3"/>',
  chevron: '<path d="m7 9.5 3.6 3.6a2 2 0 0 0 2.8 0L17 9.5"/>',
  download: '<path d="M12 3.5v11m-4-4 4 4 4-4M4.5 15.5v2A3 3 0 0 0 7.5 20h9a3 3 0 0 0 3-2.5v-2"/>',
  upload: '<path d="M12 15V4m-4 4 4-4 4 4M4.5 15.5v2A3 3 0 0 0 7.5 20h9a3 3 0 0 0 3-2.5v-2"/>',
  code: '<path d="m7 7-4 4a1.4 1.4 0 0 0 0 2l4 4m10-10 4 4a1.4 1.4 0 0 1 0 2l-4 4M14 4l-4 16"/>',
  close: '<path d="m6.5 6.5 11 11m-11 0 11-11"/>',
  check: '<path d="m5 12 4.2 4.2a1.1 1.1 0 0 0 1.6 0L19 7"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  image:
    '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m4 17 3.6-3.6a1.3 1.3 0 0 1 1.8 0l2.1 2.1 3.4-5.1a1.3 1.3 0 0 1 2.2 0L20 15"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v1M12 20.5v1M2.5 12h1m17 0h1M5.3 5.3l.7.7m12 12 .7.7M5.3 18.7l.7-.7M18 6l.7-.7"/>',
  moon: '<path d="M20 14.5a8.2 8.2 0 0 1-10.5-10c-3.9.7-6.4 3.7-6.4 7.5a8.1 8.1 0 0 0 16.9 2.5Z"/>',
  trash:
    '<path d="M4 6.5h16M9 6.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v1.5m-9 0 .7 11.2A3 3 0 0 0 9.7 20.5h4.6a3 3 0 0 0 3-2.8L18 6.5M10 10.5v6m4-6v6"/>',
  copy: '<rect x="8" y="8" width="12.5" height="12.5" rx="3.5"/><path d="M15.5 8V7A3.5 3.5 0 0 0 12 3.5H7A3.5 3.5 0 0 0 3.5 7v5A3.5 3.5 0 0 0 7 15.5h1"/>',
  grid: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M9 4v16m6-16v16M4 9h16M4 15h16"/>',
  spark:
    '<path d="m12 3 2.2 5.4a2.5 2.5 0 0 0 1.4 1.4L21 12l-5.4 2.2a2.5 2.5 0 0 0-1.4 1.4L12 21l-2.2-5.4a2.5 2.5 0 0 0-1.4-1.4L3 12l5.4-2.2a2.5 2.5 0 0 0 1.4-1.4Z"/>',
  arrow: '<path d="M4.5 12h15m-5-5 4 4a1.4 1.4 0 0 1 0 2l-4 4"/>',
  book: '<path d="M12 5.5c-2.6-2-5.2-2.5-8-2v15c2.8-.5 5.4 0 8 2 2.6-2 5.2-2.5 8-2v-15c-2.8-.5-5.4 0-8 2Zm0 0v15"/>',
  group:
    '<rect x="2.75" y="2.75" width="18.5" height="18.5" rx="4" stroke-dasharray="2 3"/><rect x="6.5" y="6.5" width="5.5" height="5.5" rx="1.5"/><rect x="12" y="12" width="5.5" height="5.5" rx="1.5"/>',
  alignLeft: '<path d="M4 5h16M4 12h10M4 19h16"/>',
  alignCenter: '<path d="M4 5h16M7 12h10M4 19h16"/>',
  alignRight: '<path d="M4 5h16M10 12h10M4 19h16"/>',
  align:
    '<path d="M4 3.5v17"/><rect x="8" y="5" width="12.5" height="5" rx="1.75"/><rect x="8" y="14" width="8.5" height="5" rx="1.75"/>',
  shapes:
    '<rect x="3" y="3" width="8.5" height="8.5" rx="2.5"/><circle cx="17.3" cy="6.7" r="3.7"/><path d="m6 14-3.5 6h8L7 14a.6.6 0 0 0-1 0Z"/><rect x="13.5" y="13.5" width="7" height="7" rx="2" transform="rotate(45 17 17)"/>',
  settings:
    '<path d="M4 7h3m5 0h8M4 17h8m5 0h3"/><circle cx="9.5" cy="7" r="2.5"/><circle cx="14.5" cy="17" r="2.5"/>',
  pages:
    '<rect x="7" y="3.5" width="13.5" height="14" rx="3.5"/><path d="M16.5 17.5v.5a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5v-8A2.5 2.5 0 0 1 6 7.5h1"/>',
  palette:
    '<path d="M20.5 11.3c0-4.4-3.8-7.8-8.5-7.8S3.5 7.3 3.5 12a8.5 8.5 0 0 0 8.5 8.5h.7c1.5-.1 2-1.8 1.1-2.8l-.3-.3c-.9-1.1-.2-2.9 1.2-2.9h2.5c2 0 3.3-1.2 3.3-3.2Z"/><circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="8" r="1" fill="currentColor" stroke="none"/>',
};
export function icon(name: string) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.spark}</svg>`;
}
export function button(
  label: string,
  name: string,
  handler: () => void,
  className = 'ad-icon-button',
) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.title = label;
  el.setAttribute('aria-label', label);
  el.innerHTML = icon(name);
  el.addEventListener('click', () => {
    el.focus();
    handler();
  });
  return el;
}
