import type { Board } from '../board';
import type { AnnieDoc } from '../core/types';
export async function openAutosave(board: Board, key: string): Promise<void> {
  let db: IDBDatabase | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    stopped = false;
  let unsubscribe = () => {};
  const initial = JSON.stringify(board.read());
  const report = (status: 'saving' | 'saved' | 'error', message?: string) => {
    if (!stopped) board.emit('save', { status, message });
  };
  const save = () => {
    if (stopped || !db) return;
    try {
      report('saving');
      const tx = db.transaction('boards', 'readwrite');
      tx.objectStore('boards').put(board.read(), key);
      tx.oncomplete = () => report('saved');
      tx.onerror = () => report('error', 'Could not save locally. Export your drawing to keep it.');
    } catch {
      report('error', 'Could not save locally. Export your drawing to keep it.');
    }
  };
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
      save();
    }
  };
  board.addCleanup(() => {
    flush();
    stopped = true;
    unsubscribe();
    window.removeEventListener('pagehide', flush);
    db?.close();
  });
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('anniedrawing', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('boards');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (stopped) {
      db.close();
      return;
    }
    const saved = await new Promise<AnnieDoc | undefined>((resolve, reject) => {
      const request = db!.transaction('boards', 'readonly').objectStore('boards').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (stopped) {
      db.close();
      return;
    }
    if (saved && JSON.stringify(board.read()) === initial) board.load(saved);
    report('saved');
  } catch {
    report('error', 'Browser storage is unavailable. Export your drawing to keep it.');
    return;
  }
  unsubscribe = board.on('change', () => {
    report('saving');
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      save();
    }, 300);
  });
  window.addEventListener('pagehide', flush);
}
