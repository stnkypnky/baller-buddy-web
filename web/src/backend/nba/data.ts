/** NBA data fetchers (port of backend/nba/data.py): stats.nba.com via
 *  statsGet() (serialized + spaced), plus ESPN. Fetch bodies throw on failure
 *  so network errors are never cached (Cache.getOrFetch returns the fallback). */

import type { Cache } from "../cache";
import { cache as appCache, localIsoDate, Memo } from "../cache";
import {
  ESPN_NEWS_URL,
  ESPN_SCOREBOARD_URL,
  ESPN_SUMMARY_URL,
  PAST_SEASON_TTL,
  SEASON_TYPE_PLAYOFFS,
  SEASON_TYPE_REGULAR,
  UPCOMING_DAYS,
  WEB_SEARCH_RESULTS,
  currentSeason,
  playoffsPossible,
  seasonTtl,
  type SeasonType,
} from "../config";
import { getJson, getText, HttpError } from "../http";
import { columns, dashParams, int, num, numOrNull, resultSet, round, statsGet, str, type Row } from "./stats";
import { ESPN_ID_TO_NAME, ESPN_IDS, getTeamAbbr, getTeamId, getTeamName } from "./teams";

// League leaderboard categories: [label, measure_type, field, higher_is_better, format, definition].
// measure_type selects which single league-wide fetch the field comes from.
export type LeaderCategory = [string, "Base" | "Advanced", string, boolean, string, string];
export const LEADER_CATEGORIES: LeaderCategory[] = [
  ["Net Rating", "Advanced", "NET_RATING", true, "{:+.1f}", "Point differential per 100 possessions"],
  ["Off Rating", "Advanced", "OFF_RATING", true, "{:.1f}", "Points scored per 100 possessions"],
  ["Def Rating", "Advanced", "DEF_RATING", false, "{:.1f}", "Points allowed per 100 possessions — lower is better"],
  ["Pace", "Advanced", "PACE", true, "{:.1f}", "Possessions per 48 minutes"],
  ["True Shooting", "Advanced", "TS_PCT", true, "{:.1%}", "Scoring efficiency, accounts for 3s & free throws"],
  ["Eff. FG%", "Advanced", "EFG_PCT", true, "{:.1%}", "Field-goal % adjusted for 3-pointers being worth more"],
  ["Reb %", "Advanced", "REB_PCT", true, "{:.1%}", "Share of available rebounds the team grabs"],
  ["Ast/TO", "Advanced", "AST_TO", true, "{:.2f}", "Assist-to-turnover ratio"],
  ["PPG", "Base", "PTS", true, "{:.1f}", "Points per game"],
  ["RPG", "Base", "REB", true, "{:.1f}", "Rebounds per game"],
  ["APG", "Base", "AST", true, "{:.1f}", "Assists per game"],
  ["FG%", "Base", "FG_PCT", true, "{:.1%}", "Field-goal percentage"],
  ["3P%", "Base", "FG3_PCT", true, "{:.1%}", "Three-point percentage"],
  ["Steals", "Base", "STL", true, "{:.1f}", "Steals per game"],
  ["Blocks", "Base", "BLK", true, "{:.1f}", "Blocks per game"],
  ["Turnovers", "Base", "TOV", false, "{:.1f}", "Turnovers per game — lower is better"],
];

// Player leaderboards: [label, field, format, definition, min_per_game]. min_per_game
// is the NBA's season qualifier for percentages (300 FGM, 82 3PM, 125 FTM over 82
// games) as a per-game rate, so it also works early on.
export type PlayerCategory = [string, string, string, string, [string, number] | null];
export const PLAYER_LEADER_CATEGORIES: PlayerCategory[] = [
  ["Points", "PTS", "{:.1f}", "Points per game", null],
  ["Rebounds", "REB", "{:.1f}", "Rebounds per game", null],
  ["Assists", "AST", "{:.1f}", "Assists per game", null],
  ["Steals", "STL", "{:.1f}", "Steals per game", null],
  ["Blocks", "BLK", "{:.1f}", "Blocks per game", null],
  ["3PM", "FG3M", "{:.1f}", "Three-pointers made per game", null],
  ["FG%", "FG_PCT", "{:.1%}", "Field-goal percentage", ["FGM", 300 / 82]],
  ["3P%", "FG3_PCT", "{:.1%}", "Three-point percentage", ["FG3M", 1.0]],
  ["FT%", "FT_PCT", "{:.1%}", "Free-throw percentage", ["FTM", 125 / 82]],
  ["FTM", "FTM", "{:.1f}", "Free throws made per game", null],
  ["FTA", "FTA", "{:.1f}", "Free-throw attempts per game", null],
  ["Off. Reb", "OREB", "{:.1f}", "Offensive rebounds per game", null],
  ["Def. Reb", "DREB", "{:.1f}", "Defensive rebounds per game", null],
  ["Minutes", "MIN", "{:.1f}", "Minutes per game", null],
  ["Fouls", "PF", "{:.1f}", "Personal fouls per game (most)", null],
  ["Fouls drawn", "PFD", "{:.1f}", "Fouls drawn per game", null],
  ["Turnovers", "TOV", "{:.1f}", "Turnovers per game (most)", null],
  ["+/-", "PLUS_MINUS", "{:+.1f}", "Point differential per game while on the floor", null],
];

/** Python str.format for the few specs used here ({:.1f}, {:+.1f}, {:.1%}, {:.2f}). */
export function pyFormat(fmt: string, v: number): string {
  const m = /\{:(\+)?\.(\d)([f%])\}/.exec(fmt);
  if (!m) return String(v);
  const x = m[3] === "%" ? v * 100 : v;
  const s = x.toFixed(Number(m[2]));
  return (m[1] && x >= 0 ? "+" : "") + s + (m[3] === "%" ? "%" : "");
}

// ── Standings / league ───────────────────────────────────────────────────────

export interface StandingRow {
  team_id: number;
  team_name: string;
  conference: string;
  rank: number;
  wins: number;
  losses: number;
  win_pct: number;
  gb: number;
  streak: string;
  last10: string;
  home: string;
  road: string;
}

function standingsRow(r: Row): StandingRow {
  const tid = int(r.TeamID);
  return {
    team_id: tid,
    team_name: getTeamName(tid),
    conference: str(r.Conference),
    rank: int(r.PlayoffRank),
    wins: int(r.WINS),
    losses: int(r.LOSSES),
    win_pct: num(r.WinPCT),
    gb: num(r.ConferenceGamesBack),
    streak: str(r.strCurrentStreak).trim(),
    last10: str(r.L10),
    home: str(r.HOME),
    road: str(r.ROAD),
  };
}

/** Full league standings (both conferences), sorted by conference then seed. */
export function fetchAllStandings(season: string, cache: Cache): Promise<StandingRow[]> {
  return cache.getOrFetch(
    `standings_all_${season}`,
    async () => {
      const j = await statsGet("leaguestandingsv3", {
        LeagueID: "00", Season: season, SeasonType: "Regular Season", SeasonYear: "",
      });
      return resultSet(j)
        .map(standingsRow)
        .sort((a, b) => a.conference.localeCompare(b.conference) || a.rank - b.rank);
    },
    { ttl: seasonTtl(season), fallback: [] },
  );
}

/** Per-team standings dict derived from the full-league standings. */
export async function fetchStandings(teamId: number, season: string, cache: Cache) {
  for (const row of await fetchAllStandings(season, cache)) {
    if (row.team_id === Number(teamId)) {
      return {
        wins: row.wins, losses: row.losses, win_pct: row.win_pct, conf_rank: row.rank,
        conference: row.conference, home: row.home, road: row.road, streak: row.streak,
        last10: row.last10, gb: row.gb,
      };
    }
  }
  return {} as Record<string, never>;
}
export type Standings = Awaited<ReturnType<typeof fetchStandings>>;

