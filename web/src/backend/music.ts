/** Music library in the browser (stand-in for backend/music.py). Each device
 *  brings its own music:
 *    - a folder picked with the File System Access API (desktop Chrome/Edge),
 *      remembered as a handle and rescanned on demand;
 *    - or files picked one by one (phones, tablets), copied into the origin's
 *      private file system so they survive restarts.
 *  Tags and cover art come from music-metadata; art is shrunk to a thumbnail
 *  and stored with the library so the dock can show it without rereading. */

import { idbDel, idbEntries, idbGet, idbSet } from "./idb";

export const AUDIO_EXT = [".mp3", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".flac"];
const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg",
  ".opus": "audio/ogg", ".wav": "audio/wav", ".flac": "audio/flac",
};

export const DEFAULTS = {
  autoplay_on_launch: false,
  shuffle: false,
  loop_mode: "none" as "none" | "all" | "one",
  volume: 70,
  last_track_index: 0,
  last_track_id: "",
  last_seek_seconds: 0,
  muted: false,
  folders: [] as string[], // display names of the picked folders (+ "Imported files")
};
export type MusicSettings = typeof DEFAULTS;

export const IMPORTED = "Imported files";

interface StoredTrack {
  id: string;
  file: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  has_art: boolean;
  source: { kind: "dir"; folder: string; path: string[] } | { kind: "opfs"; name: string };
}

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?(o: { mode: string }): Promise<PermissionState>;
  requestPermission?(o: { mode: string }): Promise<PermissionState>;
  values(): AsyncIterable<FileSystemHandle>;
};

let library: StoredTrack[] | null = null;
const artUrls = new Map<string, string>();
const fileUrls = new Map<string, string>();

export const canPickFolder = () => typeof (window as any).showDirectoryPicker === "function";

// ── settings ─────────────────────────────────────────────────────────────────

export async function loadSettings(): Promise<MusicSettings> {
  const s = (await idbGet<Partial<MusicSettings>>("music", "settings").catch(() => undefined)) ?? {};
  return { ...DEFAULTS, ...Object.fromEntries(Object.entries(s).filter(([k]) => k in DEFAULTS)) };
}

export async function saveSettings(patch: Partial<MusicSettings>): Promise<MusicSettings> {
  const data = await loadSettings();
  for (const [k, v] of Object.entries(patch ?? {})) if (k in DEFAULTS && v !== undefined && v !== null) (data as any)[k] = v;
  if (!["none", "all", "one"].includes(data.loop_mode)) data.loop_mode = "none";
  data.volume = Math.max(0, Math.min(100, Math.round(Number(data.volume) || 0)));
  await idbSet("music", "settings", data).catch(() => {});
  return data;
}

// ── folders ──────────────────────────────────────────────────────────────────

async function folderHandles(): Promise<Map<string, DirHandle>> {
  const out = new Map<string, DirHandle>();
  for (const [k, v] of await idbEntries<DirHandle>("music").catch(() => [] as [string, DirHandle][])) {
    if (k.startsWith("dir:")) out.set(k.slice(4), v);
  }
  return out;
}

/** Ask for a folder and add it to the library. Returns its name, or null. */
export async function pickFolder(): Promise<string | null> {
  if (!canPickFolder()) return null;
  let h: DirHandle;
  try {
    h = await (window as any).showDirectoryPicker({ id: "music", mode: "read", startIn: "music" });
  } catch {
    return null; // cancelled
  }
  let name = h.name;
  const have = await folderHandles();
  for (const [n, existing] of have) if (await existing.isSameEntry(h)) return n;
  for (let i = 2; have.has(name); i++) name = `${h.name} (${i})`;
  await idbSet("music", `dir:${name}`, h);
  const s = await loadSettings();
  await saveSettings({ folders: [...s.folders.filter((f) => f !== name), name] });
  return name;
}

