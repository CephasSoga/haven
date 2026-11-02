/**
 * Book files live in IndexedDB — localStorage is far too small for PDFs and EPUBs.
 * A tiny promise wrapper; one object store keyed by book id, holding the original File/Blob.
 */

const DB = "haven-library";
const STORE = "files";

let dbPromise: Promise<IDBDatabase> | null = null;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export const putFile = (id: string, blob: Blob) => run<void>("readwrite", (s) => s.put(blob, id));
export const getFile = (id: string) => run<Blob | undefined>("readonly", (s) => s.get(id));
export const deleteFile = (id: string) => run<void>("readwrite", (s) => s.delete(id));
export const clearFiles = () => run<void>("readwrite", (s) => s.clear());

/** Asks the browser not to evict the library under storage pressure. */
export async function keepFiles() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* best effort */
  }
}

export async function storageUsed() {
  try {
    const est = await navigator.storage?.estimate();
    return est ? { used: est.usage ?? 0, quota: est.quota ?? 0 } : null;
  } catch {
    return null;
  }
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
