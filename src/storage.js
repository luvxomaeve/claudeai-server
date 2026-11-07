// Хранение загруженных нарядов (.vrm) и анимаций (.vrma) в IndexedDB браузера.
// Если хранилище недоступно (приватный режим и т.п.), всё работает до перезагрузки.

const DB_NAME = 'waifu-touch';
const STORE = 'files';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export async function saveFile(record) {
  try { await tx('readwrite', (s) => s.put(record)); } catch (e) { console.warn('Не удалось сохранить файл', e); }
}

export async function deleteFile(id) {
  try { await tx('readwrite', (s) => s.delete(id)); } catch (e) { console.warn('Не удалось удалить файл', e); }
}

export async function listFiles(kind) {
  try {
    const all = await tx('readonly', (s) => s.getAll());
    return all.filter((r) => r.kind === kind).sort((a, b) => a.created - b.created);
  } catch (e) {
    console.warn('Хранилище недоступно', e);
    return [];
  }
}
