/** Agent tools (port of backend/llm/tools.py): JSON-schema tool specs +
 *  executors wrapping the data layer. Specs are provider-neutral
 *  ({name, description, parameters}); the adapters translate them. */

import type { Cache } from "../cache";
import { currentSeason, parseSeasonType, SEASON_TYPE_FULL, SEASON_TYPE_PLAYOFFS } from "../config";
import * as data from "../nba/data";
import * as services from "../nba/services";
import { round } from "../nba/stats";
import { findTeam, getTeamAbbr, getTeamName } from "../nba/teams";
import { zoneSummary } from "./shotzones";

const MAX_RESULT_CHARS = 9000;

const SEASON = { type: "string", description: "Season like '2025-26'. Omit for the current season." };
const STYPE = { type: "string", enum: ["regular", "playoffs", "full"], description: "Regular season, playoffs, or both combined. Default regular." };
const TEAM = { type: "string", description: "Team name, nickname, city or tricode, e.g. 'Lakers' or 'BOS'." };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, any>; required?: string[] };
}

export const SPECS: ToolSpec[] = [
  {
    name: "get_standings",
    description: "League standings (seed, W-L, games back, streak, last 10) for both conferences.",
    parameters: { type: "object", properties: {
      season: SEASON,
      conference: { type: "string", enum: ["East", "West"], description: "Limit to one conference." },
    } },
  },
  {
    name: "get_team_report",
    description: "Full report for one team: record, seed, per-game averages (regular + playoffs), recent-season history, key players and recent games.",
    parameters: { type: "object", properties: { team: TEAM, season: SEASON }, required: ["team"] },
  },
  {
    name: "get_team_games",
    description: "A team's game log, newest first, with scores, +/- and NBA game_id (usable with get_game_details).",
    parameters: { type: "object", properties: {
      team: TEAM, season: SEASON, season_type: STYPE,
      limit: { type: "integer", description: "How many games (default 10, max 82)." },
    }, required: ["team"] },
  },
  {
    name: "get_roster",
    description: "A team's players with per-game stats (min, pts, reb, ast, stl, blk, FG%, 3P%, +/-) and, for the current season, each player's injury status.",
    parameters: { type: "object", properties: { team: TEAM, season: SEASON }, required: ["team"] },
  },
  {
    name: "get_player",
    description: "One player's season: per-game averages, advanced metrics (TS%, USG%…), shot-zone efficiency and recent games.",
    parameters: { type: "object", properties: {
      name: { type: "string", description: "Player's full name, e.g. 'Jayson Tatum'." },
      season: SEASON,
    }, required: ["name"] },
  },
  {
    name: "get_game_details",
    description: "Box-score story of one completed game: quarter scores and top performers. Needs an NBA game_id from get_team_games.",
    parameters: { type: "object", properties: {
      game_id: { type: "string", description: "10-digit NBA game id, e.g. '0022500123'." },
    }, required: ["game_id"] },
  },
  {
    name: "get_scoreboard",
    description: "Scores and status of every game on a date (live, final or scheduled).",
    parameters: { type: "object", properties: {
      date: { type: "string", description: "YYYY-MM-DD. Omit for today." },
    } },
  },
  {
    name: "get_upcoming_games",
    description: "Scheduled games over the next two weeks, optionally for one team.",
    parameters: { type: "object", properties: { team: TEAM } },
  },
  {
    name: "compare_teams",
    description: "Head-to-head comparison of two teams: records, per-game stats and every meeting this season.",
    parameters: { type: "object", properties: {
      team_a: TEAM, team_b: TEAM, season: SEASON, season_type: STYPE,
    }, required: ["team_a", "team_b"] },
  },
  {
    name: "get_league_leaders",
    description: "Rank all TEAMS by a stat: Net Rating, Off Rating, Def Rating, Pace, True Shooting, Eff. FG%, Reb %, Ast/TO, PPG, RPG, APG, FG%, 3P%, Steals, Blocks, Turnovers. For individual players use get_player_leaders.",
    parameters: { type: "object", properties: {
      category: { type: "string", description: "One of the categories listed above." },
      season: SEASON,
      top: { type: "integer", description: "How many teams to return (default 10)." },
    }, required: ["category"] },
  },
  {
    name: "get_player_leaders",
    description:
      "League-wide PLAYER leaderboard for one per-game stat: " +
      data.PLAYER_LEADER_CATEGORIES.map((c) => c[0]).join(", ") +
      ". Only qualified players count (70% of games played; FG%/3P%/FT% also need a minimum of makes per game). Pass `player` to also get that player's league rank.",
    parameters: { type: "object", properties: {
      category: { type: "string", description: "One of the categories listed above." },
      season: SEASON,
      top: { type: "integer", description: "How many players to return (default 10, max 25)." },
      player: { type: "string", description: "Optional player name to find in the full ranking." },
    }, required: ["category"] },
  },
  {
    name: "get_news",
    description: "Latest ESPN headlines for a team, or league-wide when no team is given.",
    parameters: { type: "object", properties: { team: TEAM } },
  },
  {
    name: "web_search",
    description: "Search the web for anything not covered by the stats tools — injuries, trades, rumors, quotes, news after your training data.",
    parameters: { type: "object", properties: {
      query: { type: "string", description: "Search query." },
    }, required: ["query"] },
  },
];

