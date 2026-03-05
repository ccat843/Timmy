import { extensionManifestSchema, type ExtensionManifest } from '@/extensions/schema';

const STORAGE_KEY = 'wm.extensions';
const DB_NAME = 'wm_extensions';
const STORE_NAME = 'extensions';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function canUseIndexedDb(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function getDb(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

function listFromLocalStorage(): ExtensionManifest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(item => extensionManifestSchema.parse(item));
  } catch {
    return [];
  }
}

function saveToLocalStorage(items: ExtensionManifest[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export async function listExtensions(): Promise<ExtensionManifest[]> {
  const db = await getDb();
  if (!db) return listFromLocalStorage();

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const rows = Array.isArray(request.result) ? request.result : [];
        resolve(rows.map(row => extensionManifestSchema.parse(row)));
      };
      request.onerror = () => resolve(listFromLocalStorage());
    } catch {
      resolve(listFromLocalStorage());
    }
  });
}

export async function upsertExtension(manifest: ExtensionManifest): Promise<void> {
  const parsed = extensionManifestSchema.parse(manifest);
  const db = await getDb();
  if (!db) {
    const next = listFromLocalStorage().filter(item => item.id !== parsed.id);
    next.push(parsed);
    saveToLocalStorage(next);
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(parsed);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function removeExtension(id: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    const next = listFromLocalStorage().filter(item => item.id !== id);
    saveToLocalStorage(next);
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  const items = await listExtensions();
  const target = items.find(item => item.id === id);
  if (!target) return;
  await upsertExtension({ ...target, enabled });
}
