/** Height presets for checking short-desktop chrome. */
const heights = [900, 640, 600, 500, 480] as const;

const hudStyle = `#chrome-preview-hud{position:fixed;left:50%;top:8px;z-index:20;transform:translateX(-50%);display:flex;flex-wrap:wrap;gap:8px;align-items:center;max-width:calc(100% - 24px);padding:8px 10px;border:1px solid #10363922;border-radius:12px;background:#fffffff2;box-shadow:0 4px 20px #10363912;font-size:12px}#chrome-preview-hud p{margin:0;font-weight:800}#chrome-preview-hud button,#chrome-preview-hud a{border:1px solid #10363922;border-radius:8px;background:#fff;color:#103639;padding:4px 8px;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}`;

export function mountChromePreview(host: HTMLElement, otherHref: string, otherLabel: string) {
  if (!document.querySelector('style[data-chrome-preview]')) {
    const style = document.createElement('style');
    style.dataset.chromePreview = '';
    style.textContent = hudStyle;
    document.head.append(style);
  }
  const hud = document.createElement('aside');
  hud.id = 'chrome-preview-hud';
  const readout = document.createElement('p');
  const row = document.createElement('div');
  for (const height of heights) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${height}px`;
    button.addEventListener('click', () => setHostHeight(host, height));
    row.append(button);
  }
  const fill = document.createElement('button');
  fill.type = 'button';
  fill.textContent = 'Fill window';
  fill.addEventListener('click', () => setHostHeight(host, 0));
  row.append(fill);
  const link = document.createElement('a');
  link.href = otherHref;
  link.textContent = otherLabel;
  hud.append(readout, row, link);
  document.body.append(hud);
  const update = () => {
    const root = host.querySelector('.ad-root');
    const toolbar = host.querySelector('.ad-toolbar');
    const tool = host.querySelector('.ad-toolbar .ad-icon-button');
    if (!root || !toolbar || !tool) {
      readout.textContent = 'Board is still loading…';
      return;
    }
    const board = root.getBoundingClientRect();
    const bar = toolbar.getBoundingClientRect();
    const icon = tool.getBoundingClientRect();
    readout.textContent = `Host ${Math.round(board.height)}px · tool ${Math.round(icon.height)}px · left ${Math.round(bar.left)}px`;
  };
  new ResizeObserver(update).observe(host);
  requestAnimationFrame(update);
}

function setHostHeight(host: HTMLElement, height: number) {
  if (!height) {
    host.style.height = '';
    host.style.bottom = '0';
    return;
  }
  host.style.bottom = 'auto';
  host.style.height = `${height}px`;
}