class ToolError extends Error {}

type Args = Record<string, any>;

function season(args: Args) {
  const s = String(args.season ?? "").trim();
  return s && s.length === 7 && s[4] === "-" ? s : currentSeason();
}

function teamId(name: string) {
  const t = findTeam(name);
  if (!t) throw new ToolError(`Unknown team '${name}'`);
  return t.id;
}

function roundFloats(obj: unknown): unknown {
  if (typeof obj === "number" && !Number.isInteger(obj)) return round(obj, 3);
  if (Array.isArray(obj)) return obj.map(roundFloats);
  if (obj && typeof obj === "object") {
    return Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, roundFloats(v)]));
  }
  return obj;
}

const clampInt = (v: unknown, def: number, lo: number, hi: number) => Math.max(lo, Math.min(parseInt(String(v ?? def), 10) || def, hi));

// ── player lookup (nba_api's static players list) ────────────────────────────

let players: Promise<[number, string, number][]> | null = null;
const loadPlayers = () => (players ??= import("./players.json").then((m) => m.default as [number, string, number][]));
const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function findPlayers(name: string) {
  const all = await loadPlayers();
  const q = fold(name);
  let hits = all.filter((p) => fold(p[1]) === q);
  if (!hits.length) hits = all.filter((p) => fold(p[1]).includes(q));
  // active players first
  return hits.sort((a, b) => b[2] - a[2]).map(([id, full_name, active]) => ({ id, full_name, is_active: !!active }));
}

// ── executors (return [data, short human summary]) ───────────────────────────

type Exec = (args: Args, cache: Cache) => Promise<[unknown, string]>;

