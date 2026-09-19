import type { Board } from '../board';
import type { Item, Point } from '../core/types';
import { button, icon } from './icons';
import { color as resolveColor, DEFAULT_FONT, fonts, fontSize, styleFor } from '../stage/paint';
import { pageId } from '../core/ids';
import { ANNIE_MIME } from '../porter/json';
/** PNG, SVG, or AnnieDoc (`json`, saved as `.annie`). */
export type UiExportFormat = 'png' | 'svg' | 'json';
/** Header controls. Pass `ui: false` to `createBoard` to omit all editor chrome. */
export interface UiOptions {
  /** AnnieDrawing control. Default `true`. */
  menu?: boolean;
  /**
   * Export control. Default `['png', 'svg']`. `false` hides it. Include `'json'` for AnnieDoc.
   * One format downloads on click; two or more open a menu.
   */
  export?: boolean | UiExportFormat[];
  /** Page chips, add-page, and All pages. Default true. */
  pages?: boolean;
}
const defaultExportFormats: UiExportFormat[] = ['png', 'svg'];
function exportFormats(value: UiOptions['export']): UiExportFormat[] {
  if (value === false) return [];
  if (!Array.isArray(value)) return [...defaultExportFormats];
  const seen = new Set<UiExportFormat>();
  const formats: UiExportFormat[] = [];
  for (const format of value) {
    if (format !== 'png' && format !== 'svg' && format !== 'json') continue;
    if (seen.has(format)) continue;
    seen.add(format);
    formats.push(format);
  }
  return formats;
}
const tools = [
  ['select', 'Select', 'V'],
  ['hand', 'Hand', 'H'],
  ['rect', 'Rectangle', 'R'],
  ['ellipse', 'Ellipse', 'O'],
  ['diamond', 'Diamond', 'D'],
  ['connector', 'Arrow', 'A'],
  ['line', 'Line', 'L'],
  ['path', 'Draw', 'P'],
  ['text', 'Text', 'T'],
  ['note', 'Sticky note', 'N'],
  ['eraser', 'Eraser', 'E'],
];
const palette = [
  ['ink', 'Ink'],
  ['paper', 'Paper'],
  ['teal', 'Frontierz green'],
  ['moss', 'Soft green'],
  ['coral', 'Orange'],
  ['violet', 'Lavender'],
  ['slate', 'Slate'],
  ['amber', 'Peach'],
  ['sky', 'Sky blue'],
  ['rose', 'Rose'],
  ['none', 'No fill'],
];
/** Narrow hosts, or a short tablet / phone-landscape host. */
function phoneChrome(width: number, height: number) {
  return width <= 700 || (width <= 1023 && height <= 640);
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}
function textButton(label: string, action: () => void, kind = 'ad-button') {
  const b = el('button', kind, label);
  b.type = 'button';
  b.addEventListener('click', () => {
    b.focus();
    action();
  });
  return b;
}
function field(label: string, input: HTMLElement) {
  const wrapper = el('label', 'ad-field');
  wrapper.append(el('span', 'ad-field-label', label), input);
  return wrapper;
}
function select(values: [string, string][], value: string, change: (value: string) => void) {
  const input = el('select');
  values.forEach(([v, text]) => {
    const o = el('option', '', text);
    o.value = v;
    input.append(o);
  });
  if (!values.some(([v]) => v === value)) {
    const custom = el('option', '', value);
    custom.value = value;
    input.append(custom);
  }
  input.value = value;
  input.onchange = () => change(input.value);
  return input;
}
function download(content: string | Blob, name: string, type: string) {
  const url = URL.createObjectURL(
    typeof content === 'string' ? new Blob([content], { type }) : content,
  );
  const link = el('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function mountUI(board: Board, options: UiOptions = {}): () => void {
  const ui = el('div', 'ad-ui');
  board.stage.root.append(ui);
  const unsubs: (() => void)[] = [];
  let activeDialog: HTMLDialogElement | undefined;
  function dialog(title: string) {
    closePopover();
    activeDialog?.close();
    const previous = document.activeElement as HTMLElement;
    const d = el('dialog', 'ad-dialog');
    const head = el('div', 'ad-dialog-head');
    const copy = el('div');
    copy.append(el('h2', '', title));
    head.append(
      copy,
      button('Close', 'close', () => d.close()),
    );
    d.append(head);
    d.addEventListener('click', (e) => {
      if (e.target === d) {
        const r = d.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
          d.close();
      }
    });
    d.addEventListener('close', () => {
      d.remove();
      if (activeDialog === d) activeDialog = undefined;
      if (!activeDialog) {
        refresh();
        if (previous?.isConnected) previous.focus();
        else board.focus();
      }
    });
    ui.append(d);
    activeDialog = d;
    d.showModal();
    return d;
  }
  let activePopover: HTMLElement | undefined;
  let popoverTrigger: HTMLButtonElement | undefined;
  let pagePressTimer: ReturnType<typeof setTimeout> | undefined;
  function closePopover() {
    activePopover?.hidePopover();
    activePopover?.remove();
    activePopover = undefined;
    popoverTrigger?.setAttribute('aria-expanded', 'false');
    if (popoverTrigger) popoverTrigger.popoverTargetElement = null;
    popoverTrigger = undefined;
  }
  function popover(trigger: HTMLButtonElement | undefined, label: string) {
    if (trigger && popoverTrigger === trigger && activePopover?.matches(':popover-open')) {
      closePopover();
      return;
    }
    closePopover();
    const panel = el('div', 'ad-popover');
    panel.popover = 'auto';
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', label);
    const previous = document.activeElement as HTMLElement;
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'true');
      trigger.popoverTargetElement = panel;
      trigger.popoverTargetAction = 'show';
    }
    activePopover = panel;
    popoverTrigger = trigger;
    panel.addEventListener('toggle', () => {
      if (activePopover === panel && !panel.matches(':popover-open'))
        trigger?.setAttribute('aria-expanded', 'false');
    });
    panel.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape' || (event.key === 'Tab' && panel.popover === 'manual')) {
        if (event.key === 'Escape') event.preventDefault();
        closePopover();
        if (previous?.isConnected) previous.focus();
        else board.focus();
      } else if (
        !(event.target instanceof HTMLInputElement) &&
        ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
      ) {
        const buttons = [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (current +
                  (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        event.preventDefault();
        buttons[next]?.focus();
      }
    });
    ui.append(panel);
    return panel;
  }
  function showPopover(
    panel: HTMLElement,
    trigger: HTMLButtonElement,
    alignTo: HTMLElement = trigger,
  ) {
    panel.showPopover();
    const anchor = alignTo.getBoundingClientRect(),
      bounds = board.stage.root.getBoundingClientRect();
    const mobile = phoneChrome(bounds.width, bounds.height),
      width = Math.min(228, bounds.width - 24);
    panel.style.width = `${width}px`;
    const height = panel.getBoundingClientRect().height;
    const besideToolbar = trigger.closest('.ad-toolbar') && !mobile;
    const left = besideToolbar
      ? anchor.right + 12
      : trigger.closest('.ad-header') && anchor.left < bounds.left + bounds.width / 2
        ? anchor.left
        : anchor.right - width;
    const top = besideToolbar
      ? anchor.top
      : anchor.top > bounds.top + bounds.height / 2
        ? anchor.top - height - 10
        : anchor.bottom + 10;
    panel.style.left = `${Math.max(bounds.left + 12, Math.min(left, bounds.right - width - 12))}px`;
    panel.style.top = `${Math.max(bounds.top + 12, Math.min(top, bounds.bottom - height - 12))}px`;
    panel.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }
  function contextMenu(label: string, point: Point) {
    const panel = popover(undefined, label)!;
    // A native auto popover dismisses on the right-button release that opened it.
    panel.popover = 'manual';
    panel.classList.add('ad-context-menu');
    panel.setAttribute('role', 'menu');
    panel.tabIndex = -1;
    const add = (label: string, glyph: string, action: () => void, disabled = false) => {
      const option = textButton(
        label,
        () => {
          closePopover();
          board.focus();
          action();
        },
        'ad-tool-option',
      );
      option.insertAdjacentHTML('afterbegin', icon(glyph));
      option.setAttribute('role', 'menuitem');
      option.disabled = board.readonly || disabled;
      if (glyph === 'trash') option.classList.add('ad-danger');
      panel.append(option);
    };
    const show = () => {
      panel.showPopover();
      const bounds = board.stage.root.getBoundingClientRect();
      const width = Math.min(228, bounds.width - 24);
      panel.style.width = `${width}px`;
      const height = panel.getBoundingClientRect().height;
      panel.style.left = `${Math.max(bounds.left + 12, Math.min(point.x, bounds.right - width - 12))}px`;
      panel.style.top = `${Math.max(bounds.top + 12, Math.min(point.y, bounds.bottom - height - 12))}px`;
      (panel.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? panel).focus();
    };
    return { panel, add, show };
  }
  const hideOnResize = () => closePopover();
  const dismissContext = (event: PointerEvent) => {
    if (activePopover?.popover === 'manual' && !activePopover.contains(event.target as Node))
      closePopover();
  };
  window.addEventListener('resize', hideOnResize);
  window.addEventListener('pointerdown', dismissContext, true);
  unsubs.push(() => {
    window.removeEventListener('resize', hideOnResize);
    window.removeEventListener('pointerdown', dismissContext, true);
  });
  const showMenu = options.menu !== false;
  const formats = exportFormats(options.export);
  const header = el('header', 'ad-header');
  let brand: HTMLButtonElement | undefined;
  let drawingInput: HTMLInputElement | undefined;
  let exportButton: HTMLButtonElement | undefined;
  if (showMenu) {
    brand = button('Board menu', 'chevron', openMenu, 'ad-brand');
    brand.innerHTML =
      '<span class="ad-brand-mark" aria-hidden="true"><svg viewBox="0 0 40 40"><path d="M9 29 20 8l11 21M14 22h12" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="32" cy="9" r="2.5" fill="currentColor"/></svg></span><span class="ad-brand-name">AnnieDrawing</span>' +
      icon('chevron');
    brand.setAttribute('aria-haspopup', 'true');
    brand.setAttribute('aria-expanded', 'false');
    drawingInput = el('input');
    drawingInput.type = 'file';
    drawingInput.accept = '.annie,.json,application/json';
    drawingInput.hidden = true;
    drawingInput.onchange = () => {
      const file = drawingInput?.files?.[0];
      if (drawingInput) drawingInput.value = '';
      if (file)
        void file
          .text()
          .then((value) => board.load(JSON.parse(value)))
          .catch(() => undefined);
    };
    header.append(brand);
  }
  if (formats.length) {
    const actions = el('div', 'ad-header-actions');
    exportButton = textButton('Export', openExport, 'ad-button ad-primary');
    exportButton.insertAdjacentHTML('afterbegin', icon('download'));
    if (formats.length > 1) {
      exportButton.setAttribute('aria-haspopup', 'true');
      exportButton.setAttribute('aria-expanded', 'false');
    }
    actions.append(exportButton);
    header.append(actions);
  }
  if (!showMenu) header.classList.add('ad-header-end');
  if (showMenu || formats.length) ui.append(header);
  if (drawingInput) ui.append(drawingInput);
  const toolbar = el('nav', 'ad-toolbar');
  toolbar.setAttribute('aria-label', 'Drawing tools');
  function toolButton(id: string, expanded = false) {
    const [, label, key] = tools.find((tool) => tool[0] === id)!;
    const b = button(
      label,
      id,
      () => {
        closePopover();
        board.setTool(id);
        board.focus();
      },
      expanded ? 'ad-tool-option' : 'ad-icon-button',
    );
    b.dataset.tool = id;
    b.setAttribute('aria-keyshortcuts', key);
    b.setAttribute('aria-pressed', String(board.tool === id));
    b.innerHTML += expanded ? `<span>${label}</span>` : `<span class="ad-tooltip">${label}</span>`;
    if (board.readonly && id !== 'hand' && id !== 'select') b.disabled = true;
    return b;
  }
  const shapeKinds = ['rect', 'ellipse', 'diamond', 'line', 'connector'];
  const shapeButton = button('Shapes', 'shapes', () => {
    const panel = popover(shapeButton, 'Shapes');
    if (!panel) return;
    panel.classList.add('ad-tool-options');
    panel.append(...shapeKinds.map((id) => toolButton(id, true)));
    showPopover(panel, shapeButton);
  });
  shapeButton.setAttribute('aria-haspopup', 'true');
  shapeButton.setAttribute('aria-expanded', 'false');
  shapeButton.innerHTML +=
    '<span class="ad-tool-corner"></span><span class="ad-tooltip">Shapes</span>';
  const imageInput = el('input');
  imageInput.type = 'file';
  imageInput.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
  imageInput.hidden = true;
  imageInput.onchange = () => {
    if (imageInput.files?.[0]) void board.addImage(imageInput.files[0]).catch(() => undefined);
    imageInput.value = '';
  };
  const imageButton = button('Add image', 'image', () => {
    closePopover();
    imageInput.click();
  });
  imageButton.innerHTML += '<span class="ad-tooltip">Add image</span>';
  imageButton.disabled = board.readonly;
  const hand = toolButton('hand');
  if (showMenu) hand.classList.add('ad-desktop-tool');
  toolbar.append(
    toolButton('select'),
    hand,
    toolButton('eraser'),
    el('div', 'ad-toolbar-divider'),
    shapeButton,
    toolButton('path'),
    toolButton('text'),
    toolButton('note'),
    imageButton,
    imageInput,
  );
  ui.append(toolbar);
  const styleDock = el('aside', 'ad-style-dock');
  styleDock.setAttribute('aria-label', 'Selection style');
  styleDock.hidden = true;
  const stylePanel = el('div', 'ad-style-panel');
  const deselect = button('Deselect', 'chevron', () => board.select([]));
  deselect.classList.add('ad-style-dismiss');
  styleDock.append(deselect, stylePanel);
  ui.append(styleDock);
  const footer = el('footer', 'ad-footer');
  const undo = button('Undo', 'undo', () => board.undo()),
    redo = button('Redo', 'redo', () => board.redo());
  undo.setAttribute('aria-keyshortcuts', 'Meta+Z Control+Z');
  redo.setAttribute('aria-keyshortcuts', 'Meta+Shift+Z Control+Shift+Z');
  const pagesBar = el('nav', 'ad-pages');
  pagesBar.setAttribute('aria-label', 'Pages');
  const pageTabs = el('div', 'ad-page-tabs');
  pageTabs.setAttribute('role', 'tablist');
  pageTabs.setAttribute('aria-label', 'Pages');
  const overflow = button('All pages', 'more', openPages);
  overflow.setAttribute('aria-haspopup', 'true');
  overflow.setAttribute('aria-expanded', 'false');
  overflow.hidden = true;
  const newPage = button('Add page', 'plus', addPage);
  newPage.disabled = board.readonly;
  pagesBar.append(pageTabs, overflow, newPage);
  let pageState = '';
  function pageContext(id: string, name: string, point: Point) {
    const menu = contextMenu('Page actions', point);
    menu.add('Rename page', 'text', () => renamePage(id, name));
    menu.add(
      'Delete page',
      'trash',
      () => {
        board.apply([{ op: 'page.remove', id }], { origin: 'user', label: 'Delete page' });
      },
      board.read().pages.length === 1,
    );
    menu.show();
  }
  function pageButton(id: string, name: string, tab = false) {
    const pick = textButton(
      name,
      () => {
        closePopover();
        board.setPage(id);
        pageTabs.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
      },
      tab ? 'ad-page-tab' : 'ad-tool-option',
    );
    pick.title = name;
    pick.dataset.pageId = id;
    let held = false;
    let start: Point;
    pick.addEventListener('pointerdown', (event) => {
      held = false;
      if (event.pointerType !== 'touch') return;
      start = { x: event.clientX, y: event.clientY };
      clearTimeout(pagePressTimer);
      pagePressTimer = setTimeout(() => {
        held = true;
        pageContext(id, name, start);
      }, 500);
    });
    pick.addEventListener('pointermove', (event) => {
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10)
        clearTimeout(pagePressTimer);
    });
    for (const type of ['pointerup', 'pointercancel'])
      pick.addEventListener(type, () => clearTimeout(pagePressTimer));
    pick.addEventListener(
      'click',
      (event) => {
        if (held) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
    if (tab) {
      pick.setAttribute('role', 'tab');
      pick.setAttribute('aria-selected', String(board.pageId === id));
      pick.tabIndex = board.pageId === id ? 0 : -1;
    } else pick.setAttribute('aria-current', String(board.pageId === id));
    pick.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      pageContext(id, name, { x: event.clientX, y: event.clientY });
    });
    pick.addEventListener('keydown', (event) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        const bounds = pick.getBoundingClientRect();
        pageContext(id, name, { x: bounds.left, y: bounds.top });
      } else if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const pages = board.read().pages;
        const index = pages.findIndex((page) => page.id === id);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? pages.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + pages.length) % pages.length;
        closePopover();
        board.setPage(pages[next].id);
        pageTabs.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
      }
    });
    return pick;
  }
  function fitPageTabs() {
    const tabs = [...pageTabs.querySelectorAll<HTMLButtonElement>('button')];
    tabs.forEach((tab) => {
      tab.hidden = false;
      tab.style.maxWidth = '';
    });
    overflow.hidden = true;
    const widths = tabs.map((tab) => tab.getBoundingClientRect().width);
    const needed = widths.reduce((sum, width) => sum + width + 4, 0) + newPage.offsetWidth + 14;
    const room =
      pagesBar.offsetTop === footerRight.offsetTop
        ? footer.clientWidth - footerRight.offsetWidth - 16
        : pagesBar.clientWidth;
    const cap = Math.min(room, 520);
    if (needed <= cap) return;
    const available = cap - newPage.offsetWidth - 14;
    overflow.hidden = false;
    let remaining = Math.max(40, available - overflow.offsetWidth - 4);
    const selected = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    for (const index of [
      selected,
      ...tabs.map((_, index) => index).filter((index) => index !== selected),
    ]) {
      if (index < 0) continue;
      const tab = tabs[index];
      if (index === selected) {
        tab.style.maxWidth = `${remaining}px`;
        remaining -= Math.min(remaining, widths[index]) + 4;
      } else {
        tab.hidden = widths[index] > remaining;
        if (!tab.hidden) remaining -= widths[index] + 4;
      }
    }
  }
  function renderPages() {
    if (options.pages === false) return;
    const pages = board.read().pages;
    const state = JSON.stringify([board.pageId, pages.map(({ id, name }) => [id, name])]);
    if (state === pageState) return;
    pageState = state;
    pageTabs.replaceChildren(...pages.map((page) => pageButton(page.id, page.name, true)));
    fitPageTabs();
  }
  const pagesObserver = new ResizeObserver(fitPageTabs);
  if (options.pages !== false) {
    pagesObserver.observe(pagesBar);
    unsubs.push(() => pagesObserver.disconnect());
  }
  function addPage() {
    closePopover();
    const id = pageId();
    const pages = board.read().pages;
    let number = pages.length + 1;
    while (pages.some((page) => page.name === `Page ${number}`)) number++;
    const result = board.apply(
      [{ op: 'page.add', page: { id, name: `Page ${number}`, items: [] } }],
      { origin: 'user', label: 'Add page' },
    );
    if (result.ok) board.setPage(id);
  }
  function openPages() {
    const panel = popover(overflow, 'All pages');
    if (!panel) return;
    panel.classList.add('ad-pages-popover');
    for (const page of board.read().pages) {
      const row = el('div', 'ad-page-row');
      row.append(pageButton(page.id, page.name));
      const actions = button(`Actions for ${page.name}`, 'more', () => {
        const bounds = actions.getBoundingClientRect();
        pageContext(page.id, page.name, { x: bounds.left, y: bounds.top });
      });
      row.append(actions);
      panel.append(row);
    }
    showPopover(panel, overflow);
    panel.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  const footerRight = el('div', 'ad-footer-right');
  const zoom = el('div', 'ad-zoom');
  const percentage = textButton(
    '100%',
    () => {
      const panel = popover(percentage, 'Zoom controls');
      if (!panel) return;
      const row = el('div', 'ad-zoom-controls');
      row.append(
        button('Zoom out', 'minus', () => (board.view.zoom /= 1.2)),
        textButton('100%', () => (board.view.zoom = 1), 'ad-zoom-value'),
        button('Zoom in', 'plus', () => (board.view.zoom *= 1.2)),
      );
      panel.append(row);
      showPopover(panel, percentage, fitButton);
    },
    'ad-zoom-value',
  );
  percentage.setAttribute('aria-label', 'Zoom controls');
  percentage.setAttribute('aria-haspopup', 'true');
  percentage.setAttribute('aria-expanded', 'false');
  const fitButton = button('Fit drawing', 'fit', () => board.view.fit());
  zoom.append(percentage, fitButton, undo, redo);
  footerRight.append(zoom);
  if (options.pages === false) footer.append(footerRight);
  else footer.append(pagesBar, footerRight);
  ui.append(footer);
  function renamePage(id: string, name: string) {
    if (board.readonly) return;
    const d = dialog('Name this page');
    const input = el('input');
    input.value = name;
    input.maxLength = 100;
    d.append(
      field('Page name', input),
      textButton(
        'Save name',
        () => {
          if (input.value.trim())
            board.apply([{ op: 'page.set', id, patch: { name: input.value.trim() } }], {
              origin: 'user',
              label: 'Rename page',
            });
          d.close();
        },
        'ad-button ad-primary',
      ),
    );
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') d.querySelector<HTMLButtonElement>('.ad-primary')?.click();
    });
    d.addEventListener(
      'close',
      () => {
        const tab = pageTabs.querySelector<HTMLButtonElement>(`[data-page-id="${CSS.escape(id)}"]`);
        if (tab && !tab.hidden) tab.focus();
        else if (!overflow.hidden) overflow.focus();
      },
      { once: true },
    );
    input.focus();
    input.select();
  }
  let styleSelection = '';
  function renderStyle() {
    const locked = board.selection.some((id) => board.isLocked(id));
    if (board.tool !== 'select') {
      if (popoverTrigger && styleDock.contains(popoverTrigger)) closePopover();
      styleDock.hidden = true;
      return;
    }
    if (
      activeDialog ||
      (!locked &&
        document.activeElement instanceof HTMLInputElement &&
        document.activeElement.type === 'range' &&
        (styleDock.contains(document.activeElement) ||
          activePopover?.contains(document.activeElement)))
    )
      return;
    const focused = styleDock.contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : undefined;
    const stylePopup =
      popoverTrigger && styleDock.contains(popoverTrigger)
        ? {
            label: popoverTrigger.getAttribute('aria-label'),
            focused: activePopover?.contains(document.activeElement),
          }
        : undefined;
    const focusLabel =
      focused?.getAttribute('aria-label') ?? (stylePopup?.focused ? stylePopup.label : undefined);
    const focusField = focused?.closest('label')?.querySelector('.ad-field-label')?.textContent;
    if (stylePopup) closePopover();
    const items = board.selection.map((id) => board.get(id)!).filter(Boolean);
    const selectedKey = items.map((item) => item.id).join(',');
    if (styleSelection !== selectedKey) {
      closePopover();
    }
    styleSelection = selectedKey;
    stylePanel.replaceChildren();
    styleDock.hidden = items.length === 0;
    if (!items.length) {
      if (stylePopup?.focused) board.focus();
      return;
    }
    const item = items[0],
      single = items.length === 1;
    const fillable = items.every((i) => ['rect', 'ellipse', 'diamond', 'note'].includes(i.kind));
    const stroked = items.every(
      (i) => !['image', 'html', 'video', 'link', 'group', 'text', 'note'].includes(i.kind),
    );
    const textOnly = items.every((i) => i.kind === 'text');
    const hasText = items.every(
      (i) => !['image', 'path', 'line', 'group', 'html', 'video', 'link'].includes(i.kind),
    );
    const colorControls = el('div', 'ad-color-controls');
    function colorControl(label: string, key: 'fill' | 'stroke') {
      const current =
        item.style?.[key] ?? (key === 'fill' ? (item.kind === 'note' ? 'moss' : 'none') : 'ink');
      const trigger = textButton(
        label,
        () => {
          const panel = popover(trigger, `${label} color`);
          if (!panel) return;
          panel.classList.add('ad-color-popover');
          for (const [token, name] of palette) {
            const b = el('button', `ad-swatch ${token === 'none' ? 'ad-swatch-none' : ''}`);
            b.type = 'button';
            b.style.setProperty('--swatch', resolveColor(token, board.stage.resolvedTheme));
            b.setAttribute('aria-label', `${label}: ${name}`);
            b.title = name;
            b.setAttribute('aria-pressed', String(current === token));
            b.onclick = () => {
              closePopover();
              board.defaultStyle[key] = token;
              board.updateSelection({ style: { [key]: token } });
              stylePanel.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.focus();
            };
            panel.append(b);
          }
          showPopover(panel, trigger);
        },
        'ad-color-control',
      );
      trigger.setAttribute('aria-label', label);
      trigger.setAttribute('aria-haspopup', 'true');
      trigger.setAttribute('aria-expanded', 'false');
      const swatch = el('span', `ad-color-preview ${current === 'none' ? 'ad-swatch-none' : ''}`);
      swatch.style.setProperty('--swatch', resolveColor(current, board.stage.resolvedTheme));
      trigger.prepend(swatch);
      colorControls.append(trigger);
    }
    if (fillable) colorControl('Fill', 'fill');
    if (stroked) colorControl('Line', 'stroke');
    if (textOnly) colorControl('Color', 'stroke');
    const opacityButton = textButton(
      'Opacity',
      () => {
        const panel = popover(opacityButton, 'Opacity controls');
        if (!panel) return;
        panel.classList.add('ad-opacity-popover');
        const input = el('input');
        input.type = 'range';
        input.setAttribute('aria-label', 'Opacity');
        input.min = '0';
        input.max = '100';
        input.value = String(Math.round((board.get(item.id)?.style?.opacity ?? 1) * 100));
        const value = el('output', '', `${input.value}%`);
        const label = field('Opacity', input);
        label.querySelector('.ad-field-label')!.append(value);
        let first = true;
        input.oninput = () => {
          value.textContent = `${input.value}%`;
          board.apply(
            items.map(({ id }) => ({
              op: 'set',
              id,
              patch: { style: { opacity: Number(input.value) / 100 } },
            })),
            { origin: 'user', label: 'Change opacity', merge: !first },
          );
          first = false;
        };
        input.onchange = () => {
          first = true;
        };
        panel.append(label);
        showPopover(panel, opacityButton);
        input.focus();
      },
      'ad-color-control',
    );
    opacityButton.insertAdjacentHTML('afterbegin', icon('opacity'));
    opacityButton.setAttribute('aria-label', 'Opacity');
    opacityButton.setAttribute('aria-haspopup', 'true');
    opacityButton.setAttribute('aria-expanded', 'false');
    if (items.every((item) => item.kind !== 'group')) colorControls.append(opacityButton);
    if (colorControls.childElementCount) stylePanel.append(colorControls);
    const updateText = (patch: Partial<NonNullable<Item['text']>>) =>
      board.apply(
        items.map((item) => ({
          op: 'set',
          id: item.id,
          patch: { text: { value: item.text?.value ?? '', ...patch } },
        })),
        { origin: 'user', label: 'Text style' },
      );
    function styleRow(label: string) {
      const row = el('div', 'ad-style-row');
      const group = el('div', 'ad-segments');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', label);
      row.append(el('span', 'ad-style-label', label), group);
      stylePanel.append(row);
      return group;
    }
    function choices(
      group: HTMLElement,
      values: [string, string, string][],
      current: (item: Item) => string,
      change: (value: string) => void,
    ) {
      return values.map(([value, label, content]) => {
        const b = textButton(label, () => change(value), 'ad-segment');
        b.setAttribute('aria-label', label);
        b.title = label;
        b.setAttribute('aria-pressed', String(items.every((item) => current(item) === value)));
        b.innerHTML = content;
        group.append(b);
        return b;
      });
    }
    function lineIcon(width: number, dash = '') {
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h18" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/></svg>`;
    }
    if (hasText) {
      choices(
        styleRow('Text'),
        [
          ['s', 'Text size: Small', 'S'],
          ['m', 'Text size: Medium', 'M'],
          ['l', 'Text size: Large', 'L'],
          ['xl', 'Text size: Extra large', 'XL'],
        ],
        (item) => ({ 14: 's', 18: 'm', 26: 'l', 36: 'xl' })[fontSize(item.text)] ?? '',
        (value) => updateText({ size: value as 'm' }),
      );
      choices(
        styleRow('Align'),
        [
          ['start', 'Align text left', icon('alignLeft')],
          ['center', 'Align text center', icon('alignCenter')],
          ['end', 'Align text right', icon('alignRight')],
        ],
        (item) => item.text?.align ?? (item.kind === 'text' ? 'start' : 'center'),
        (value) => updateText({ align: value as 'start' }),
      );
      const fontChoices: [keyof typeof fonts, string, string][] = [
        ['sans', 'Font: Friendly', 'Aa'],
        ['serif', 'Font: Serif', 'Aa'],
        ['mono', 'Font: Mono', 'Aa'],
        ['hand', 'Font: Handwritten', 'Aa'],
      ];
      choices(
        styleRow('Font'),
        fontChoices,
        (item) => item.text?.font ?? DEFAULT_FONT,
        (value) => updateText({ font: value as 'sans' }),
      ).forEach((button, index) => {
        button.style.fontFamily = fonts[fontChoices[index][0]];
      });
    }
    if (stroked) {
      choices(
        styleRow('Line'),
        [
          ['1', 'Line: Fine', lineIcon(1)],
          ['2', 'Line: Regular', lineIcon(2)],
          ['4', 'Line: Bold', lineIcon(4)],
          ['8', 'Line: Extra bold', lineIcon(6)],
        ],
        (item) => String(styleFor(item, board.stage.resolvedTheme).strokeWidth),
        (value) => board.updateSelection({ style: { strokeWidth: Number(value) } }),
      );
      if (items.every((item) => item.kind !== 'path' || item.closed)) {
        choices(
          styleRow('Pattern'),
          [
            ['solid', 'Pattern: Solid', lineIcon(2)],
            ['dashed', 'Pattern: Dashed', lineIcon(2, '5 4')],
            ['dotted', 'Pattern: Dotted', lineIcon(2, '1 5')],
          ],
          (item) => item.style?.dash ?? 'solid',
          (value) => board.updateSelection({ style: { dash: value as 'solid' } }),
        );
      }
    }
    if (single && item.kind === 'connector')
      stylePanel.append(
        field(
          'Route',
          select(
            [
              ['straight', 'Straight'],
              ['elbow', 'Elbow'],
              ['curve', 'Curve'],
            ],
            item.route ?? 'elbow',
            (v) => board.updateSelection({ route: v as 'elbow' }),
          ),
        ),
      );
    if (single && item.kind === 'connector')
      stylePanel.append(
        field(
          'Arrowhead',
          select(
            [
              ['arrow', 'Arrow'],
              ['dot', 'Dot'],
              ['none', 'None'],
            ],
            item.heads?.end ?? 'arrow',
            (value) => board.updateSelection({ heads: { ...item.heads, end: value as 'arrow' } }),
          ),
        ),
      );
    const lock = button(
      locked ? 'Unlock selection' : 'Lock selection',
      locked ? 'lock' : 'unlock',
      () => board.updateSelection({ locked: !locked }),
    );
    lock.setAttribute('aria-pressed', String(locked));
    const row = el('div', 'ad-selection-actions');
    row.append(
      button('Duplicate selection', 'copy', () => board.duplicate()),
      button('More arrangement options', 'align', openArrange),
      lock,
      button('Delete selection', 'trash', () => board.deleteSelection()),
    );
    stylePanel.append(row);
    if (board.readonly || locked)
      stylePanel
        .querySelectorAll('button,input,select')
        .forEach(
          (e) =>
            ((e as HTMLButtonElement).disabled = e !== deselect && (e !== lock || board.readonly)),
        );
    if (focusLabel === 'Unlock selection' || focusLabel === 'Lock selection') lock.focus();
    else if (focusLabel === 'Deselect') deselect.focus();
    else if (focusLabel)
      stylePanel.querySelector<HTMLElement>(`[aria-label="${CSS.escape(focusLabel)}"]`)?.focus();
    else if (focusField)
      [...stylePanel.querySelectorAll('label')]
        .find((label) => label.querySelector('.ad-field-label')?.textContent === focusField)
        ?.querySelector<HTMLElement>('input,select')
        ?.focus();
    if (focused || stylePopup?.focused)
      if (locked && !board.readonly && !styleDock.contains(document.activeElement)) lock.focus();
  }
  function openArrange() {
    const d = dialog('Give it a little order');
    const actions = el('div', 'ad-action-grid');
    const item = board.selection.length === 1 ? board.get(board.selection[0]) : undefined;
    if (item) {
      actions.append(
        textButton('Duplicate', () => {
          board.duplicate();
          d.close();
        }),
        textButton('Delete', () => {
          board.deleteSelection();
          d.close();
        }),
      );
    }
    if (board.selection.length > 1)
      for (const mode of [
        'left',
        'center',
        'right',
        'top',
        'middle',
        'bottom',
        'horizontal',
        'vertical',
      ] as const)
        actions.append(
          textButton(
            mode === 'horizontal' || mode === 'vertical' ? `Distribute ${mode}` : `Align ${mode}`,
            () => {
              board.align(mode);
              d.close();
            },
          ),
        );
    if (board.selection.length > 1)
      actions.append(
        textButton('Group', () => {
          board.group();
          d.close();
        }),
      );
    if (board.selection.some((id) => board.get(id)?.kind === 'group'))
      actions.append(
        textButton('Ungroup', () => {
          board.ungroup();
          d.close();
        }),
      );
    actions.append(
      textButton('Bring to front', () => {
        board.apply(
          board.selection.map((id) => ({ op: 'order', id, to: 'front' })),
          { origin: 'user', label: 'Bring to front' },
        );
        d.close();
      }),
      textButton('Send to back', () => {
        board.apply(
          board.selection.map((id) => ({ op: 'order', id, to: 'back' })),
          { origin: 'user', label: 'Send to back' },
        );
        d.close();
      }),
    );
    if (board.readonly)
      actions.querySelectorAll('button').forEach((action) => (action.disabled = true));
    d.append(actions);
  }
  function saveExport(format: UiExportFormat) {
    void board
      .export(format, {
        scope: 'page',
        padding: 40,
        background: true,
        ...(format === 'png' ? { scale: 2 } : {}),
      })
      .then((content) => {
        const name =
          board
            .read()
            .meta.title.replace(/[^a-z0-9 _-]/gi, '')
            .trim() || 'drawing';
        download(
          content,
          `${name}.${format === 'json' ? 'annie' : format}`,
          format === 'json' ? ANNIE_MIME : format === 'svg' ? 'image/svg+xml' : 'image/png',
        );
      })
      .catch(() => undefined);
  }
  function openExport() {
    if (formats.length === 1) {
      saveExport(formats[0]);
      return;
    }
    if (!exportButton) return;
    const panel = popover(exportButton, 'Export');
    if (!panel) return;
    panel.classList.add('ad-tool-options');
    const choices: Record<UiExportFormat, [string, string]> = {
      png: ['PNG Image', 'image'],
      svg: ['SVG Image', 'image'],
      json: ['AnnieDoc format', 'code'],
    };
    for (const format of formats) {
      const [label, glyph] = choices[format];
      const option = button(
        label,
        glyph,
        () => {
          closePopover();
          saveExport(format);
        },
        'ad-tool-option',
      );
      option.innerHTML += `<span>${label}</span>`;
      panel.append(option);
    }
    showPopover(panel, exportButton);
  }
  function openMenu() {
    if (!brand) return;
    const panel = popover(brand, 'Board menu');
    if (!panel) return;
    panel.classList.add('ad-tool-options');
    const add = (label: string, glyph: string, action: () => void, disabled = false) => {
      const option = button(
        label,
        glyph,
        () => {
          closePopover();
          action();
        },
        'ad-tool-option',
      );
      option.innerHTML += `<span>${label}</span>`;
      option.disabled = disabled;
      panel.append(option);
    };
    add('Open a drawing', 'upload', () => drawingInput?.click(), board.readonly);
    if (phoneChrome(board.stage.root.clientWidth, board.stage.root.clientHeight)) {
      add('Hand', 'hand', () => {
        board.setTool('hand');
        board.focus();
      });
    }
    add(board.grid ? 'Hide grid' : 'Show grid', 'grid', () => board.setGrid(!board.grid));
    const dark = board.stage.resolvedTheme === 'dark';
    add(dark ? 'Light appearance' : 'Dark appearance', dark ? 'sun' : 'moon', () =>
      board.setTheme(dark ? 'light' : 'dark'),
    );
    add('Documentation', 'book', () => {
      window.open('./docs/index.html', '_blank', 'noopener');
    });
    showPopover(panel, brand);
  }
  function refresh() {
    undo.disabled = !board.canUndo;
    redo.disabled = !board.canRedo;
    renderPages();
    renderStyle();
  }
  const context = (event: Event) => {
    const { x, y, id } = (event as CustomEvent<Point & { id?: string }>).detail;
    const item = id ? board.get(id) : undefined;
    if (!item) {
      closePopover();
      return;
    }
    const bounds = board.stage.root.getBoundingClientRect();
    const menu = contextMenu('Element actions', { x: bounds.left + x, y: bounds.top + y });
    const locked = board.isLocked(item.id);
    if (!['image', 'path', 'line', 'group', 'html', 'video', 'link'].includes(item.kind))
      menu.add('Edit text', 'text', () => board.editText(item.id), locked);
    const order = (to: 'front' | 'back') =>
      board.apply([{ op: 'order', id: item.id, to }], {
        origin: 'user',
        label: to === 'front' ? 'Bring to front' : 'Send to back',
      });
    menu.add('Bring to front', 'front', () => order('front'), locked);
    menu.add('Send to back', 'back', () => order('back'), locked);
    menu.add(
      'Duplicate',
      'copy',
      () => {
        board.select([item.id]);
        board.duplicate();
      },
      locked,
    );
    const separator = el('div', 'ad-menu-separator');
    separator.setAttribute('role', 'separator');
    menu.panel.append(separator);
    menu.add(
      'Delete',
      'trash',
      () => {
        board.select([item.id]);
        board.deleteSelection();
      },
      locked,
    );
    menu.show();
  };
  board.host.addEventListener('ad-context', context);
  unsubs.push(
    board.on('change', refresh),
    board.on('select', () => {
      renderStyle();
    }),
    board.on('page', refresh),
    board.on('view', (state) => {
      if (activePopover?.popover === 'manual') closePopover();
      percentage.textContent = `${Math.round(state.zoom * 100)}%`;
    }),
    board.on('tool', (id) => {
      for (const b of ui.querySelectorAll<HTMLElement>('[data-tool]'))
        b.setAttribute('aria-pressed', String(id === b.dataset.tool));
      shapeButton.setAttribute('aria-pressed', String(shapeKinds.includes(id)));
      board.stage.root.dataset.adTool = id;
      renderStyle();
    }),
  );
  refresh();
  return () => {
    clearTimeout(pagePressTimer);
    closePopover();
    unsubs.forEach((fn) => fn());
    activeDialog?.close();
    board.host.removeEventListener('ad-context', context);
    ui.remove();
  };
}
