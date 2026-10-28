/** Agent tools (port of backend/llm/tools.py): JSON-schema tool specs +
 *  executors wrapping the data layer. Specs are provider-neutral
 *  ({name, description, parameters}); the adapters translate them. */

import type { Cache } from "../cache";
import { currentSeason, parseSeasonType, SEASON_TYPE_FULL, SEASON_TYPE_PLAYOFFS } from "../config";
import * as news from "../news";
import * as data from "../nba/data";
import * as services from "../nba/services";
import { round } from "../nba/stats";
import { findTeam, getTeamAbbr, getTeamName, type Team } from "../nba/teams";
import * as pulse from "../pulse";
import { zoneSummary } from "./shotzones";

export const MAX_RESULT_CHARS = 9000;

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
    description: "A team's game log, newest first, with scores, +/- and game_id (usable with get_game_details). Includes tonight's finished game even before nba.com logs it.",
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
    description: "One player's season: bio (age, height, position, experience, draft), per-game averages, advanced metrics (TS%, USG%…), shot-zone efficiency and recent games.",
    parameters: { type: "object", properties: {
      name: { type: "string", description: "Player's full name, e.g. 'Jayson Tatum'." },
      season: SEASON,
      games: { type: "integer", description: "How many recent games to include (default 8, max 82)." },
    }, required: ["name"] },
  },
  {
    name: "get_game_details",
    description:
      "How a game went, live or finished: score, status, quarter scores, runs, top performers. " +
      "Easiest: pass `team` for that team's game today (or its most recent one). Or pass a game_id from the scoreboard or a game log.",
    parameters: { type: "object", properties: {
      team: { ...TEAM, description: "Team name, nickname, city or tricode. Gets that team's game today, or its latest game." },
      game_id: { type: "string", description: "A game_id from get_scoreboard or get_team_games, e.g. 'espn_401810123' or '0022500123'." },
    } },
  },
  {
    name: "get_scoreboard",
    description: "Scores and status of every game on a date (live, final or scheduled), each with a game_id for get_game_details.",
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
    description: "Latest news for a team, or league-wide when no team is given: headlines (default), or trade rumors with who reported them.",
    parameters: { type: "object", properties: {
      team: TEAM,
      kind: { type: "string", enum: ["headlines", "rumors"], description: "headlines (default) or rumors." },
    } },
  },
  {
    name: "get_injuries",
    description: "The current NBA injury report: who is out or questionable, the injury, and the expected return. For one team or the whole league.",
    parameters: { type: "object", properties: { team: TEAM } },
  },
  {
    name: "web_search",
    description: "Search the web for NBA information not covered by the other tools — quotes, breaking news, history, anything after your training data.",
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

// ── games: nba.com ids, ESPN ids, or "this team's game" ───────────────────────

interface GameRef {
  id: string;
  espn: boolean;
}

/** nba.com's '0022500123', or ESPN's '401810123' / 'espn_401810123'. */
function parseGameId(raw: string): GameRef | null {
  const s = raw.replace(/^espn[_:-]?/i, "");
  if (/^00\d{8}$/.test(s) && !/^espn/i.test(raw)) return { id: s, espn: false };
  if (/^\d{6,12}$/.test(s)) return { id: s, espn: true };
  return null;
}

const sideHas = (g: data.LiveGame, t: Team) => g.home.espn_id === t.espn_id || g.away.espn_id === t.espn_id;

/** A team's game today (live or final), else its latest final. */
async function teamGame(t: Team, cache: Cache): Promise<[GameRef | null, string]> {
  const today = await data.fetchScoreboard().catch(() => null);
  const g = today?.games.find((x) => sideHas(x, t));
  if (g && g.state !== "pre") return [{ id: g.id, espn: true }, ""];
  const upcoming = g ? `${t.nickname} play later today: ${g.away.abbr} @ ${g.home.abbr}, ${g.status_text}. This is their last game.` : "";
  const finals = (await data.fetchRecentFinals().catch(() => [])).filter((f) => f.home.nba_id === t.id || f.away.nba_id === t.id);
  if (finals.length) {
    const f = finals.reduce((a, b) => (b.date_utc > a.date_utc ? b : a));
    return [{ id: f.espn_id, espn: true }, upcoming];
  }
  const { games } = await services.teamOverview(t.id, currentSeason(), cache);
  const last: any = games.playoffs[0] && games.playoffs[0].iso > (games.regular[0]?.iso ?? "") ? games.playoffs[0] : games.regular[0];
  if (!last) return [null, ""];
  return [last.espn_id ? { id: last.espn_id, espn: true } : { id: last.game_id, espn: false }, upcoming];
}

/** The top scorers on one side of an ESPN box. */
function topLines(side: any) {
  if (!side?.players) return [];
  return [...side.players]
    .filter((p: any) => !p.dnp)
    .sort((a: any, b: any) => b.pts - a.pts)
    .slice(0, 5)
    .map((p: any) => ({ player: p.name, min: p.min, pts: p.pts, reb: p.reb, ast: p.ast, fg: `${p.fgm}-${p.fga}`, three: `${p.tpm}-${p.tpa}`, pm: p.pm }));
}

const scoreLine = (g: data.LiveGame) => ({
  game_id: `espn_${g.id}`,
  status: g.state === "post" ? "final" : g.state === "in" ? "live" : "scheduled",
  detail: g.status_text,
  tip_utc: g.date_utc,
  away: { team: g.away.app_name, abbr: g.away.abbr, score: g.away.score, record: g.away.record },
  home: { team: g.home.app_name, abbr: g.home.abbr, score: g.home.score, record: g.home.record },
});

function playerBio(b: Record<string, any>) {
  const age = b.birthdate ? Math.floor((Date.now() - Date.parse(b.birthdate)) / (365.25 * 86400_000)) : null;
  const ht = b.height_in ? `${Math.floor(b.height_in / 12)}-${b.height_in % 12}` : null;
  const draft = b.draft_year ? (b.draft_pick ? `${b.draft_year} round ${b.draft_round}, pick ${b.draft_pick}` : `${b.draft_year} undrafted`) : null;
  return { age, height: ht, weight_lb: b.weight_lb, position: b.position, jersey: b.jersey, experience_years: b.season_exp, school: b.school, country: b.country, draft };
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
    // The overview's logs include tonight's ESPN final before nba.com has it.
    const { games: log } = await services.teamOverview(tid, season(args), cache);
    const games =
      stype === SEASON_TYPE_FULL ? [...log.playoffs, ...log.regular] : stype === SEASON_TYPE_PLAYOFFS ? log.playoffs : log.regular;
    // The log only carries this team's points; the margin gives the opponent's.
    const out = games.slice(0, limit).map((g) => ({ ...g, opp_pts: round(g.pts - g.plus_minus) }));
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
      if (prof.bio) out.bio = playerBio(prof.bio);
      out.per_game = prof.player;
      out.advanced = prof.advanced;
      out.per36 = prof.per36;
      out.shot_zones = zoneSummary(prof.shots);
    }
    out.last_games = games.slice(-clampInt(args.games, 8, 1, 82)).reverse();
    return [out, `Pulled ${p.full_name} profile`];
  },

  async get_game_details(args, cache) {
    const raw = String(args.game_id ?? "").trim();
    let ref: GameRef | null = raw ? parseGameId(raw) : null;
    let note = "";
    if (!ref && args.team) {
      const t = findTeam(args.team);
      if (!t) throw new ToolError(`Unknown team '${args.team}'`);
      [ref, note] = await teamGame(t, cache);
    }
    if (!ref) {
      throw new ToolError(raw ? `'${raw}' isn't a game id. Pass the team instead, e.g. team='Celtics'.` : "Pass a team, e.g. team='Celtics', or a game_id.");
    }
    if (ref.espn) {
      const [recap, box] = await Promise.all([pulse.recapContext(ref.id), data.fetchEspnBox(ref.id).catch(() => null)]);
      const out: Record<string, unknown> = { game_id: `espn_${ref.id}`, game: recap };
      if (box) out.top_players = { away: topLines(box.away), home: topLines(box.home) };
      if (note) out.note = note;
      return [out, "Pulled game story"];
    }
    const d = structuredClone(await data.fetchGameBreakdown(ref.id, cache));
    for (const side of ["home", "away"]) if (d[side]?.players) d[side].players = d[side].players.slice(0, 6);
    if (note) d.note = note;
    return [d, `Pulled game ${ref.id} box score`];
  },

  async get_scoreboard(args) {
    const date = String(args.date ?? "").replaceAll("-", "");
    const sb = await data.fetchScoreboard(date || null);
    return [{ date: sb.date, games: sb.games.map(scoreLine) }, `Pulled scoreboard${args.date ? " for " + args.date : ""}`];
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
    const t = args.team ? findTeam(args.team) : null;
    const name = t?.full_name ?? "";
    if (args.kind === "rumors") {
      const h = await news.hub(t?.id, cache);
      const items = h.rumors.slice(0, 15).map(({ title, summary, source, published }) => ({ headline: title, summary, source, published }));
      return [items, `Read ${name ? name.split(" ").at(-1) + " " : ""}trade rumors`];
    }
    const items = await data.fetchNews(name, cache);
    return [items.map(({ headline, description, published }) => ({ headline, description, published })), `Read ${name ? name.split(" ").at(-1) : "league"} news`];
  },

  async get_injuries(args, cache) {
    const report = await news.injuries(cache);
    const slim = (rows: news.InjuryRow[]) =>
      rows.map(({ player, position, status, injury, return_date, comment }) => ({ player, position, status, injury, return_date, comment }));
    if (args.team) {
      const t = findTeam(args.team);
      if (!t) throw new ToolError(`Unknown team '${args.team}'`);
      const rows = report[t.full_name] ?? [];
      return [{ team: t.full_name, injuries: rows.length ? slim(rows) : "No injuries reported." }, `Read ${t.nickname} injuries`];
    }
    const league = Object.entries(report).filter(([, rows]) => rows.length).map(([team, rows]) => ({ team, injuries: slim(rows) }));
    return [league, "Read the injury report"];
  },

  async web_search(args) {
    let q = String(args.query).trim();
    // Keep searches on the NBA.
    if (!/\b(nba|basketball|hoops)\b/i.test(q)) q = `NBA ${q}`;
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

/** The longest array anywhere in `obj`, or null. */
function longestArray(obj: unknown): unknown[] | null {
  let best: unknown[] | null = null;
  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      if (!best || v.length > best.length) best = v;
      v.forEach(walk);
    } else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(obj);
  return best;
}