const EXECUTORS: Record<string, Exec> = {
  async get_standings(args, cache) {
    let rows = await data.fetchAllStandings(season(args), cache);
    const conf = args.conference;
    if (conf) rows = rows.filter((r) => r.conference === conf);
    const slim = rows.map(({ conference, rank, team_name, wins, losses, gb, streak, last10 }) => ({ conference, rank, team_name, wins, losses, gb, streak, last10 }));
    return [slim, `Pulled ${conf ? conf + " " : ""}standings`];
  },

  async get_team_report(args, cache) {
    const tid = teamId(args.team);
    return [await services.teamContext(tid, season(args), cache), `Pulled ${getTeamName(tid)} report`];
  },

  async get_team_games(args, cache) {
    const tid = teamId(args.team);
    const stype = parseSeasonType(args.season_type);
    const limit = clampInt(args.limit, 10, 1, 82);
    let games;
    if (stype === SEASON_TYPE_FULL) {
      games = [
        ...(await data.fetchGamelog(tid, season(args), cache, 0, SEASON_TYPE_PLAYOFFS)),
        ...(await data.fetchGamelog(tid, season(args), cache, 0)),
      ].slice(0, limit);
    } else {
      games = await data.fetchGamelog(tid, season(args), cache, limit, stype);
    }
    // The log only carries this team's points; the margin gives the opponent's.
    const out = games.map((g) => ({ ...g, opp_pts: round(g.pts - g.plus_minus) }));
    return [out, `Pulled ${getTeamAbbr(tid)} game log`];
  },

  async get_roster(args, cache) {
    const tid = teamId(args.team);
    return [await services.teamRoster(tid, season(args), cache), `Pulled ${getTeamName(tid)} roster`];
  },

  async get_player(args, cache) {
    const name = String(args.name).trim();
    const matches = await findPlayers(name);
    if (!matches.length) throw new ToolError(`No player named '${name}'`);
    const p = matches[0];
    const s = season(args);
    const games = await data.fetchPlayerGamelog(p.id, s, cache, 0);
    if (!games.length) return [{ player: p.full_name, season: s, note: "No games logged this season." }, `Looked up ${p.full_name}`];
    // The player's current team is the first token of his latest MATCHUP.
    const abbr = games.at(-1)!.matchup.split(/\s+/)[0];
    const team = findTeam(abbr);
    const out: Record<string, unknown> = { player: p.full_name, season: s, team: team ? team.full_name : abbr };
    if (team) {
      const prof = await services.playerProfile(p.id, team.id, s, cache);
      out.per_game = prof.player;
      out.advanced = prof.advanced;
      out.per36 = prof.per36;
      out.shot_zones = zoneSummary(prof.shots);
    }
    out.last_games = games.slice(-8);
    return [out, `Pulled ${p.full_name} profile`];
  },

  async get_game_details(args, cache) {
    const gid = String(args.game_id).trim();
    if (!/^\d{10}$/.test(gid)) throw new ToolError("game_id must be the 10-digit NBA id from get_team_games");
    const d = structuredClone(await data.fetchGameBreakdown(gid, cache));
    for (const side of ["home", "away"]) if (d[side]?.players) d[side].players = d[side].players.slice(0, 6);
    return [d, `Pulled game ${gid} box score`];
  },

  async get_scoreboard(args) {
    const date = String(args.date ?? "").replaceAll("-", "");
    return [await data.fetchScoreboard(date || null), `Pulled scoreboard${args.date ? " for " + args.date : ""}`];
  },

  async get_upcoming_games(args, cache) {
    let games = await data.fetchUpcomingGames(cache);
    if (args.team) {
      const t = findTeam(args.team);
      if (t) games = games.filter((g) => [g.home.app_name, g.away.app_name].includes(t.full_name));
    }
    return [games.slice(0, 25).map((g) => ({ tip_utc: g.date_utc, away: g.away.app_name, home: g.home.app_name })), "Pulled schedule"];
  },

  async compare_teams(args, cache) {
    const a = teamId(args.team_a);
    const b = teamId(args.team_b);
    if (a === b) throw new ToolError("Pick two different teams");
    const c = await services.compare(a, b, season(args), parseSeasonType(args.season_type), cache);
    return [c.context, `Compared ${getTeamAbbr(a)} vs ${getTeamAbbr(b)}`];
  },

  async get_league_leaders(args, cache) {
    const want = String(args.category).trim().toLowerCase();
    const cat =
      data.LEADER_CATEGORIES.find((c) => c[0].toLowerCase() === want) ??
      data.LEADER_CATEGORIES.find((c) => c[0].toLowerCase().includes(want));
    if (!cat) throw new ToolError(`Unknown category '${args.category}'`);
    const [label, measure, field, hib, , definition] = cat;
    const rows = (await data.fetchLeagueTeamStats(season(args), measure, cache))
      .filter((r) => field in r)
      .sort((x, y) => (hib ? y[field] - x[field] : x[field] - y[field]));
    const top = clampInt(args.top, 10, 1, 30);
    return [
      { category: label, definition, ranking: rows.slice(0, top).map((r, i) => ({ rank: i + 1, team: r.team_name, value: r[field] })) },
      `Ranked teams by ${label}`,
    ];
  },

  async get_player_leaders(args, cache) {
    const cat = playerCategory(String(args.category));
    if (!cat) {
      throw new ToolError(`Unknown category '${args.category}'. Use one of: ${data.PLAYER_LEADER_CATEGORIES.map((c) => c[0]).join(", ")}`);
    }
    const [label, field, fmt, definition, qual] = cat;
    const s = season(args);
    const rows = await data.fetchLeaguePlayerStats(s, cache);
    const ranked = data.topPlayers(rows, field, qual, rows.length);
    const entry = (i: number, r: data.LeaguePlayerRow) => ({
      rank: i + 1, player: r.name, team: r.team_abbr, gp: r.gp, value: data.pyFormat(fmt, r[field] as number),
    });
    const top = clampInt(args.top, 10, 1, 25);
    const out: Record<string, unknown> = {
      category: label,
      definition,
      season: s,
      qualifier: `${rows.length ? data.minGames(rows) : 0}+ games` + (qual ? `, ${qual[1].toFixed(1)} ${qual[0]} per game` : ""),
      qualified_players: ranked.length,
      ranking: ranked.slice(0, top).map((r, i) => entry(i, r)),
    };
    if (args.player) {
      const name = String(args.player).trim().toLowerCase();
      const i = ranked.findIndex((r) => r.name.toLowerCase().includes(name));
      out.player_rank = i >= 0 ? entry(i, ranked[i]) : `${args.player} isn't among qualified players for ${label} (not enough games or volume).`;
    }
    return [out, `Ranked players by ${label}`];
  },

  async get_news(args, cache) {
    let name = "";
    if (args.team) name = findTeam(args.team)?.full_name ?? "";
    const items = await data.fetchNews(name, cache);
    return [items.map(({ headline, description, published }) => ({ headline, description, published })), `Read ${name ? name.split(" ").at(-1) : "league"} news`];
  },

  async web_search(args) {
    const q = String(args.query).trim();
    const [text] = await data.webSearch(q);
    return [text || "No results.", `Searched the web: “${q.slice(0, 60)}”`];
  },
};

