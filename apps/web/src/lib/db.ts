/**
 * A tiny key-value store on IndexedDB. Holds the offline copy of the logbook and the dives that
 * are not synced yet. Values are stored as structured clones.
 */
const DB_NAME = 'topside';
const STORE = 'kv';

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function dbGet<T>(key: string): Promise<T | undefined> {
  return (await run('readonly', (s) => s.get(key))) as T | undefined;
}

export async function dbSet(key: string, value: unknown): Promise<void> {
  await run('readwrite', (s) => s.put(value, key));
}

export async function dbDelete(key: string): Promise<void> {
  await run('readwrite', (s) => s.delete(key));
}

/** Ask the browser not to evict our data under storage pressure. */
export async function persistStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