/** All 30 teams' stats for a season in one call ("Base" or "Advanced"). */
export function fetchLeagueTeamStats(season: string, measure: string, cache: Cache): Promise<Row[]> {
  return cache.getOrFetch(
    `leaders_${season}_${measure}`,
    async () => {
      const j = await statsGet("leaguedashteamstats", dashParams(season, measure, { TeamID: "" }));
      return resultSet(j).map((r) => {
        const tid = int(r.TEAM_ID);
        const row: Row = { team_id: tid, team_name: getTeamName(tid) };
        for (const col of columns(j)) {
          if (col === "TEAM_ID" || col === "TEAM_NAME") continue;
          const v = numOrNull(r[col]);
          if (v !== null) row[col] = v;
        }
        return row;
      });
    },
    { ttl: seasonTtl(season), fallback: [] },
  );
}

export interface LeaguePlayerRow {
  pid: number;
  name: string;
  team_id: number;
  team_abbr: string;
  gp: number;
  [col: string]: number | string;
}

/** Every player's per-game line for a season in one call (the player
 *  leaderboards), or only the rookie class when `rookies`. Only the columns the
 *  leaderboards rank or qualify on are kept. */
export function fetchLeaguePlayerStats(season: string, cache: Cache, rookies = false): Promise<LeaguePlayerRow[]> {
  const keep = new Set<string>();
  for (const [, field, , , q] of PLAYER_LEADER_CATEGORIES) {
    keep.add(field);
    if (q) keep.add(q[0]);
  }
  // "leaders_" prefix so a refresh clears it with the team leaderboards.
  return cache.getOrFetch(
    `leaders_${season}_${rookies ? "rookies" : "players"}`,
    async () => {
      const j = await statsGet(
        "leaguedashplayerstats",
        dashParams(season, "Base", {
          TeamID: "", College: "", Country: "", DraftPick: "", DraftYear: "", Height: "", Weight: "",
          PlayerExperience: rookies ? "Rookie" : "",
        }),
      );
      return resultSet(j).map((r) => {
        const row: LeaguePlayerRow = {
          pid: int(r.PLAYER_ID), name: str(r.PLAYER_NAME), team_id: int(r.TEAM_ID),
          team_abbr: str(r.TEAM_ABBREVIATION), gp: int(r.GP),
        };
        for (const col of columns(j)) {
          if (!keep.has(col)) continue;
          const v = numOrNull(r[col]);
          if (v !== null) row[col] = v;
        }
        return row;
      });
    },
    { ttl: seasonTtl(season), fallback: [] },
  );
}

/** Fewest games to qualify: 70% of the most anyone has played (the NBA's 58 of 82). */
export function minGames(rows: { gp: number }[]): number {
  return Math.max(1, Math.ceil(0.7 * Math.max(0, ...rows.map((r) => r.gp))));
}

/** The top `n` qualified players for `field`, best first. */
export function topPlayers(rows: LeaguePlayerRow[], field: string, minPerGame: [string, number] | null = null, n = 10) {
  const floor = minGames(rows);
  const ok = rows.filter(
    (r) =>
      r.gp >= floor &&
      field in r &&
      (minPerGame === null || num(r[minPerGame[0]]) >= minPerGame[1]),
  );
  ok.sort((a, b) => (b[field] as number) - (a[field] as number));
  return ok.slice(0, n);
}

// ── Team dashboards ──────────────────────────────────────────────────────────

const TOT_KEYS = ["pts", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "plus_minus"] as const;
type Totals = Record<(typeof TOT_KEYS)[number], number>;

export interface Dashboard {
  gp: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fg_pct: number;
  fg3_pct: number;
  ft_pct: number;
  plus_minus: number;
  _tot: Totals;
}

/** Display dict (per-game + percentages) from raw season totals. Raw totals
 *  stay under "_tot" so Regular + Playoffs combine into Full Year. */
function dashboardFromTotals(gp: number, tot: Totals): Dashboard {
  const g = Math.max(gp, 1);
  return {
    gp,
    pts: round(tot.pts / g, 1),
    reb: round(tot.reb / g, 1),
    ast: round(tot.ast / g, 1),
    stl: round(tot.stl / g, 1),
    blk: round(tot.blk / g, 1),
    tov: round(tot.tov / g, 1),
    fg_pct: round((tot.fgm / Math.max(tot.fga, 1)) * 100, 1),
    fg3_pct: round((tot.fg3m / Math.max(tot.fg3a, 1)) * 100, 1),
    ft_pct: round((tot.ftm / Math.max(tot.fta, 1)) * 100, 1),
    plus_minus: round(tot.plus_minus / g, 1),
    _tot: tot,
  };
}

type MaybeDash = Dashboard | Record<string, never>;
const hasDash = (d: MaybeDash | null | undefined): d is Dashboard => !!d && "gp" in d;

/** Combine two dashboards (e.g. Regular + Playoffs) into one Full-Year view. */
export function combineDashboards(reg: MaybeDash, playoffs: MaybeDash): MaybeDash {
  if (!hasDash(reg) && !hasDash(playoffs)) return {};
  if (!hasDash(playoffs)) return reg;
  if (!hasDash(reg)) return playoffs;
  const tot = Object.fromEntries(
    TOT_KEYS.map((k) => [k, (reg._tot?.[k] ?? 0) + (playoffs._tot?.[k] ?? 0)]),
  ) as Totals;
  return dashboardFromTotals(reg.gp + playoffs.gp, tot);
}

export function fetchDashboard(teamId: number, season: string, cache: Cache, seasonType: SeasonType = SEASON_TYPE_REGULAR): Promise<MaybeDash> {
  return cache.getOrFetch<MaybeDash>(
    `dashboard_v2_${teamId}_${season}_${seasonType}`,
    async () => {
      const j = await statsGet("teamdashboardbygeneralsplits", {
        TeamID: teamId, LastNGames: "0", MeasureType: "Base", Month: "0", OpponentTeamID: 0,
        PaceAdjust: "N", PerMode: "Totals", Period: "0", PlusMinus: "N", Rank: "N",
        Season: season, SeasonType: seasonType, DateFrom: "", DateTo: "", GameSegment: "",
        LeagueID: "00", Location: "", Outcome: "", PORound: "", SeasonSegment: "",
        ShotClockRange: "", VsConference: "", VsDivision: "",
      });
      const r = resultSet(j)[0];
      if (!r) return {};
      const gp = int(r.GP);
      if (gp <= 0) return {}; // e.g. team made no playoffs that season
      const tot = {
        pts: num(r.PTS), reb: num(r.REB), ast: num(r.AST), stl: num(r.STL), blk: num(r.BLK),
        tov: num(r.TOV), fgm: num(r.FGM), fga: num(r.FGA), fg3m: num(r.FG3M), fg3a: num(r.FG3A),
        ftm: num(r.FTM), fta: num(r.FTA), plus_minus: num(r.PLUS_MINUS),
      };
      return dashboardFromTotals(gp, tot);
    },
    { ttl: seasonTtl(season), fallback: {} },
  );
}

/** Per-game averages for the team's last `seasons` seasons, oldest first,
 *  with each season's conference rank and playoff result. */
export async function fetchHistory(teamId: number, cache: Cache, seasons = 6) {
  // Cached whole, so any number of seasons comes from one request.
  const all = await cache.getOrFetch(
    `history_v3_${teamId}`,
    async () => {
      const j = await statsGet("teamyearbyyearstats", {
        TeamID: teamId, LeagueID: "00", PerMode: "PerGame", SeasonType: "Regular Season",
      });
      return resultSet(j).map((r) => {
        const finals = str(r.NBA_FINALS_APPEARANCE).toUpperCase();
        return {
          season: str(r.YEAR),
          wins: int(r.WINS),
          losses: int(r.LOSSES),
          win_pct: round(num(r.WIN_PCT), 3),
          pts: round(num(r.PTS), 1),
          reb: round(num(r.REB), 1),
          ast: round(num(r.AST), 1),
          fg_pct: round(num(r.FG_PCT) * 100, 1),
          fg3_pct: round(num(r.FG3_PCT) * 100, 1),
          ft_pct: round(num(r.FT_PCT) * 100, 1),
          conf_rank: intOrNull(r.CONF_RANK) || null,
          playoffs: int(r.PO_WINS) + int(r.PO_LOSSES) ? `${int(r.PO_WINS)}-${int(r.PO_LOSSES)}` : null,
          finals: finals.includes("CHAMPION") ? "champion" : finals.includes("FINALS") ? "finals" : null,
        };
      });
    },
    { fallback: [] },
  );
  return all.slice(-seasons);
}
export type HistoryRow = Awaited<ReturnType<typeof fetchHistory>>[number];

