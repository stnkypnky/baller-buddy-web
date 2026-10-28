/** Persistent TTL cache in IndexedDB, one record per key (port of
 *  backend/nba/cache.py). Entries are {ts, data}; reads go through an
 *  in-memory copy so repeat lookups don't touch the database. */

import { CACHE_TTL, EMPTY_TTL, PAST_SEASON_TTL } from "./config";
import { idbDeleteWhere, idbGet, idbSet } from "./idb";

interface Entry {
  ts: number;
  data: unknown;
}

// Entries older than this are dropped at startup. Every TTL in the app is at
// most PAST_SEASON_TTL, so only never-expiring entries (finished games' stories
// and Pulse data, combine measurements) are affected; they refetch if reopened.
const MAX_AGE = PAST_SEASON_TTL;

const now = () => Date.now() / 1000;

/** Python truthiness: empty lists/objects/strings count as "no data". */
export function isEmpty(v: unknown): boolean {
  if (v == null || v === false || v === 0 || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

function stale(key: string, e: Entry, t: number, today: string) {
  if (t - (e?.ts ?? 0) >= MAX_AGE) return true;
  // The 14-day schedule is cached under the day it was fetched; older days'
  // copies are never read again.
  if (key.startsWith("upcoming_v3_")) return key.split("_")[2] < today;
  return false;
}

export function localIsoDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** In-memory TTL store for data worth holding only while someone is looking at
 *  it (box scores). Past `maxItems` the least recently used entry goes. */
export class Memo<T = unknown> {
  private data = new Map<string, [number, T]>();
  constructor(private maxItems = 32) {}

  get(key: string): T | undefined {
    const e = this.data.get(key);
    if (!e) return undefined;
    if (now() >= e[0]) {
      this.data.delete(key);
      return undefined;
    }
    this.data.delete(key);
    this.data.set(key, e);
    return e[1];
  }

  clear() {
    this.data.clear();
  }

  set(key: string, value: T, ttl: number) {
    this.data.delete(key);
    this.data.set(key, [now() + ttl, value]);
    while (this.data.size > this.maxItems) this.data.delete(this.data.keys().next().value!);
  }
}

export class Cache {
  private mem = new Map<string, Entry | null>();
  private inflight = new Map<string, Promise<unknown>>();
  private persist: boolean;

  constructor(opts: { persist?: boolean } = {}) {
    this.persist = opts.persist ?? typeof indexedDB !== "undefined";
  }

  /** Drop entries nothing will read again. */
  async prune(): Promise<number> {
    if (!this.persist) return 0;
    const t = now();
    const today = localIsoDate();
    try {
      return await idbDeleteWhere("cache", (k, v) => stale(k, v as Entry, t, today));
    } catch {
      return 0;
    }
  }

  private async entry(key: string): Promise<Entry | null> {
    if (this.mem.has(key)) return this.mem.get(key)!;
    let e: Entry | null = null;
    if (this.persist) {
      try {
        e = (await idbGet<Entry>("cache", key)) ?? null;
      } catch {
        e = null;
      }
    }
    this.mem.set(key, e);
    return e;
  }

  /** Cached data, or undefined when missing/expired. `ttl=null` means never
   *  expire. Empty results expire after `emptyTtl` so they're retried. */
  async get<T>(key: string, ttl: number | null = CACHE_TTL, emptyTtl = EMPTY_TTL): Promise<T | undefined> {
    const e = await this.entry(key);
    if (!e) return undefined;
    const age = now() - (e.ts ?? 0);
    if (isEmpty(e.data) && age >= emptyTtl) return undefined;
    if (ttl !== null && age >= ttl) return undefined;
    return e.data as T;
  }

  /** Seconds since `key` was written, or null when it isn't cached. */
  async age(key: string): Promise<number | null> {
    const e = await this.entry(key);
    return e ? now() - (e.ts ?? 0) : null;
  }

  async set(key: string, data: unknown) {
    const e = { ts: now(), data };
    this.mem.set(key, e);
    if (this.persist) await idbSet("cache", key, e).catch(() => {});
  }

  async popWhere(pred: (key: string) => boolean) {
    for (const k of [...this.mem.keys()]) if (pred(k)) this.mem.delete(k);
    if (this.persist) await idbDeleteWhere("cache", (k) => pred(k)).catch(() => 0);
  }

  /** Single-flight cached fetch: concurrent callers for the same key share one
   *  fetch. `fetch` errors are logged and `fallback` is returned (not cached). */
  async getOrFetch<T>(
    key: string,
    fetch: () => Promise<T>,
    opts: { ttl?: number | null; fallback: T; cacheEmpty?: boolean },
  ): Promise<T> {
    const ttl = opts.ttl === undefined ? CACHE_TTL : opts.ttl;
    const hit = await this.get<T>(key, ttl);
    if (hit !== undefined && hit !== null) return hit;
    const running = this.inflight.get(key);
    if (running) return running as Promise<T>;
    const p = (async () => {
      try {
        const data = await fetch();
        if (!isEmpty(data) || opts.cacheEmpty !== false) await this.set(key, data);
        return data;
      } catch (e) {
        console.warn(`fetch ${key} failed:`, e);
        return opts.fallback;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }
}

export const cache = new Cache();