/** Copy picked files into the private file system so they stay available. */
export async function importFiles(files: FileList | File[]): Promise<number> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("music", { create: true });
  let n = 0;
  for (const f of Array.from(files)) {
    if (!AUDIO_EXT.some((e) => f.name.toLowerCase().endsWith(e))) continue;
    const fh = await dir.getFileHandle(f.name, { create: true });
    const w = await (fh as any).createWritable();
    await w.write(f);
    await w.close();
    n++;
  }
  navigator.storage.persist?.().catch(() => {});
  if (n) {
    const s = await loadSettings();
    if (!s.folders.includes(IMPORTED)) await saveSettings({ folders: [...s.folders, IMPORTED] });
  }
  return n;
}

/** Set the folder list; names that were removed lose their handle (or, for
 *  imported files, their copies). */
export async function setFolders(folders: string[]): Promise<MusicSettings> {
  const s = await loadSettings();
  for (const f of s.folders) {
    if (folders.includes(f)) continue;
    if (f === IMPORTED) {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry("music", { recursive: true }).catch(() => {});
    } else await idbDel("music", `dir:${f}`);
  }
  return saveSettings({ folders: s.folders.filter((f) => folders.includes(f)) });
}

// ── scanning ─────────────────────────────────────────────────────────────────

async function hasAccess(h: DirHandle, ask: boolean) {
  if (!h.queryPermission) return true;
  if ((await h.queryPermission({ mode: "read" })) === "granted") return true;
  if (!ask || !h.requestPermission) return false;
  try {
    return (await h.requestPermission({ mode: "read" })) === "granted";
  } catch {
    return false; // needs a user gesture
  }
}

async function* walk(dir: DirHandle, path: string[] = []): AsyncGenerator<[string[], FileSystemFileHandle]> {
  const entries: FileSystemHandle[] = [];
  for await (const e of dir.values()) entries.push(e);
  entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  for (const e of entries) {
    if (e.kind === "directory") yield* walk(e as DirHandle, [...path, e.name]);
    else if (AUDIO_EXT.some((x) => e.name.toLowerCase().endsWith(x))) yield [[...path, e.name], e as FileSystemFileHandle];
  }
}

async function sha1(s: string) {
  const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}

const prettify = (name: string) => name.replace(/\.[^.]+$/, "").replaceAll("_", " ").trim();

/** Cover art shrunk to a 256px JPEG, or null. */
async function thumbnail(data: Uint8Array, format: string): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(new Blob([data as BlobPart], { type: format || "image/jpeg" }));
    const scale = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
    const c = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return await c.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  } catch {
    return null;
  }
}

async function readTrack(file: File, id: string, source: StoredTrack["source"]): Promise<StoredTrack> {
  let duration = 0;
  let artist = "";
  let title = "";
  let album = "";
  let hasArt = false;
  try {
    const { parseBlob } = await import("music-metadata");
    const m = await parseBlob(file, { duration: false, skipCovers: false });
    duration = m.format.duration ?? 0;
    artist = (m.common.artist ?? "").trim();
    title = (m.common.title ?? "").trim();
    album = (m.common.album ?? "").trim();
    const pic = m.common.picture?.[0];
    if (pic) {
      const thumb = await thumbnail(pic.data, pic.format);
      if (thumb) {
        await idbSet("music", `art:${id}`, thumb);
        hasArt = true;
      }
    }
  } catch (e) {
    console.info(`tags unreadable for ${file.name}:`, e);
  }
  if (!title) {
    // "Artist - Title.mp3" is the common filename convention
    const name = prettify(file.name);
    if (name.includes(" - ") && !artist) [artist, title] = name.split(" - ", 2).map((s) => s.trim()) as [string, string];
    else title = name;
  }
  return { id, file: file.name, title, artist, album, duration: Math.round(duration * 100) / 100, has_art: hasArt, source };
}

/** Rescan every folder (asking for access again where the browser forgot it,
 *  when `ask` and there's a user gesture). Keeps tags of unchanged files. */
