import { create } from "zustand";
import { toast } from "sonner";
import { trackUrl } from "../backend/music";
import { api, mediaUrl, put } from "./api";

/** Music engine: one persistent <audio> element + a store. Behaviour follows
 *  MP3_Player_BRD.txt (prev-restart rule, shuffle history, 3 loop modes,
 *  autoplay, persisted state) with Media Session for media keys and the
 *  system / lock-screen media controls. Tracks are this device's own files
 *  (see backend/music.ts), played from object URLs. */

export interface Track {
  id: string;
  file: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  has_art: boolean;
}

export type LoopMode = "none" | "all" | "one";
type PlayState = "stopped" | "playing" | "paused";

interface PlayerSettings {
  autoplay_on_launch: boolean;
  shuffle: boolean;
  loop_mode: LoopMode;
  volume: number;
  last_track_index: number;
  last_track_id: string;
  last_seek_seconds: number;
  muted: boolean;
}

interface PlayerState {
  ready: boolean;
  tracks: Track[];
  index: number;
  state: PlayState;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  loop: LoopMode;
  expanded: boolean;
  justAdvanced: number; // timestamp of last auto-advance (UI pulse)
}

const HISTORY_MAX = 50;
const audio = typeof Audio !== "undefined" ? new Audio() : (null as unknown as HTMLAudioElement);
if (audio) audio.preload = "metadata";

let history: number[] = [];
let lastPrevClick = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const usePlayer = create<PlayerState>()(() => ({
  ready: false,
  tracks: [],
  index: -1,
  state: "stopped",
  position: 0,
  duration: 0,
  volume: 70,
  muted: false,
  shuffle: false,
  loop: "none",
  expanded: false,
  justAdvanced: 0,
}));

const get = usePlayer.getState;
const set = usePlayer.setState;

export const current = () => {
  const s = get();
  return s.index >= 0 ? s.tracks[s.index] : undefined;
};

export const artUrl = (t: Track) => mediaUrl(`/music/art/${t.id}`);

/* ── persistence ──────────────────────────────────────────────────────────── */

function persist(immediate = false) {
  if (saveTimer) clearTimeout(saveTimer);
  const run = () => {
    const s = get();
    const t = current();
    put("/music/settings", {
      shuffle: s.shuffle,
      loop_mode: s.loop,
      volume: Math.round(s.volume),
      muted: s.muted,
      last_track_index: Math.max(0, s.index),
      last_track_id: t?.id ?? "",
      last_seek_seconds: Math.round(audio.currentTime * 100) / 100 || 0,
    }).catch(() => {});
  };
  if (immediate) run();
  else saveTimer = setTimeout(run, 800);
}

/* ── core playback ────────────────────────────────────────────────────────── */

function applyVolume() {
  const { volume, muted } = get();
  audio.volume = muted ? 0 : volume / 100;
}

let loadSeq = 0;

/** Point the <audio> element at track `i`. Resolves false if it can't be read
 *  (e.g. the browser needs folder access again: the next tap asks). */
async function load(i: number, start = 0): Promise<boolean> {
  const t = get().tracks[i];
  if (!t) return false;
  const seq = ++loadSeq;
  set({ index: i, position: start, duration: t.duration });
  updateMediaSession();
  let src: string;
  try {
    src = await trackUrl(t.id);
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  }
  if (seq !== loadSeq) return false; // a newer track was picked meanwhile
  audio.src = src;
  audio.currentTime = 0;
  if (start > 0) {
    const seekWhenReady = () => {
      audio.currentTime = Math.min(start, (audio.duration || t.duration) - 1);
      audio.removeEventListener("loadedmetadata", seekWhenReady);
    };
    audio.addEventListener("loadedmetadata", seekWhenReady);
  }
  return true;
}

export function playIndex(i: number, opts: { start?: number; record?: boolean } = {}) {
  const prev = get().index;
  if (opts.record !== false && prev >= 0 && prev !== i) {
    history.push(prev);
    if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
  }
  load(i, opts.start ?? 0).then((ok) => {
    if (!ok) return;
    audio.play().catch(() => set({ state: "paused" }));
    persist();
  });
}

function randomOther(): number {
  const { tracks, index } = get();
  if (tracks.length <= 1) return 0;
  let n = index;
  while (n === index) n = Math.floor(Math.random() * tracks.length);
  return n;
}

export function togglePlay() {
  const s = get();
  if (!s.tracks.length) return;
  if (s.state === "playing") {
    audio.pause();
    persist();
    return;
  }
  if (s.index < 0) {
    playIndex(s.shuffle ? Math.floor(Math.random() * s.tracks.length) : 0, { record: false });
    return;
  }
  if (!audio.src) {
    // the restored track: start it at its resume point
    playIndex(s.index, { start: resumeAt, record: false });
    resumeAt = 0;
    return;
  }
  audio.play().catch(() => {});
}

export function stop() {
  audio.pause();
  if (audio.src) audio.currentTime = 0;
  set({ state: "stopped", position: 0 });
  persist();
}

