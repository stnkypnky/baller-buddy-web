import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { SeasonType } from "./types";

/** UI state that survives restarts (per-viewer conveniences only). */
interface AppState {
  teamId: number | null;
  season: string | null; // null = follow the current season automatically
  seasonType: SeasonType;
  compareId: number | null;
  compareType: SeasonType;
  sidebarCollapsed: boolean;
  rosterView: "cards" | "table";
  /** Developer option: show the model's reasoning under AI answers. */
  showReasoning: boolean;
  /** The music dock along the bottom of the window. */
  showMusic: boolean;
  setTeam: (id: number) => void;
  setSeason: (s: string | null) => void;
  setSeasonType: (t: SeasonType) => void;
  setCompare: (id: number) => void;
  setCompareType: (t: SeasonType) => void;
  toggleSidebar: () => void;
  setRosterView: (v: "cards" | "table") => void;
  setShowReasoning: (v: boolean) => void;
  setShowMusic: (v: boolean) => void;
}

// localStorage can throw (private mode, blocked storage) — degrade to memory.
export const safeStorage = createJSONStorage(() => ({
  getItem: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
  removeItem: (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
}));

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      teamId: null,
      season: null,
      seasonType: "regular",
      compareId: null,
      compareType: "regular",
      sidebarCollapsed: false,
      rosterView: "cards",
      showReasoning: false,
      showMusic: true,
      setTeam: (teamId) => set({ teamId }),
      setSeason: (season) => set({ season }),
      setSeasonType: (seasonType) => set({ seasonType }),
      setCompare: (compareId) => set({ compareId }),
      setCompareType: (compareType) => set({ compareType }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setRosterView: (rosterView) => set({ rosterView }),
      setShowReasoning: (showReasoning) => set({ showReasoning }),
      setShowMusic: (showMusic) => set({ showMusic }),
    }),
    { name: "baller-buddy-ui", storage: safeStorage },
  ),
);