/** JSON of `result` within `limit` chars: long lists are shortened (from the
 *  end: they're newest/best first) so the model still gets valid JSON; plain
 *  text is cut. */
export function fitResult(result: unknown, limit: number): string {
  if (typeof result === "string") return result.length > limit ? result.slice(0, limit) + " …[truncated]" : result;
  const obj = roundFloats(result);
  let text = JSON.stringify(obj);
  while (text.length > limit) {
    const arr = longestArray(obj);
    if (!arr || arr.length < 2) break;
    arr.length = Math.max(1, Math.floor(arr.length * Math.min(0.75, limit / text.length)));
    text = JSON.stringify(obj);
  }
  return text.length > limit ? text.slice(0, limit) + " …[truncated]" : text;
}

/** Run a tool. Returns [result_text, summary, ok]. */
export async function execute(name: string, args: Args, cache: Cache, limit = MAX_RESULT_CHARS): Promise<[string, string, boolean]> {
  try {
    validateArgs(name, args);
    const [result, summary] = await EXECUTORS[name](args, cache);
    return [fitResult(result, limit), summary, true];
  } catch (e: any) {
    if (e instanceof ToolError) return [JSON.stringify({ error: e.message }), e.message, false];
    console.warn(`tool ${name} failed:`, e);
    return [JSON.stringify({ error: `${e?.name ?? "Error"}: ${e?.message ?? e}` }), `${name} failed`, false];
  }
}

export function todayLine(d = new Date()) {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "2-digit", year: "numeric" });
}
