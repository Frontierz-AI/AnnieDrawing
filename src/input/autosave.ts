import type { Board } from '../board';
import type { AnnieDoc } from '../core/types';

/**
 * Autosave status. `conflict` means the stored drawing changed somewhere else (another tab, or a
 * save found after local edits began). Nothing is overwritten until `resolve` picks a version.
 */
export interface SaveEvent {
  status: 'saving' | 'saved' | 'error' | 'conflict';
  message?: string;
  /** Present on `conflict`: `'load'` opens the stored drawing, `'keep'` saves this one over it. */
  resolve?: (choice: 'load' | 'keep') => void;
}

const STORE = 'boards';
const FAILED = 'Could not save locally. Export your drawing to keep it.';
const FULL = 'Browser storage is full. Export your drawing to keep it.';
const OTHER_TAB = 'This drawing changed in another tab.';
const FOUND_LATE = 'A saved drawing loaded after you started editing.';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

export async function openAutosave(board: Board, key: string): Promise<void> {
  // The drawing stays at `key` in the format earlier versions wrote. The stamp names the save it
  // came from, so a tab can tell whether the stored drawing is still the one it last read or wrote.
  const stampKey = `${key}#stamp`;
  const tab = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  let db: IDBDatabase | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    channel: BroadcastChannel | undefined,
    stopped = false,
    /** Stamp of the stored save this document derives from. */
    known: string | undefined,
    saves = 0,
    /** Local edits the store does not have yet. */
    dirty = false,
    conflict: SaveEvent | undefined,
    /** A stored drawing is being loaded; its change event is not a local edit. */
    following = false;
  let unsubscribe = () => {};
  const initial = JSON.stringify(board.read());
  const report = (event: SaveEvent) => {
    if (!stopped) board.emit('save', event);
  };
  const readStored = async () => {
    const tx = db!.transaction(STORE, 'readonly');
    const [doc, stamp] = await Promise.all([
      request<AnnieDoc | undefined>(tx.objectStore(STORE).get(key)),
      request<string | undefined>(tx.objectStore(STORE).get(stampKey)),
    ]);
    return { doc, stamp };
  };
  /** Load the stored drawing. Following another tab keeps this tab's camera and page. */
  const follow = (doc: AnnieDoc, stamp: string | undefined, keepView = true) => {
    const camera = board.stage.lens.state,
      page = board.pageId;
    following = true;
    try {
      board.load(doc);
    } finally {
      following = false;
    }
    if (keepView) {
      board.stage.lens.set(camera);
      if (board.read().pages.some((entry) => entry.id === page)) board.setPage(page);
    }
    known = stamp;
    dirty = false;
  };
  const raise = (message: string) => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    conflict = { status: 'conflict', message, resolve };
    report(conflict);
  };
  function resolve(choice: 'load' | 'keep') {
    if (stopped || !db || !conflict) return;
    void readStored()
      .then(({ doc, stamp }) => {
        conflict = undefined;
        if (choice === 'load' && doc) {
          follow(doc, stamp);
          report({ status: 'saved' });
        } else {
          known = stamp;
          dirty = true;
          save();
        }
      })
      .catch(() => report({ status: 'error', message: FAILED }));
  }
  const save = () => {
    if (stopped || !db || conflict || !dirty) return;
    try {
      report({ status: 'saving' });
      const tx = db.transaction(STORE, 'readwrite'),
        store = tx.objectStore(STORE),
        stamp = `${tab}:${++saves}`;
      let written = false;
      // One readwrite transaction: the stamp check and the write cannot interleave with another tab.
      store.get(stampKey).onsuccess = (event) => {
        const stored = (event.target as IDBRequest<string | undefined>).result;
        if (stored !== known) return;
        try {
          store.put(board.read(), key);
          store.put(stamp, stampKey);
          written = true;
        } catch {
          // A put that throws (an unclonable value, an inactive transaction) ends the save as an error.
          written = false;
          try {
            tx.abort();
          } catch {
            /* Already finished; onabort or oncomplete reports it. */
          }
        }
      };
      tx.oncomplete = () => {
        if (!written) {
          raise(OTHER_TAB);
          return;
        }
        known = stamp;
        dirty = !!timer;
        channel?.postMessage({ key, stamp });
        report({ status: 'saved' });
      };
      tx.onabort = () =>
        report({
          status: 'error',
          message: tx.error?.name === 'QuotaExceededError' ? FULL : FAILED,
        });
    } catch {
      report({ status: 'error', message: FAILED });
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
    channel?.close();
    db?.close();
  });
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('anniedrawing', 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    if (stopped) {
      db.close();
      return;
    }
  } catch {
    report({
      status: 'error',
      message: 'Browser storage is unavailable. Export your drawing to keep it.',
    });
    return;
  }
  let stored: { doc?: AnnieDoc; stamp?: string };
  try {
    stored = await readStored();
  } catch {
    stored = {};
  }
  if (stopped) {
    db.close();
    return;
  }
  known = stored.stamp;
  const editedEarly = JSON.stringify(board.read()) !== initial;
  if (stored.doc && !editedEarly) {
    try {
      follow(stored.doc, stored.stamp, false);
      report({ status: 'saved' });
    } catch {
      // Keep the unreadable drawing under another key, then keep saving new work over the original.
      const aside = `${key}#unreadable-${Date.now()}`;
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(stored.doc, aside);
        await committed(tx);
      } catch {
        report({
          status: 'error',
          message:
            'The saved drawing could not be opened or copied, so it is left as it was. Export your drawing to keep it.',
        });
        return;
      }
      report({
        status: 'error',
        message: `The saved drawing could not be opened. A copy is kept in browser storage as ${aside}.`,
      });
    }
  } else if (stored.doc) {
    dirty = true;
    raise(FOUND_LATE);
  } else if (editedEarly) {
    dirty = true;
    save();
  } else report({ status: 'saved' });
  unsubscribe = board.on('change', () => {
    if (following) return;
    dirty = true;
    if (conflict) {
      report(conflict);
      return;
    }
    report({ status: 'saving' });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      save();
    }, 300);
  });
  window.addEventListener('pagehide', flush);
  if (typeof BroadcastChannel === 'function') {
    channel = new BroadcastChannel('anniedrawing-autosave');
    channel.onmessage = (event: MessageEvent<{ key?: string; stamp?: string }>) => {
      if (stopped || event.data?.key !== key || event.data.stamp === known) return;
      // An idle tab follows the other tab. A tab with its own unsaved edits asks which to keep.
      if (dirty || conflict) {
        if (!conflict) raise(OTHER_TAB);
        return;
      }
      void readStored()
        .then(({ doc, stamp }) => {
          if (doc && !dirty && !conflict && stamp !== known) follow(doc, stamp);
        })
        .catch(() => undefined);
    };
  }
}
