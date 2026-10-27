import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "./api";
import { useApp } from "./store";
import type {
  AbsenceNote,
  Compare,
  GameBox,
  GameStory,
  HistoryRow,
  Leaders,
  LiveBoard,
  Meta,
  NewsArticle,
  Overview,
  Player,
  PlayerLeaders,
  PlayerProfile,
  Scores,
  SeasonType,
  StandingRow,
  Team,
} from "./types";

export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/meta"), staleTime: 3600_000 });
}

/** The selected team/season resolved against metadata (defaults applied). */
export function useSelection() {
  const { data: meta } = useMeta();
  const { teamId, season, seasonType } = useApp();
  return useMemo(() => {
    const teams = meta?.teams ?? [];
    const byId = new Map(teams.map((t) => [t.id, t]));
    const byName = new Map(teams.map((t) => [t.name, t]));
    const byAbbr = new Map(teams.map((t) => [t.abbr, t]));
    const team: Team | undefined =
      (teamId != null ? byId.get(teamId) : undefined) ?? byName.get(meta?.default_team ?? "");
    const resolvedSeason = season && meta?.seasons.includes(season) ? season : meta?.season;
    return {
      meta,
      teams,
      byId,
      byName,
      byAbbr,
      team,
      season: resolvedSeason ?? "",
      isCurrentSeason: resolvedSeason === meta?.season,
      seasonType,
    };
  }, [meta, teamId, season, seasonType]);
}

const q = (s: string) => (s ? `?season=${s}` : "");

export function useOverview(teamId?: number, season?: string) {
  return useQuery({
    queryKey: ["overview", teamId, season],
    queryFn: () => api<Overview>(`/team/${teamId}/overview${q(season!)}`),
    enabled: !!teamId && !!season,
  });
}

export function useRoster(teamId?: number, season?: string) {
  return useQuery({
    queryKey: ["roster", teamId, season],
    queryFn: () => api<Player[]>(`/team/${teamId}/roster${q(season!)}`),
    enabled: !!teamId && !!season,
  });
}

/** Web notes on why players missed a finished season, keyed by player id.
 *  Fetched separately (each is a web search) once the roster shows someone did. */
export function useAbsenceNotes(teamId?: number, season?: string, enabled = true) {
  return useQuery({
    queryKey: ["absences", teamId, season],
    queryFn: () => api<Record<string, AbsenceNote>>(`/team/${teamId}/absences${q(season!)}`),
    enabled: !!teamId && !!season && enabled,
    staleTime: Infinity,
  });
}

export function useHistory(teamId?: number) {
  return useQuery({
    queryKey: ["history", teamId],
    queryFn: () => api<HistoryRow[]>(`/team/${teamId}/history`),
    enabled: !!teamId,
  });
}

export function usePlayerProfile(pid?: number, teamId?: number, season?: string) {
  return useQuery({
    queryKey: ["player", pid, teamId, season],
    queryFn: () => api<PlayerProfile>(`/player/${pid}/profile?team_id=${teamId}&season=${season}`),
    enabled: !!pid && !!teamId && !!season,
  });
}

export function useStandings(season?: string) {
  return useQuery({
    queryKey: ["standings", season],
    queryFn: () => api<StandingRow[]>(`/league/standings${q(season!)}`),
    enabled: !!season,
  });
}

export function useLeaders(season?: string) {
  return useQuery({
    queryKey: ["leaders", season],
    queryFn: () => api<Leaders>(`/league/leaders${q(season!)}`),
    enabled: !!season,
  });
}

export function usePlayerLeaders(season?: string, rookies = false) {
  return useQuery({
    queryKey: ["player-leaders", season, rookies],
    queryFn: () => api<PlayerLeaders>(`/league/player-leaders${q(season!)}${rookies ? (season ? "&" : "?") + "rookies=true" : ""}`),
    enabled: !!season,
  });
}

export function useScores(season?: string) {
  return useQuery({
    queryKey: ["scores", season],
    queryFn: () => api<Scores>(`/scores${q(season!)}`),
    enabled: !!season,
  });
}

export function useGameStory(gameId?: string | null) {
  return useQuery({
    queryKey: ["story", gameId],
    queryFn: () => api<GameStory>(`/game/${gameId}/story`),
    enabled: !!gameId,
    staleTime: Infinity,
  });
}

export function useCompare(a?: number, b?: number | null, season?: string, type?: SeasonType) {
  return useQuery({
    queryKey: ["compare", a, b, season, type],
    queryFn: () => api<Compare>(`/compare?a=${a}&b=${b}&season=${season}&type=${type}`),
    enabled: !!a && !!b && a !== b && !!season,
  });
}

export function useLive(date?: string, poll = true) {
  return useQuery({
    queryKey: ["live", date ?? "today"],
    queryFn: () => api<LiveBoard>(`/live${date ? `?date=${date}` : ""}`),
    refetchInterval: (query) => {
      if (!poll) return false;
      const live = query.state.data?.games.some((g) => g.state === "in");
      return live ? 20_000 : 60_000;
    },
    refetchIntervalInBackground: false,
  });
}

/**
 * A full box score, fetched only while it's on screen and dropped two minutes
 * after (gcTime): finals never change, live ones refresh every 20 s. `source`
 * says which id this is: an nba.com game id or an ESPN event id.
 */
export function useGameBox(source: "nba" | "espn", id?: string | null) {
  return useQuery({
    queryKey: ["gamebox", source, id],
    queryFn: () => api<GameBox>(source === "nba" ? `/game/${id}/box` : `/live/${id}/box`),
    enabled: !!id,
    staleTime: (q) => (q.state.data?.final ? Infinity : 0),
    gcTime: 2 * 60_000,
    refetchInterval: (q) => (q.state.data && !q.state.data.final ? 20_000 : false),
    refetchIntervalInBackground: false,
  });
}

export function useNews(teamId?: number) {
  return useQuery({
    queryKey: ["news", teamId],
    queryFn: () => api<NewsArticle[]>(`/news${teamId ? `?team_id=${teamId}` : ""}`),
  });
}

export const seasonTypeLabel: Record<SeasonType, string> = {
  regular: "Regular Season",
  playoffs: "Playoffs",
  full: "Full Year",
};
