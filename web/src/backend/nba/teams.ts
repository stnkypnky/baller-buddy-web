/** Team lookups and metadata (port of backend/nba/teams.py). */

import { DEFAULT_COLORS, TEAM_COLORS, TEAMS, type Team } from "./teamData";

export type { Team };

const byId = new Map(TEAMS.map((t) => [t.id, t]));
const byName = new Map(TEAMS.map((t) => [t.full_name, t]));

export const ESPN_IDS: Record<string, number> = Object.fromEntries(TEAMS.map((t) => [t.full_name, t.espn_id]));
export const ESPN_ABBR: Record<string, string> = Object.fromEntries(TEAMS.map((t) => [t.full_name, t.espn_abbr]));
/** ESPN team id -> app full name, for ESPN payloads. */
export const ESPN_ID_TO_NAME: Record<number, string> = Object.fromEntries(TEAMS.map((t) => [t.espn_id, t.full_name]));

export const getAllTeams = () => [...byName.keys()].sort();
export const getTeamId = (name: string) => byName.get(name)?.id;
/** NBA TeamID -> full name (e.g. 'Boston Celtics'). */
export const getTeamName = (teamId: number | string | null | undefined) => byId.get(Number(teamId))?.full_name ?? "";
/** NBA TeamID -> nba.com tricode (e.g. 'BOS') used in MATCHUP strings. */
export const getTeamAbbr = (teamId: number | string) => byId.get(Number(teamId))?.abbreviation ?? "";
export const getTeamColors = (name: string) => TEAM_COLORS[name] ?? DEFAULT_COLORS;

/** Loose lookup by full name, nickname, city or tricode. */
export function findTeam(query: string | null | undefined): Team | null {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return null;
  for (const t of TEAMS) {
    if ([t.full_name, t.abbreviation, t.nickname, t.city].some((s) => s.toLowerCase() === q)) return t;
  }
  return TEAMS.find((t) => t.full_name.toLowerCase().includes(q)) ?? null;
}

/** Everything the frontend needs to render team pickers and theming. */
export function teamMeta() {
  return [...TEAMS]
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
    .map((t) => ({
      id: t.id,
      name: t.full_name,
      abbr: t.abbreviation,
      city: t.city,
      nickname: t.nickname,
      conference: t.east ? "East" : "West",
      espn_id: t.espn_id,
      espn_abbr: t.espn_abbr,
      colors: getTeamColors(t.full_name),
    }));
}