export function next(auto = false) {
  const { tracks, index, shuffle, loop } = get();
  if (!tracks.length) return;
  let target: number;
  if (shuffle) target = randomOther();
  else if (index + 1 >= tracks.length) {
    if (auto && loop === "none") {
      stop();
      return;
    }
    target = 0;
  } else target = index + 1;
  if (auto) set({ justAdvanced: Date.now() });
  playIndex(target);
}

export function prev() {
  const now = Date.now();
  const restart = audio.currentTime > 3 && now - lastPrevClick > 1000;
  lastPrevClick = now;
  if (restart) {
    audio.currentTime = 0;
    return;
  }
  const { tracks, index, shuffle } = get();
  if (!tracks.length) return;
  if (shuffle && history.length) {
    playIndex(history.pop()!, { record: false });
    return;
  }
  playIndex(index <= 0 ? tracks.length - 1 : index - 1);
}

export function seek(sec: number) {
  if (!audio.src) return;
  audio.currentTime = Math.max(0, sec);
  set({ position: audio.currentTime });
}

export function setVolume(v: number) {
  set({ volume: v, muted: v === 0 ? get().muted : false });
  applyVolume();
  persist();
}

export function toggleMute() {
  set({ muted: !get().muted });
  applyVolume();
  persist();
}

export function toggleShuffle() {
  set({ shuffle: !get().shuffle });
  persist();
}

export function cycleLoop() {
  const order: LoopMode[] = ["none", "all", "one"];
  set({ loop: order[(order.indexOf(get().loop) + 1) % 3] });
  persist();
}

export function toggleExpanded(v?: boolean) {
  set({ expanded: v ?? !get().expanded });
}

/* ── audio element events ─────────────────────────────────────────────────── */

if (audio) {
  audio.addEventListener("timeupdate", () => set({ position: audio.currentTime }));
  audio.addEventListener("loadedmetadata", () => set({ duration: audio.duration || get().duration }));
  audio.addEventListener("play", () => {
    set({ state: "playing" });
    if (navigator.mediaSession) navigator.mediaSession.playbackState = "playing";
  });
  audio.addEventListener("pause", () => {
    if (get().state !== "stopped") set({ state: "paused" });
    if (navigator.mediaSession) navigator.mediaSession.playbackState = "paused";
  });
  audio.addEventListener("ended", () => {
    if (get().loop === "one") {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    next(true);
  });
  // periodic resume-point save while playing
  setInterval(() => get().state === "playing" && persist(true), 15_000);
  window.addEventListener("beforeunload", () => persist(true));
}

/* ── Media Session (media keys + system / lock-screen controls) ───────────── */

function updateMediaSession() {
  const t = current();
  if (!t || !("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    album: t.album || "Baller Buddy",
    artwork: t.has_art && artUrl(t) ? [{ src: artUrl(t), sizes: "256x256", type: "image/jpeg" }] : [],
  });
}

if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => togglePlay());
  ms.setActionHandler("pause", () => togglePlay());
  ms.setActionHandler("stop", () => stop());
  ms.setActionHandler("nexttrack", () => next());
  ms.setActionHandler("previoustrack", () => prev());
  ms.setActionHandler("seekto", (d) => d.seekTime != null && seek(d.seekTime));
}

/* ── boot ─────────────────────────────────────────────────────────────────── */

let booted = false;
let resumeAt = 0; // resume point of the restored track, used by its first play

export async function initPlayer() {
  if (booted) return;
  booted = true;
  const [lib, st] = await Promise.all([
    api<{ tracks: Track[] }>("/music/library"),
    api<PlayerSettings>("/music/settings"),
  ]);
  set({
    ready: true,
    tracks: lib.tracks,
    volume: st.volume,
    muted: st.muted,
    shuffle: st.shuffle,
    loop: st.loop_mode,
  });
  applyVolume();
  if (!lib.tracks.length) return;
  // Restore the last track (paused at its resume point) — no surprise audio.
  let idx = lib.tracks.findIndex((t) => t.id === st.last_track_id);
  if (idx < 0) idx = Math.min(st.last_track_index, lib.tracks.length - 1);
  if (st.autoplay_on_launch) {
    playIndex(st.shuffle ? Math.floor(Math.random() * lib.tracks.length) : 0, { record: false });
  } else {
    // Only note the track: reading the file may need a tap (folder access).
    const t = lib.tracks[idx];
    set({ index: idx, position: st.last_seek_seconds || 0, duration: t.duration, state: "paused" });
    resumeAt = st.last_seek_seconds || 0;
    updateMediaSession();
  }
}

export async function reloadLibrary() {
  const playingId = current()?.id;
  const lib = await api<{ tracks: Track[] }>("/music/library");
  const idx = playingId ? lib.tracks.findIndex((t) => t.id === playingId) : -1;
  set({ tracks: lib.tracks, index: idx });
}

export const fmtTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};
