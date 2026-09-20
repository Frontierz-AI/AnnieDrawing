import '@fontsource-variable/nunito';
import '../src/style.css';
import './style.css';
import { parseLinkPreview, unfurlPage } from '../src/core/paste';
import { createBoard } from '../src/index';

const board = createBoard(document.querySelector<HTMLElement>('#app')!, {
  autosaveKey: 'annie-playground-v2',
  theme: 'light',
  exposeGlobal: true,
  ui: { export: ['png', 'svg', 'json'] }, // demo offers AnnieDoc; library default is PNG and SVG
  unfurl: async (url) => {
    try {
      const response = await fetch(`/__ad-unfurl?url=${encodeURIComponent(url)}`);
      if (response.status === 200) {
        const html = await response.text();
        if (html) return parseLinkPreview(html, response.headers.get('x-unfurl-url') || url);
      }
    } catch {
      /* Fall through to a same-origin browser fetch. */
    }
    return unfurlPage(url);
  },
});
await board.ready;

function resetView() {
  board.view.zoom = 1;
  board.view.center = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

const params = new URLSearchParams(location.search);
if (params.has('blank') || params.has('benchmark')) {
  board.clear();
  resetView();
} else if (board.read().pages.every((page) => !page.items.length)) {
  resetView();
} else {
  board.view.fit();
}
