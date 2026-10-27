/** Minimal IndexedDB key-value stores: one database, a few object stores. */

const DB_NAME = "baller-buddy";
const DB_VERSION = 1;
export type StoreName = "cache" | "settings" | "keys" | "music";
const STORES: StoreName[] = ["cache", "settings", "keys", "music"];

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbp.catch(() => (dbp = null));
  }
  return dbp;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: StoreName, mode: IDBTransactionMode) {
  return (await open()).transaction(name, mode).objectStore(name);
}

export async function idbGet<T>(name: StoreName, key: string): Promise<T | undefined> {
  return done((await store(name, "readonly")).get(key)) as Promise<T | undefined>;
}

export async function idbSet(name: StoreName, key: string, value: unknown): Promise<void> {
  await done((await store(name, "readwrite")).put(value, key));
}

export async function idbDel(name: StoreName, key: string): Promise<void> {
  await done((await store(name, "readwrite")).delete(key));
}

/** Every [key, value] in a store. */
export async function idbEntries<T>(name: StoreName): Promise<[string, T][]> {
  const s = await store(name, "readonly");
  const [keys, values] = await Promise.all([done(s.getAllKeys()), done(s.getAll())]);
  return keys.map((k, i) => [String(k), values[i] as T]);
}

/** Deletes the keys `pred` accepts; returns how many went. */
export async function idbDeleteWhere(name: StoreName, pred: (key: string, value: unknown) => boolean): Promise<number> {
  const s = await store(name, "readwrite");
  let n = 0;
  await new Promise<void>((resolve, reject) => {
    const req = s.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      if (pred(String(c.key), c.value)) {
        c.delete();
        n++;
      }
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return n;
}