// Words people use for a category that its label doesn't contain.
const PLAYER_CAT_ALIASES: Record<string, string> = {
  scoring: "Points", ppg: "Points", rpg: "Rebounds", apg: "Assists", spg: "Steals",
  bpg: "Blocks", threes: "3PM", "3-pointers made": "3PM", "free throw %": "FT%",
  "free throws made": "FTM", "free throw attempts": "FTA", "personal fouls": "Fouls",
  "offensive rebounds": "Off. Reb", "defensive rebounds": "Def. Reb", "plus minus": "+/-",
};

function playerCategory(want: string) {
  const w = want.trim().toLowerCase();
  const cats = data.PLAYER_LEADER_CATEGORIES;
  const label = PLAYER_CAT_ALIASES[w];
  return (
    cats.find((c) => c[0] === label) ??
    cats.find((c) => w === c[0].toLowerCase() || w === c[1].toLowerCase()) ??
    cats.find((c) => c[0].toLowerCase().includes(w))
  );
}

/** Light schema check — tolerant stream parsers can hand us partial objects,
 *  so verify required fields and basic types before running. */
export function validateArgs(name: string, args: unknown) {
  const spec = SPECS.find((s) => s.name === name);
  if (!spec) throw new ToolError(`Unknown tool '${name}'`);
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new ToolError("Arguments must be a JSON object");
  const a = args as Args;
  const props = spec.parameters.properties;
  for (const req of spec.parameters.required ?? []) {
    if (!String(a[req] ?? "").trim()) throw new ToolError(`Missing required argument '${req}'`);
  }
  for (const [k, v] of Object.entries(a)) {
    const t = props[k]?.type;
    if (t === "string" && v !== null && v !== undefined && typeof v !== "string") throw new ToolError(`'${k}' must be a string`);
    if (t === "integer" && v !== null && v !== undefined && !Number.isFinite(parseInt(String(v), 10))) throw new ToolError(`'${k}' must be an integer`);
  }
}

/** Run a tool. Returns [result_text, summary, ok]. */
export async function execute(name: string, args: Args, cache: Cache): Promise<[string, string, boolean]> {
  try {
    validateArgs(name, args);
    const [result, summary] = await EXECUTORS[name](args, cache);
    let text = typeof result === "string" ? result : JSON.stringify(roundFloats(result));
    if (text.length > MAX_RESULT_CHARS) text = text.slice(0, MAX_RESULT_CHARS) + " …[truncated]";
    return [text, summary, true];
  } catch (e: any) {
    if (e instanceof ToolError) return [JSON.stringify({ error: e.message }), e.message, false];
    console.warn(`tool ${name} failed:`, e);
    return [JSON.stringify({ error: `${e?.name ?? "Error"}: ${e?.message ?? e}` }), `${name} failed`, false];
  }
}

export function todayLine(d = new Date()) {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "2-digit", year: "numeric" });
}