// ── Roster / players ─────────────────────────────────────────────────────────

/** One roster entry; `r` is the player's LeagueDashPlayerStats row, or null
 *  for a rostered player who hasn't played (injured, just signed…). */
function rosterRow(pid: number, name: string, pos: string, acquired: string, r: Row | undefined) {
  const stat = (col: string, scale = 1) => (r ? round(num(r[col]) * scale, 1) : 0.0);
  return {
    pid,
    name,
    pos,
    acquired, // "Traded from SAC on 02/08/22", or ""
    gp: r ? int(r.GP) : 0,
    mpg: stat("MIN"),
    ppg: stat("PTS"),
    rpg: stat("REB"),
    apg: stat("AST"),
    spg: stat("STL"),
    bpg: stat("BLK"),
    fg_pct: stat("FG_PCT", 100),
    fg3_pct: stat("FG3_PCT", 100),
    plus_minus: stat("PLUS_MINUS"),
  };
}
export type RosterRow = ReturnType<typeof rosterRow>;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Everyone on the team's roster, whether or not they've played (injured
 *  players included), plus anyone with 3+ games for the team that season who
 *  has since left (traded, waived). */
export function fetchRoster(teamId: number, season: string, cache: Cache): Promise<RosterRow[]> {
  return cache.getOrFetch(
    `roster_v5_${teamId}_${season}`,
    async () => {
      const j = await statsGet(
        "leaguedashplayerstats",
        dashParams(season, "Base", {
          TeamID: teamId, College: "", Country: "", DraftPick: "", DraftYear: "", Height: "", Weight: "",
        }),
      );
      const rows = resultSet(j);
      const stats = new Map(rows.map((r) => [int(r.PLAYER_ID), r]));
      let listed = new Map<number, [string, string, string]>();
      try {
        const rj = await statsGet("commonteamroster", { TeamID: teamId, Season: season, LeagueID: "00" });
        listed = new Map(
          resultSet(rj).map((r) => [int(r.PLAYER_ID), [str(r.PLAYER), text(r.POSITION), text(r.HOW_ACQUIRED)]]),
        );
      } catch (e) {
        console.info("team roster unavailable, using stats only:", e);
      }
      const players = [...listed].map(([pid, [name, pos, acq]]) => rosterRow(pid, name, pos, acq, stats.get(pid)));
      // 3+ games filters garbage-time cameos, but early in a season nobody
      // has 3 yet — scale the bar to how many games the team has played.
      const minGp = Math.max(1, Math.min(3, rows.length ? Math.max(...rows.map((r) => int(r.GP))) : 0));
      for (const [pid, r] of stats) {
        if (!listed.has(pid) && int(r.GP) >= minGp) players.push(rosterRow(pid, str(r.PLAYER_NAME), "", "", r));
      }
      players.sort((a, b) => b.mpg - a.mpg);
      return players;
    },
    { ttl: seasonTtl(season), fallback: [] },
  );
}

/** Advanced player stats for a whole team in one call:
 *  {player_id: {ts, efg, usg, ast_pct, ast_to, pie}} (fractions as-is). */
export function fetchPlayerAdvanced(teamId: number, season: string, cache: Cache) {
  return cache.getOrFetch<Record<string, Record<string, number>>>(
    `padv_${teamId}_${season}`,
    async () => {
      const j = await statsGet(
        "leaguedashplayerstats",
        dashParams(season, "Advanced", {
          TeamID: teamId, College: "", Country: "", DraftPick: "", DraftYear: "", Height: "", Weight: "",
        }),
      );
      const out: Record<string, Record<string, number>> = {};
      for (const r of resultSet(j)) {
        out[String(int(r.PLAYER_ID))] = {
          ts: num(r.TS_PCT), efg: num(r.EFG_PCT), usg: num(r.USG_PCT),
          ast_pct: num(r.AST_PCT), ast_to: num(r.AST_TO), pie: num(r.PIE),
        };
      }
      return out;
    },
    { ttl: seasonTtl(season), fallback: {} },
  );
}

/** "6-8" -> 80; null when unknown. */
export function heightInches(s: unknown): number | null {
  const [ft, inch] = String(s ?? "").split("-");
  const f = /^\s*\d+\s*$/.test(ft) ? parseInt(ft, 10) : NaN;
  if (Number.isNaN(f)) return null;
  if (inch === undefined || inch === "") return f * 12;
  const i = /^\s*\d+\s*$/.test(inch) ? parseInt(inch, 10) : NaN;
  return Number.isNaN(i) ? null : f * 12 + i;
}

const intOrNull = (v: unknown) => (/^\s*-?\d+\s*$/.test(String(v ?? "")) ? parseInt(String(v), 10) : null);

/** nba.com's bio for a player: height (inches), weight, birthdate, draft… */
export function fetchPlayerBio(playerId: number, cache: Cache) {
  return cache.getOrFetch<Record<string, any>>(
    `bio_${playerId}`,
    async () => {
      const j = await statsGet("commonplayerinfo", { PlayerID: playerId, LeagueID: "" });
      const r = resultSet(j)[0];
      if (!r) return {};
      return {
        name: str(r.DISPLAY_FIRST_LAST),
        team_id: int(r.TEAM_ID),
        height_in: heightInches(r.HEIGHT),
        weight_lb: intOrNull(r.WEIGHT),
        birthdate: str(r.BIRTHDATE).slice(0, 10) || null,
        country: str(r.COUNTRY),
        school: str(r.SCHOOL),
        position: str(r.POSITION),
        jersey: str(r.JERSEY),
        season_exp: intOrNull(r.SEASON_EXP) || 0,
        from_year: intOrNull(r.FROM_YEAR),
        draft_year: intOrNull(r.DRAFT_YEAR),
        draft_round: intOrNull(r.DRAFT_ROUND),
        draft_pick: intOrNull(r.DRAFT_NUMBER),
      };
    },
    { fallback: {} },
  );
}

/** One draft combine's measurements (inches / lb / %), keyed by player id. */
export function fetchCombine(year: number, cache: Cache) {
  const thisYear = parseInt(currentSeason().slice(0, 4), 10);
  // Past combines never change; this year's fills in over the summer.
  return cache.getOrFetch<Record<string, any>>(
    `anthro_${year}`,
    async () => {
      const j = await statsGet("draftcombineplayeranthro", { LeagueID: "00", SeasonYear: String(year) });
      const out: Record<string, any> = {};
      for (const r of resultSet(j)) {
        out[String(int(r.PLAYER_ID))] = {
          year,
          height_no_shoes: numOrNull(r.HEIGHT_WO_SHOES),
          weight: numOrNull(r.WEIGHT),
          wingspan: numOrNull(r.WINGSPAN),
          standing_reach: numOrNull(r.STANDING_REACH),
          hand_length: numOrNull(r.HAND_LENGTH),
          hand_width: numOrNull(r.HAND_WIDTH),
          body_fat: numOrNull(r.BODY_FAT_PCT),
        };
      }
      return out;
    },
    { ttl: year < thisYear ? null : seasonTtl(currentSeason()), fallback: {} },
  );
}

/** Combine measurements (wingspan, reach, hands) if the player was measured.
 *  Most are measured in their draft year; undrafted players in their rookie
 *  year, and some a year early before going back to school. Data starts in 2000. */
export async function fetchAnthro(playerId: number, bio: Record<string, any>, cache: Cache) {
  const fy: number | null = bio.from_year ?? null;
  const thisYear = parseInt(currentSeason().slice(0, 4), 10);
  const years: number[] = [];
  for (const y of [bio.draft_year, fy, fy ? fy - 1 : null]) {
    if (y && !years.includes(y) && y >= 2000 && y <= thisYear) years.push(y);
  }
  for (const y of years) {
    const hit = (await fetchCombine(y, cache))[String(playerId)];
    if (hit) return hit;
  }
  return null;
}

