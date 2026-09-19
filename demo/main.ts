import '@fontsource-variable/nunito';
import '../src/style.css';
import { createBoard } from '../src/index';

const board = createBoard(document.querySelector<HTMLElement>('#app')!, {
  autosaveKey: 'annie-playground-v2',
  theme: 'light',
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