export async function scan(ask = false): Promise<StoredTrack[]> {
  const s = await loadSettings();
  const old = new Map((library ?? (await storedLibrary())).map((t) => [t.id, t]));
  const tracks: StoredTrack[] = [];
  const seen = new Set<string>();
  const handles = await folderHandles();
  for (const folder of s.folders) {
    if (folder === IMPORTED) {
      try {
        const root = await navigator.storage.getDirectory();
        const dir = (await root.getDirectoryHandle("music", { create: true })) as unknown as DirHandle;
        for await (const [path, fh] of walk(dir)) {
          const id = await sha1(`opfs/${path.join("/")}`.toLowerCase());
          if (seen.has(id)) continue;
          seen.add(id);
          tracks.push(old.get(id) ?? (await readTrack(await fh.getFile(), id, { kind: "opfs", name: path.join("/") })));
        }
      } catch (e) {
        console.warn("imported music unreadable:", e);
      }
      continue;
    }
    const h = handles.get(folder);
    if (!h) continue;
    if (!(await hasAccess(h, ask))) {
      // Keep what we knew so the list doesn't vanish; access returns on the next tap.
      for (const t of old.values()) if (t.source.kind === "dir" && t.source.folder === folder && !seen.has(t.id)) {
        seen.add(t.id);
        tracks.push(t);
      }
      continue;
    }
    for await (const [path, fh] of walk(h)) {
      const id = await sha1(`${folder}/${path.join("/")}`.toLowerCase());
      if (seen.has(id)) continue;
      seen.add(id);
      tracks.push(old.get(id) ?? (await readTrack(await fh.getFile(), id, { kind: "dir", folder, path })));
    }
  }
  library = tracks;
  await idbSet("music", "library", tracks).catch(() => {});
  for (const t of old.values()) if (!seen.has(t.id) && t.has_art) await idbDel("music", `art:${t.id}`).catch(() => {});
  await primeArt(tracks);
  return tracks;
}

async function storedLibrary(): Promise<StoredTrack[]> {
  return (await idbGet<StoredTrack[]>("music", "library").catch(() => undefined)) ?? [];
}

async function primeArt(tracks: StoredTrack[]) {
  for (const t of tracks) {
    if (!t.has_art || artUrls.has(t.id)) continue;
    const blob = await idbGet<Blob>("music", `art:${t.id}`).catch(() => undefined);
    if (blob) artUrls.set(t.id, URL.createObjectURL(blob));
  }
}

export async function getLibrary(): Promise<StoredTrack[]> {
  if (library) return library;
  library = await storedLibrary();
  if (!library.length && (await loadSettings()).folders.length) return scan();
  await primeArt(library);
  return library;
}

/** Strip storage details before handing tracks to the UI. */
export const publicTracks = (tracks: StoredTrack[]) => tracks.map(({ source: _s, ...t }) => t);

/** Object URL of a cover thumbnail ("" when there is none or it isn't loaded). */
export const artUrl = (id: string) => artUrls.get(id) ?? "";

/** Object URL to play a track. May prompt for folder access (call from a tap). */
export async function trackUrl(id: string): Promise<string> {
  if (fileUrls.has(id)) return fileUrls.get(id)!;
  const t = (await getLibrary()).find((x) => x.id === id);
  if (!t) throw new Error("track not found");
  let file: File;
  if (t.source.kind === "opfs") {
    let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("music");
    const parts = t.source.name.split("/");
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
    file = await (await dir.getFileHandle(parts.at(-1)!)).getFile();
  } else {
    const h = (await folderHandles()).get(t.source.folder);
    if (!h || !(await hasAccess(h, true))) throw new Error(`No access to the "${t.source.folder}" folder — tap play again to allow it`);
    let dir: FileSystemDirectoryHandle = h;
    for (const p of t.source.path.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
    file = await (await dir.getFileHandle(t.source.path.at(-1)!)).getFile();
  }
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  const url = URL.createObjectURL(file.type ? file : new Blob([file], { type: MIME[ext] ?? "application/octet-stream" }));
  fileUrls.set(id, url);
  return url;
}