export interface Shots {
  x: number[];
  y: number[];
  made: number[];
}

/** Shot locations for a player+season as {x, y, made} parallel lists. */
export function fetchShotchart(playerId: number, teamId: number, season: string, cache: Cache): Promise<Shots> {
  return cache.getOrFetch(
    `shots_${playerId}_${season}`,
    async () => {
      const j = await statsGet("shotchartdetail", {
        TeamID: teamId, PlayerID: playerId, ContextMeasure: "FGA", LastNGames: "0",
        LeagueID: "00", Month: "0", OpponentTeamID: 0, Period: "0", SeasonType: "Regular Season",
        AheadBehind: "", ClutchTime: "", ContextFilter: "", DateFrom: "", DateTo: "",
        EndPeriod: "", EndRange: "", GameID: "", GameSegment: "", Location: "", Outcome: "",
        PlayerPosition: "", PointDiff: "", Position: "", RangeType: "", RookieYear: "",
        Season: season, SeasonSegment: "", StartPeriod: "", StartRange: "", VsConference: "",
        VsDivision: "",
      });
      const rows = resultSet(j);
      return {
        x: rows.map((r) => int(r.LOC_X)),
        y: rows.map((r) => int(r.LOC_Y)),
        made: rows.map((r) => int(r.SHOT_MADE_FLAG)),
      };
    },
    { ttl: seasonTtl(season), fallback: { x: [], y: [], made: [] } },
  );
}

/** Most-recent N games for a player (chronological): points and TS%. */
export async function fetchPlayerGamelog(playerId: number, season: string, cache: Cache, n = 10) {
  const games = await cache.getOrFetch(
    `pgl_v2_${playerId}_${season}`,
    async () => {
      const j = await statsGet("playergamelog", {
        PlayerID: playerId, Season: season, SeasonType: "Regular Season", DateFrom: "", DateTo: "", LeagueID: "00",
      });
      const out = resultSet(j).map((r) => {
        const fga = num(r.FGA);
        const fta = num(r.FTA);
        const pts = int(r.PTS);
        const tsa = fga + 0.44 * fta;
        return {
          date: str(r.GAME_DATE),
          matchup: str(r.MATCHUP),
          pts,
          reb: int(r.REB),
          ast: int(r.AST),
          min: num(r.MIN),
          ts: tsa > 0 ? round(pts / (2 * tsa), 3) : 0.0,
        };
      });
      out.reverse(); // game log is newest-first; store chronologically
      return out;
    },
    { ttl: seasonTtl(season), fallback: [] },
  );
  return n ? games.slice(-n) : games;
}

// ── Game logs / scores ───────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** TeamGameLogs returns ISO dates ('2025-04-13T00:00:00'); show 'Apr 13, 2025'. */
export function fmtGameDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  return `${MONTHS[parseInt(m[2], 10) - 1]} ${m[3]}, ${m[1]}`;
}

export interface TeamGame {
  game_id: string;
  iso: string;
  date: string;
  matchup: string;
  wl: string;
  pts: number;
  reb: number;
  ast: number;
  fg_pct: number;
  plus_minus: number;
}

/** Team's games for a season+type, newest first, with box-score basics.
 *  Uses TeamGameLogs (plural), which carries PLUS_MINUS. */
export async function fetchGamelog(teamId: number, season: string, cache: Cache, n = 15, seasonType: SeasonType = SEASON_TYPE_REGULAR) {
  const games = await cache.getOrFetch<TeamGame[]>(
    `games_v3_${teamId}_${season}_${seasonType}`,
    async () => {
      const j = await statsGet("teamgamelogs", {
        DateFrom: "", DateTo: "", GameSegment: "", LastNGames: "", LeagueID: "00",
        Location: "", Month: "", Outcome: "", PORound: "", PerMode: "", Period: "",
        PlayerID: "", Season: season, SeasonSegment: "", SeasonType: seasonType,
        ShotClockRange: "", TeamID: teamId, VsConference: "", VsDivision: "",
      });
      return resultSet(j).map((r) => ({
        game_id: str(r.GAME_ID),
        iso: str(r.GAME_DATE).slice(0, 10),
        date: fmtGameDate(str(r.GAME_DATE)),
        matchup: str(r.MATCHUP),
        wl: str(r.WL),
        pts: int(r.PTS),
        reb: int(r.REB),
        ast: int(r.AST),
        fg_pct: round(num(r.FG_PCT) * 100, 1),
        plus_minus: round(num(r.PLUS_MINUS), 1),
      }));
    },
    { ttl: seasonTtl(season), fallback: [] },
  );
  return n ? games.slice(0, n) : games;
}

export interface FullGame {
  game_id: string;
  date: string;
  matchup: string;
  wl: string;
  pts: number;
  po?: boolean;
}

/** Full-season game log including Game_ID, so two teams' logs can be joined to
 *  recover both scores (TeamGameLog only carries the queried team's PTS). */
export function fetchFullGamelog(teamId: number, season: string, cache: Cache, seasonType: SeasonType = SEASON_TYPE_REGULAR): Promise<FullGame[]> {
  return cache.getOrFetch(
    `fullgames_${teamId}_${season}_${seasonType}`,
    async () => {
      const j = await statsGet("teamgamelog", {
        TeamID: teamId, Season: season, SeasonType: seasonType, DateFrom: "", DateTo: "", LeagueID: "00",
      });
      return resultSet(j).map((r) => ({
        game_id: str(r.Game_ID),
        date: str(r.GAME_DATE),
        matchup: str(r.MATCHUP),
        wl: str(r.WL),
        pts: int(r.PTS),
      }));
    },
    { ttl: seasonTtl(season), fallback: [] },
  );
}

interface LeagueSide {
  team_id: number;
  abbr: string;
  pts: number;
}
export interface LeagueGame {
  game_id: string;
  date: string;
  ot: boolean;
  home?: LeagueSide;
  away?: LeagueSide;
}

/** Every completed league game for a season+type, one record per game, newest
 *  first. LeagueGameLog's two per-team rows are joined on GAME_ID. */
export function fetchLeagueScoreboard(season: string, cache: Cache, seasonType: SeasonType = SEASON_TYPE_REGULAR): Promise<LeagueGame[]> {
  // completed games accrue nightly during the season — refresh hourly
  const ttl = season === currentSeason() ? 3600 : PAST_SEASON_TTL;
  return cache.getOrFetch(
    `lgl_v2_${season}_${seasonType}`,
    async () => {
      const j = await statsGet(
        "leaguegamelog",
        {
          Counter: 0, Direction: "ASC", LeagueID: "00", PlayerOrTeam: "T", Season: season,
          SeasonType: seasonType, Sorter: "DATE", DateFrom: "", DateTo: "",
        },
        45,
      );
      const byId = new Map<string, LeagueGame>();
      for (const r of resultSet(j)) {
        if (!str(r.WL).trim()) continue; // in-progress game — skip
        const gid = str(r.GAME_ID);
        let g = byId.get(gid);
        if (!g) {
          g = { game_id: gid, date: str(r.GAME_DATE), ot: false };
          byId.set(gid, g);
        }
        const side = str(r.MATCHUP).includes("vs.") ? "home" : "away";
        g[side] = { team_id: int(r.TEAM_ID), abbr: str(r.TEAM_ABBREVIATION), pts: int(r.PTS) };
        // MIN is team minutes: 240 = regulation, 265+ = overtime
        if (num(r.MIN, 240) > 245) g.ot = true;
      }
      // 0-0 rows are scheduled/postponed placeholders, not finished games
      const games = [...byId.values()].filter((g) => g.home && g.away && g.home.pts + g.away.pts > 0);
      games.sort((a, b) => (a.date === b.date ? b.game_id.localeCompare(a.game_id) : b.date.localeCompare(a.date)));
      return games;
    },
    { ttl, fallback: [] },
  );
}

export interface GameLeader {
  category: "PTS" | "REB" | "AST";
  player: string;
  value: string;
}

export interface EspnSide {
  espn_id: number;
  app_name: string;
  abbr: string;
  short: string;
  score: string;
  record: string;
  /** This side's points/rebounds/assists leaders (scoreboards only). */
  leaders?: GameLeader[];
}

const LEADER_CATS: Record<string, GameLeader["category"]> = { points: "PTS", rebounds: "REB", assists: "AST" };

/** A scoreboard competitor's leaders; ESPN shapes vary, so anything missing is skipped. */
export function espnLeaders(c: any): GameLeader[] {
  const out: GameLeader[] = [];
  for (const l of Array.isArray(c?.leaders) ? c.leaders : []) {
    const category = LEADER_CATS[String(l?.name ?? l?.displayName ?? "").toLowerCase()];
    const top = l?.leaders?.[0];
    const player = top?.athlete?.displayName ?? top?.athlete?.fullName ?? "";
    if (category && player && !out.some((x) => x.category === category)) out.push({ category, player, value: String(top?.displayValue ?? top?.value ?? "") });
  }
  return out;
}

function espnSide(c: any): EspnSide {
  const t = c?.team ?? {};
  const tid = int(t.id);
  const rec = c?.records?.length ? c.records : [{}];
  return {
    espn_id: tid,
    app_name: ESPN_ID_TO_NAME[tid] ?? t.displayName ?? "",
    abbr: t.abbreviation ?? "",
    short: t.shortDisplayName ?? "",
    score: String(c?.score ?? "0"),
    record: (rec[0] ?? {}).summary ?? "",
    leaders: espnLeaders(c),
  };
}

const ymd = (d: Date) => localIsoDate(d).replaceAll("-", "");

export interface UpcomingGame {
  id: string;
  date_utc: string;
  stype: number;
  away: EspnSide;
  home: EspnSide;
}

/** Scheduled (not yet tipped) games over the next `days` days from ESPN,
 *  soonest first. stype is ESPN's season type: 2 = regular, 3 = playoffs. */
export function fetchUpcomingGames(cache: Cache, days = UPCOMING_DAYS): Promise<UpcomingGame[]> {
  const today = new Date();
  const dayEvents = async (day: Date) =>
    ((await getJson(ESPN_SCOREBOARD_URL, { params: { dates: ymd(day) }, timeout: 20, retries: 1 })).events ?? []) as any[];
  return cache.getOrFetch(
    `upcoming_v3_${localIsoDate(today)}_${days}`,
    async () => {
      // ESPN rejects date-range queries (HTTP 400 as of Oct 2026), so fetch
      // each day in parallel. Any failed day aborts so a partial schedule
      // isn't cached.
      const dates = Array.from({ length: days + 1 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
      // A few days at a time: fifteen at once is a burst ESPN may refuse.
      const events: any[] = [];
      for (let i = 0; i < dates.length; i += 3) events.push(...(await Promise.all(dates.slice(i, i + 3).map(dayEvents))).flat());
      const games: UpcomingGame[] = [];
      for (const ev of events) {
        try {
          if (ev.status.type.state !== "pre") continue;
          const cs = ev.competitions[0].competitors as any[];
          const home = cs.find((x) => x.homeAway === "home");
          const away = cs.find((x) => x.homeAway === "away");
          if (!home || !away) continue;
          games.push({
            id: String(ev.id ?? ""),
            date_utc: ev.date ?? "",
            stype: int(ev.season?.type, 2),
            away: espnSide(away),
            home: espnSide(home),
          });
        } catch {
          continue;
        }
      }
      games.sort((a, b) => a.date_utc.localeCompare(b.date_utc));
      return games;
    },
    { ttl: 3600, fallback: [] },
  );
}

/** Hollinger Game Score from a BoxScoreTraditionalV3 statistics dict. */
function gameScore(st: Record<string, unknown>) {
  const f = (k: string) => num(st[k]);
  return (
    f("points") + 0.4 * f("fieldGoalsMade") - 0.7 * f("fieldGoalsAttempted") -
    0.4 * (f("freeThrowsAttempted") - f("freeThrowsMade")) + 0.7 * f("reboundsOffensive") +
    0.3 * f("reboundsDefensive") + f("steals") + 0.7 * f("assists") + 0.7 * f("blocks") -
    0.4 * f("foulsPersonal") - f("turnovers")
  );
}

/** Single-game 'Game Story': quarter line scores, per-player Game Scores and
 *  venue trivia (V3 endpoints). Final games never change -> no TTL. */
export async function fetchGameBreakdown(gameId: string, cache: Cache) {
  const key = `gbd_${gameId}`;
  const hit = await cache.get<any>(key, null);
  if (hit && Object.keys(hit).length) return hit;
  const out: any = { home: {}, away: {} };
  try {
    const s = (await statsGet("boxscoresummaryv3", { GameID: gameId })).boxScoreSummary ?? {};
    for (const side of ["home", "away"]) {
      const t = s[`${side}Team`] ?? {};
      out[side] = {
        abbr: t.teamTricode ?? "",
        team_id: int(t.teamId),
        score: int(t.score),
        periods: (t.periods ?? []).map((p: any) => int(p.score)),
      };
    }
    const arena = s.arena ?? {};
    out.arena = [arena.arenaName ?? "", arena.arenaCity ?? ""].filter(Boolean).join(", ");
    out.attendance = int(s.attendance);
    out.officials = (s.officials ?? []).map((o: any) => o.name ?? "");
    out.label = [str(s.gameLabel), str(s.gameSubLabel)].filter(Boolean).join("  ·  ");
    out.series = str(s.seriesText);
  } catch (ex) {
    console.warn(`game summary ${gameId}:`, ex);
  }
  try {
    const t = (await statsGet("boxscoretraditionalv3", {
      GameID: gameId, EndPeriod: "0", EndRange: "0", RangeType: "0", StartPeriod: "0", StartRange: "0",
    })).boxScoreTraditional ?? {};
    // The full box rides along for free: hold it for the Box score tab.
    boxMemo.set(`nba_${gameId}`, parseNbaBox(t), BOX_FINAL_TTL);
    for (const side of ["home", "away"]) {
      const players = [];
      for (const p of t[`${side}Team`]?.players ?? []) {
        const st = p.statistics ?? {};
        if (!st.minutes) continue; // DNP
        players.push({
          pid: int(p.personId),
          name: `${p.firstName ?? ""} ${p.familyName ?? ""}`.trim(),
          min: str(st.minutes),
          pts: int(st.points),
          reb: int(st.reboundsTotal),
          ast: int(st.assists),
          stl: int(st.steals),
          blk: int(st.blocks),
          pm: int(st.plusMinusPoints),
          gmsc: round(gameScore(st), 1),
        });
      }
      players.sort((a, b) => b.gmsc - a.gmsc);
      out[side].players = players;
    }
  } catch (ex) {
    console.warn(`game boxscore ${gameId}:`, ex);
  }
  if (out.home.periods?.length || out.home.players?.length) await cache.set(key, out);
  return out;
}

// ── Full box scores ──────────────────────────────────────────────────────────
// Held in memory only, while someone's looking. Finals stay long enough for
// tab-switching and reopening; live boxes just long enough that Game Pulse and
// the box drawer polling together cost one ESPN call.

const BOX_FINAL_TTL = 10 * 60;
const BOX_LIVE_TTL = 10;
const boxMemo = new Memo<any>(24);
const summaryMemo = new Memo<any>(4); // raw ESPN summaries are ~500 KB each

const BOX_FIELDS = ["pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "reb", "ast", "stl", "blk", "tov", "pf", "pm"];

function v3Stats(st: Record<string, unknown>) {
  const g = (k: string) => Math.trunc(num(st[k]));
  return {
    pts: g("points"), fgm: g("fieldGoalsMade"), fga: g("fieldGoalsAttempted"),
    tpm: g("threePointersMade"), tpa: g("threePointersAttempted"),
    ftm: g("freeThrowsMade"), fta: g("freeThrowsAttempted"),
    oreb: g("reboundsOffensive"), dreb: g("reboundsDefensive"), reb: g("reboundsTotal"),
    ast: g("assists"), stl: g("steals"), blk: g("blocks"), tov: g("turnovers"),
    pf: g("foulsPersonal"), pm: g("plusMinusPoints"),
  };
}

/** Normalized full box from a BoxScoreTraditionalV3 'boxScoreTraditional'. */
export function parseNbaBox(t: any) {
  const sides: Record<string, unknown> = {};
  for (const side of ["away", "home"]) {
    const tm = t?.[`${side}Team`] ?? {};
    const players = (tm.players ?? []).map((p: any) => {
      const st = p.statistics ?? {};
      const played = !!st.minutes;
      return {
        pid: int(p.personId),
        name: `${p.firstName ?? ""} ${p.familyName ?? ""}`.trim(),
        pos: p.position ?? "",
        starter: !!p.position, // nba.com gives only starters a position
        min: String(st.minutes ?? "").split(".")[0],
        dnp: played ? "" : p.comment || "Did not play",
        ...v3Stats(st),
      };
    });
    sides[side] = { abbr: tm.teamTricode ?? "", team_id: int(tm.teamId), players, totals: v3Stats(tm.statistics ?? {}) };
  }
  return { source: "nba", final: true, ...sides };
}

const ESPN_SINGLE: Record<string, string> = {
  points: "pts", rebounds: "reb", assists: "ast", turnovers: "tov", steals: "stl", blocks: "blk",
  offensiveRebounds: "oreb", defensiveRebounds: "dreb", fouls: "pf", plusMinus: "pm",
};
const ESPN_PAIRS: Record<string, [string, string]> = {
  "fieldGoalsMade-fieldGoalsAttempted": ["fgm", "fga"],
  "threePointFieldGoalsMade-threePointFieldGoalsAttempted": ["tpm", "tpa"],
  "freeThrowsMade-freeThrowsAttempted": ["ftm", "fta"],
};

const espnInt = (v: unknown) => {
  const s = String(v ?? "").replace("+", "").trim();
  return /^-?\d+$/.test(s) ? parseInt(s, 10) : 0;
};

/** (minutes, stats) from one ESPN box row: parallel `keys` and string `values`. */
function espnStats(keys: string[], values: unknown[]): [string, Record<string, number>] {
  const out: Record<string, number> = Object.fromEntries(BOX_FIELDS.map((f) => [f, 0]));
  let minutes = "";
  keys.forEach((k, i) => {
    if (i >= values.length) return;
    const v = values[i];
    if (k === "minutes") minutes = (v as string) || "";
    else if (k in ESPN_PAIRS) {
      const [made, att = ""] = String(v).split("-");
      out[ESPN_PAIRS[k][0]] = espnInt(made);
      out[ESPN_PAIRS[k][1]] = espnInt(att);
    } else if (k in ESPN_SINGLE) out[ESPN_SINGLE[k]] = espnInt(v);
  });
  return [minutes, out];
}

/** Python's string.capwords. */
const capwords = (s: string) => s.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

/** Normalized full box from an ESPN game summary (any state: live boxes fill in). */
export function parseEspnBox(j: any) {
  const comp = j?.header?.competitions?.[0] ?? {};
  const state: string = comp.status?.type?.state ?? "";
  const where: Record<string, string> = {};
  const scores: Record<string, number> = {};
  for (const c of comp.competitors ?? []) {
    where[String(c.team?.id)] = c.homeAway;
    scores[c.homeAway] = espnInt(c.score || 0);
  }
  const out: any = { source: "espn", final: state === "post", state };
  for (const tm of j?.boxscore?.players ?? []) {
    const team = tm.team ?? {};
    const side = where[String(team.id)];
    if (side !== "home" && side !== "away") continue;
    const st = tm.statistics?.[0] ?? {};
    const keys: string[] = st.keys ?? [];
    const players = (st.athletes ?? []).map((a: any) => {
      const ath = a.athlete ?? {};
      const [minutes, stats] = espnStats(keys, a.stats ?? []);
      const dnp = a.didNotPlay || !a.stats?.length;
      return {
        pid: 0,
        espn_id: String(ath.id ?? ""),
        name: ath.displayName ?? "",
        pos: ath.position?.abbreviation ?? "",
        starter: !!a.starter,
        min: minutes,
        // ESPN shouts ("COACH'S DECISION"); capwords leaves "Coach's" alone
        dnp: dnp ? capwords(String(a.reason || "Did not play").toLowerCase()) : "",
        ...stats,
      };
    });
    const [, totals] = espnStats(keys, st.totals ?? []);
    out[side] = { abbr: team.abbreviation ?? "", score: scores[side] ?? 0, players, totals };
  }
  return out;
}

/** Full box for an nba.com game id (finished games: Scores, Overview, Compare). */
export async function fetchNbaBox(gameId: string) {
  const key = `nba_${gameId}`;
  const hit = boxMemo.get(key);
  if (hit) return hit;
  const t = (await statsGet("boxscoretraditionalv3", {
    GameID: gameId, EndPeriod: "0", EndRange: "0", RangeType: "0", StartPeriod: "0", StartRange: "0",
  })).boxScoreTraditional;
  const box = parseNbaBox(t);
  boxMemo.set(key, box, BOX_FINAL_TTL);
  return box;
}

/** Full box for an ESPN event id, live or final. */
export async function fetchEspnBox(eventId: string | number) {
  const key = `espn_${eventId}`;
  const hit = boxMemo.get(key);
  if (hit) return hit;
  const box = parseEspnBox(await fetchEspnSummary(eventId));
  boxMemo.set(key, box, box.final ? BOX_FINAL_TTL : BOX_LIVE_TTL);
  return box;
}

// ── ESPN live / news ─────────────────────────────────────────────────────────

/** Today's date (YYYYMMDD) on the NBA's Eastern-time calendar. ESPN's undated
 *  scoreboard keeps showing the previous slate well into the morning, so ask
 *  for the day explicitly. */
export function nbaToday(now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    return parts.replaceAll("-", "");
  } catch {
    return ymd(new Date(now.getTime() - 5 * 3600_000));
  }
}

export interface LiveGame {
  id: string;
  state: string;
  status_text: string;
  date_utc: string;
  period: number;
  clock: string;
  broadcast: string;
  /** ESPN season type: 1 preseason, 2 regular, 3 playoffs, 5 play-in. */
  stype: number;
  home: EspnSide;
  away: EspnSide;
  /** The betting line when ESPN has one ("BOS -4.5", 221.5). */
  odds: { details: string; over_under: number | null } | null;
}

function espnOdds(comp: any): LiveGame["odds"] {
  const o = comp?.odds?.[0];
  const details = typeof o?.details === "string" ? o.details.trim() : "";
  const ou = Number(o?.overUnder);
  if (!details && !Number.isFinite(ou)) return null;
  return { details, over_under: Number.isFinite(ou) && ou > 0 ? ou : null };
}

export function parseScoreboard(j: any) {
  const games: LiveGame[] = [];
  for (const ev of j?.events ?? []) {
    try {
      const comp = ev.competitions[0];
      const status = ev.status;
      const stype = status.type;
      const cs = comp.competitors as any[];
      const home = cs.find((c) => c.homeAway === "home");
      const away = cs.find((c) => c.homeAway === "away");
      if (!home || !away) continue;
      games.push({
        id: String(ev.id ?? ""),
        state: stype.state ?? "", // pre / in / post
        status_text: stype.shortDetail ?? "",
        date_utc: ev.date ?? "",
        period: int(status.period),
        clock: status.displayClock ?? "",
        broadcast: (comp.broadcasts ?? []).flatMap((b: any) => b.names ?? []).join(", "),
        stype: int(ev.season?.type, 2),
        home: espnSide(home),
        away: espnSide(away),
        odds: espnOdds(comp),
      });
    } catch {
      continue;
    }
  }
  return { date: j?.day?.date ?? "", season_year: j?.season?.year ?? null, games };
}
export type Scoreboard = ReturnType<typeof parseScoreboard>;

// Live, the ticker, tonight's finals, the alerts engine and the AI all read
// the scoreboard; they share one request per date. A finished day never
// changes, so it's kept on the device.
const BOARD_LIVE_TTL = 15;
const BOARD_TTL = 60;
const BOARD_DONE_TTL = 30 * 86400;
const boardMemo = new Memo<Scoreboard>(40);
const boardInflight = new Map<string, Promise<Scoreboard>>();

/** Tests start each case without remembered scoreboards. */
export function clearScoreboards() {
  boardMemo.clear();
  boardInflight.clear();
}

/** A day's raw scoreboard. ESPN has served a single date broken (empty or cut
 *  off) while the days around it were fine, so a broken answer is asked for
 *  again in other forms: with an extra parameter (a different cached copy at
 *  ESPN), then from ESPN's other API host. */
async function boardJson(day: string) {
  const tries: [string, Record<string, string>][] = [
    [ESPN_SCOREBOARD_URL, { dates: day }],
    [ESPN_SCOREBOARD_URL, { dates: day, limit: "200" }],
    [ESPN_SCOREBOARD_URL.replace("//site.api.", "//site.web.api."), { dates: day }],
  ];
  let first: unknown;
  for (const [url, params] of tries) {
    try {
      return await getJson(url, { params, timeout: 15 });
    } catch (e) {
      first ??= e;
      // only a broken answer is worth another form; a timeout or a refusal isn't
      if (!(e instanceof HttpError && e.status === 502)) throw e;
    }
  }
  throw first;
}

/** Today's (or `date` YYYYMMDD) NBA slate from ESPN. */
export function fetchScoreboard(date?: string | null): Promise<Scoreboard> {
  const day = date || nbaToday();
  const hit = boardMemo.get(day);
  if (hit) return Promise.resolve(hit);
  const running = boardInflight.get(day);
  if (running) return running;
  const past = day < nbaToday();
  const key = `scoreboard_${day}`;
  const p = (async () => {
    if (past) {
      const kept = await appCache.get<Scoreboard>(key, BOARD_DONE_TTL).catch(() => undefined);
      if (kept) {
        boardMemo.set(day, kept, BOARD_DONE_TTL);
        return kept;
      }
    }
    const sb = parseScoreboard(await boardJson(day));
    const done = past && sb.games.length > 0 && sb.games.every((g) => g.state === "post");
    boardMemo.set(day, sb, done ? BOARD_DONE_TTL : sb.games.some((g) => g.state === "in") ? BOARD_LIVE_TTL : BOARD_TTL);
    if (done) await appCache.set(key, sb).catch(() => {});
    return sb;
  })().finally(() => boardInflight.delete(day));
  boardInflight.set(day, p);
  return p;
}

// ── Recent finals (ESPN is minutes behind a final; nba.com's logs can be hours) ──

export interface FinalSide {
  nba_id: number;
  abbr: string; // nba.com tricode, as in MATCHUP strings
  pts: number;
  record: string;
}

export interface RecentFinal {
  espn_id: string;
  /** The game's date on the NBA's Eastern calendar (YYYY-MM-DD), like nba.com logs. */
  iso: string;
  date_utc: string;
  stype: number;
  period: number;
  home: FinalSide;
  away: FinalSide;
}

const finalsMemo = new Memo<RecentFinal[]>(2);

/** Tests start each case without the minute-long memo. */
export const clearRecentFinals = () => finalsMemo.set("recent", [], -1);

const yyyymmddToIso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

/** Games ESPN has as Final on the NBA's today and yesterday. Held for a minute so
 *  Overview, Scores and the Live poll share the calls. */
export async function fetchRecentFinals(now = new Date()): Promise<RecentFinal[]> {
  const hit = finalsMemo.get("recent");
  if (hit) return hit;
  const days = [nbaToday(now), nbaToday(new Date(now.getTime() - 86400_000))];
  const boards = await Promise.all(days.map((d) => fetchScoreboard(d)));
  const out: RecentFinal[] = [];
  boards.forEach((b, i) => {
    for (const g of b.games) {
      if (g.state !== "post") continue;
      const side = (s: EspnSide): FinalSide | null => {
        const id = getTeamId(ESPN_ID_TO_NAME[s.espn_id] ?? "");
        return id ? { nba_id: id, abbr: getTeamAbbr(id), pts: int(s.score), record: s.record } : null;
      };
      const home = side(g.home);
      const away = side(g.away);
      if (home && away) out.push({ espn_id: g.id, iso: yyyymmddToIso(days[i]), date_utc: g.date_utc, stype: g.stype, period: g.period, home, away });
    }
  });
  finalsMemo.set("recent", out, 60);
  return out;
}

/** Raw ESPN game summary (box score, plays, win probability). Held a few
 *  seconds so a live game's Pulse and box polls share one request. */
export async function fetchEspnSummary(eventId: string | number): Promise<any> {
  const key = String(eventId);
  const hit = summaryMemo.get(key);
  if (hit) return hit;
  const j = await getJson(ESPN_SUMMARY_URL, { params: { event: eventId }, timeout: 15 });
  summaryMemo.set(key, j, BOX_LIVE_TTL);
  return j;
}

/** Team totals from an ESPN summary, keyed by 'home'/'away' (Game Pulse). */
export function parseBoxscore(j: any) {
  const out: Record<string, Record<string, string>> = {};
  for (const tm of j?.boxscore?.teams ?? []) {
    const sm: Record<string, string> = {};
    for (const s of tm.statistics ?? []) sm[s.name] = s.displayValue;
    const g = (k: string) => sm[k] ?? "-";
    out[tm.homeAway] = {
      abbr: tm.team?.abbreviation ?? "",
      fg: g("fieldGoalsMade-fieldGoalsAttempted"),
      fg_pct: g("fieldGoalPct"),
      tp: g("threePointFieldGoalsMade-threePointFieldGoalsAttempted"),
      tp_pct: g("threePointFieldGoalPct"),
      ft: g("freeThrowsMade-freeThrowsAttempted"),
      reb: g("totalRebounds"),
      ast: g("assists"),
      stl: g("steals"),
      blk: g("blocks"),
      tov: g("totalTurnovers"),
    };
  }
  return out;
}

/** Latest ESPN news for a team (or the league when teamName is empty). */
export function fetchNews(teamName: string, cache: Cache) {
  return cache.getOrFetch(
    `news_v2_${teamName}`,
    async () => {
      const espnId = ESPN_IDS[teamName];
      const j = await getJson(ESPN_NEWS_URL, { params: { limit: 20, team: espnId ?? null }, timeout: 10 });
      return ((j.articles ?? []) as any[]).slice(0, 12).map((item) => ({
        headline: item.headline ?? "",
        description: item.description ?? "",
        published: String(item.published ?? "").slice(0, 10),
        byline: item.byline ?? "ESPN",
        link: item.links?.web?.href ?? "",
      }));
    },
    { ttl: 3600, fallback: [] },
  );
}

// ── Web search / AI context ──────────────────────────────────────────────────

export interface Hit {
  title: string;
  body: string;
  href: string;
}

const parseHtml = (html: string) => new DOMParser().parseFromString(html, "text/html");

/** DDG wraps results as //duckduckgo.com/l/?uddg=<encoded url>. */
export function ddgRealUrl(href: string): string {
  const m = /[?&]uddg=([^&]+)/.exec(href);
  return m ? decodeURIComponent(m[1]) : href;
}

/** Bing sometimes wraps results as bing.com/ck/a?...&u=a1<base64url of the real url>. */
export function bingUrl(href: string): string {
  if (!href.startsWith("https://www.bing.com/ck/a?")) return href;
  const u = /[?&]u=([^&]+)/.exec(href)?.[1];
  if (!u || u.length <= 2) return href;
  try {
    const b64 = u.slice(2).replace(/-/g, "+").replace(/_/g, "/");
    return atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  } catch {
    return href;
  }
}

export function parseDdg(html: string): Hit[] {
  const out: Hit[] = [];
  for (const r of parseHtml(html).querySelectorAll(".result")) {
    const a = r.querySelector(".result__a");
    if (!a || r.classList.contains("result--ad")) continue;
    const hit = {
      title: (a.textContent ?? "").trim(),
      body: (r.querySelector(".result__snippet")?.textContent ?? "").trim(),
      href: ddgRealUrl(a.getAttribute("href") ?? ""),
    };
    if (hit.title || hit.body) out.push(hit);
  }
  return out;
}

export function parseBing(html: string): Hit[] {
  const out: Hit[] = [];
  for (const r of parseHtml(html).querySelectorAll("li.b_algo")) {
    const a = r.querySelector("h2 a");
    if (!a) continue;
    const href = bingUrl(a.getAttribute("href") ?? "");
    if (href.startsWith("https://www.bing.com/aclick?")) continue; // ad
    const hit = { title: (a.textContent ?? "").trim(), body: (r.querySelector("p")?.textContent ?? "").trim(), href };
    if (hit.title || hit.body) out.push(hit);
  }
  return out;
}

/** Keyless web hits: DuckDuckGo's HTML endpoint, falling back to Bing (the
 *  desktop's `ddgs` rotates engines the same way). [] on any failure. */
export async function webHits(query: string, maxResults = WEB_SEARCH_RESULTS): Promise<Hit[]> {
  try {
    const hits = parseDdg(await getText("https://html.duckduckgo.com/html/", { params: { q: query }, timeout: 12 }));
    if (hits.length) return hits.slice(0, maxResults);
  } catch (e) {
    console.warn(`web search (ddg) ${query}:`, e);
  }
  // DDG answers suspected bots with an "anomaly" page and no results.
  try {
    return parseBing(await getText("https://www.bing.com/search", { params: { q: query, pq: query, cc: "en" }, timeout: 12 })).slice(0, maxResults);
  } catch (e) {
    console.warn(`web search (bing) ${query}:`, e);
    return [];
  }
}

/** (text, count): a snippet block for prompt injection and how many hits it holds. */
export async function webSearch(query: string, maxResults = WEB_SEARCH_RESULTS): Promise<[string, number]> {
  const hits = await webHits(query, maxResults);
  const lines = hits.map((h) => `- ${h.title}\n  ${h.body}\n  (${h.href})`);
  return [lines.join("\n"), lines.length];
}

const ABSENCE_WORDS =
  /injur|tear\b|torn|ruptur|surgery|achilles|\bacl\b|fracture|sidelined|out for|miss(ed|es|ing)?\b|holdout|did not play|rehab|recover/gi;
const hasAbsence = (s: string) => new RegExp(ABSENCE_WORDS.source, "i").test(s);
const countAbsence = (s: string) => (s.match(ABSENCE_WORDS) ?? []).length;

function lastName(name: string) {
  return [...name.split(/\s+/)].reverse().find((w) => !["jr", "sr", "ii", "iii", "iv"].includes(w.toLowerCase().replace(/\./g, ""))) ?? name;
}

/** "2021-22", Wikipedia's "2021–22" and "2021-2022" all count. */
function seasonRe(season: string) {
  const start = season.slice(0, 4);
  return new RegExp(`${start}\\s*[-–—]\\s*(${season.slice(-2)}|${parseInt(start, 10) + 1})\\b`);
}

/** Keep the snippet's sentences about the player, the season or an absence,
 *  dropping page furniture around them. Nothing qualifies: keep it all. */
export function trimNote(text: string, name: string, season: string): string {
  const last = lastName(name).toLowerCase();
  const sre = seasonRe(season);
  const kept = text.split(/(?<=[.!?…])\s+/).filter((s) => s.toLowerCase().includes(last) || sre.test(s) || hasAbsence(s));
  return kept.join(" ") || text;
}

/** Why a player missed a whole season, from the web: {text, title, source, url}
 *  for the hit that names the player and the season and says the most about an
 *  absence, else {}. */
export async function fetchAbsenceNote(name: string, season: string, cache: Cache) {
  const last = lastName(name);
  const sre = seasonRe(season);
  const note = await cache.getOrFetch<Record<string, string>>(
    `absence_${name}_${season}`,
    async () => {
      for (const query of [`${name} ${season} season missed entire season injury`, `${name} out for ${season} season`]) {
        const scored: [number, Hit][] = [];
        for (const h of await webHits(query)) {
          const blob = `${h.title} ${h.body}`;
          const words = countAbsence(blob);
          if (blob.toLowerCase().includes(last.toLowerCase()) && sre.test(blob) && words) scored.push([words, h]);
        }
        if (scored.length) {
          const h = scored.reduce((a, b) => (b[0] > a[0] ? b : a))[1];
          const body = trimNote(h.body, name, season);
          let source = "";
          try {
            source = new URL(h.href).host.replace(/^www\./, "");
          } catch {
            /* not a URL */
          }
          return {
            text: body.length > 280 ? body.slice(0, 280).replace(/\s+\S*$/, "") + "…" : body,
            title: h.title,
            source,
            url: h.href,
          };
        }
      }
      return {} as Record<string, string>;
    },
    { ttl: PAST_SEASON_TTL, fallback: {} },
  );
  return note.text ? { ...note, text: trimNote(note.text, name, season) } : note;
}

const pad = (v: unknown, n: number) => String(v).padEnd(n);

function dashLines(title: string, d: Dashboard) {
  return [
    `${title} (per game, ${d.gp} GP):`,
    `  PPG ${d.pts}  RPG ${d.reb}  APG ${d.ast}  SPG ${d.stl}  BPG ${d.blk}  TOV ${d.tov}`,
    `  FG% ${d.fg_pct}  3P% ${d.fg3_pct}  FT% ${d.ft_pct}  +/- ${d.plus_minus}`,
    "",
  ];
}

/** Plain-text team report injected into the AI system prompt (used as-is for
 *  models without tool support). */
export function buildContext(
  teamName: string,
  standings: Standings,
  dash: MaybeDash,
  history: HistoryRow[],
  roster: RosterRow[],
  games: TeamGame[],
  dashPo?: MaybeDash,
  dashFull?: MaybeDash,
): string {
  const lines = [`NBA TEAM REPORT: ${teamName}`, ""];
  if ("wins" in standings) {
    const s = standings as Exclude<Standings, Record<string, never>>;
    lines.push(
      `RECORD: ${s.wins}-${s.losses} | ${s.conference} #${s.conf_rank} | Streak: ${s.streak} | L10: ${s.last10}`,
      `Home: ${s.home}  Road: ${s.road}`,
      "",
    );
  }
  if (hasDash(dash)) lines.push(...dashLines("REGULAR SEASON", dash));
  if (hasDash(dashPo)) lines.push(...dashLines("PLAYOFFS (incl. Finals)", dashPo));
  if (hasDash(dashFull) && hasDash(dashPo)) lines.push(...dashLines("FULL YEAR (regular + playoffs)", dashFull));
  if (history.length) {
    lines.push("RECENT SEASON HISTORY:", "  Season     W    L   Win%   PPG   RPG   APG   FG%   3P%");
    for (const s of history) {
      lines.push(
        `  ${pad(s.season, 11)}${pad(s.wins, 5)}${pad(s.losses, 5)}${s.win_pct.toFixed(3)}  ${pad(s.pts, 6)}${pad(s.reb, 6)}${pad(s.ast, 6)}${pad(s.fg_pct, 6)}${s.fg3_pct}`,
      );
    }
    lines.push("");
  }
  if (roster.length) {
    lines.push("KEY PLAYERS (by minutes):", "  Player                    MPG   PPG   RPG   APG   FG%  +/-");
    for (const p of roster.slice(0, 12)) {
      lines.push(`  ${pad(p.name, 26)}${pad(p.mpg, 6)}${pad(p.ppg, 6)}${pad(p.rpg, 6)}${pad(p.apg, 6)}${pad(p.fg_pct, 6)}${p.plus_minus}`);
    }
    lines.push("");
  }
  if (games.length) {
    lines.push("RECENT GAMES:");
    for (const g of games.slice(0, 10)) lines.push(`  ${pad(g.date, 12)}${pad(g.matchup, 24)}${g.wl}  ${g.pts} pts  +/- ${g.plus_minus}`);
  }
  return lines.join("\n");
}

export { hasDash, playoffsPossible, SEASON_TYPE_PLAYOFFS };
export type { MaybeDash };
