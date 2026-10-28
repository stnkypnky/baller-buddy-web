/** Composite views assembled from the fetchers (port of backend/nba/services.py). */

import type { Cache } from "../cache";
import {
  SEASON_TYPE_FULL,
  SEASON_TYPE_PLAYOFFS,
  SEASON_TYPE_REGULAR,
  currentSeason,
  playoffsPossible,
  seasonStartYear,
  seasonStr,
  type SeasonType,
} from "../config";
import * as news from "../news";
import * as data from "./data";
import type { FullGame, MaybeDash } from "./data";
import { round } from "./stats";
import { ESPN_IDS, getTeamAbbr, getTeamName } from "./teams";

/** Drop the raw totals (internal, only needed for combining splits). */
function publicDash(d: MaybeDash | null | undefined) {
  return Object.fromEntries(Object.entries(d ?? {}).filter(([k]) => k !== "_tot"));
}

async function poDashboard(teamId: number, season: string, cache: Cache): Promise<MaybeDash> {
  if (!playoffsPossible(season)) return {};
  return data.fetchDashboard(teamId, season, cache, SEASON_TYPE_PLAYOFFS);
}

async function poGamelog(teamId: number, season: string, cache: Cache): Promise<FullGame[]> {
  if (!playoffsPossible(season)) return [];
  return data.fetchFullGamelog(teamId, season, cache, SEASON_TYPE_PLAYOFFS);
}

export async function teamDashboards(teamId: number, season: string, cache: Cache) {
  const reg = await data.fetchDashboard(teamId, season, cache, SEASON_TYPE_REGULAR);
  const po = await poDashboard(teamId, season, cache);
  return [reg, po, data.combineDashboards(reg, po)] as const;
}

/** Soonest scheduled game for a team (ESPN upcoming), or null. */
export async function nextGame(teamId: number, cache: Cache) {
  const espnId = ESPN_IDS[getTeamName(teamId)];
  for (const g of await data.fetchUpcomingGames(cache)) {
    if (espnId === g.home.espn_id || espnId === g.away.espn_id) return g;
  }
  return null;
}

// ── Tonight's finals ─────────────────────────────────────────────────────────
// ESPN marks a game Final within minutes; nba.com's logs can take an hour or
// more, and they're cached for hours. These fill the gap.

const GAME_LENGTH = 2.5 * 3600; // tip-off to final buzzer, roughly
const RECHECK_PENDING = 20 * 60; // how often to ask nba.com again while a final is missing

/** When a final ended (epoch seconds), at the latest now. */
const endedAt = (f: data.RecentFinal) => Math.min(Date.now() / 1000, Date.parse(f.date_utc) / 1000 + GAME_LENGTH);

/** ESPN finals for the current season, or none (past seasons, ESPN down). */
async function recentFinals(season: string, teamId?: number) {
  if (season !== currentSeason()) return [];
  const all = await data.fetchRecentFinals().catch(() => [] as data.RecentFinal[]);
  return teamId ? all.filter((f) => f.home.nba_id === teamId || f.away.nba_id === teamId) : all;
}

/** Drop cached keys when they were written before a final they should contain
 *  ended, or when a final is still missing and they're older than a recheck. */
async function expireForFinals(cache: Cache, probe: string, finals: data.RecentFinal[], missing: boolean, drop: (k: string) => boolean) {
  const age = await cache.age(probe);
  if (age === null || !finals.length) return false;
  const written = Date.now() / 1000 - age;
  if (finals.some((f) => endedAt(f) > written) || (missing && age > RECHECK_PENDING)) {
    await cache.popWhere(drop);
    return true;
  }
  return false;
}

const playoffFinal = (f: data.RecentFinal) => f.stype === 3;
const countedFinal = (f: data.RecentFinal) => f.stype === 2 || f.stype === 3;

/** A team's game row built from an ESPN final, until nba.com has the real one. */
function pendingTeamGame(f: data.RecentFinal, teamId: number) {
  const home = f.home.nba_id === teamId;
  const me = home ? f.home : f.away;
  const opp = home ? f.away : f.home;
  return {
    game_id: `espn_${f.espn_id}`,
    iso: f.iso,
    date: data.fmtGameDate(f.iso),
    matchup: `${me.abbr} ${home ? "vs." : "@"} ${opp.abbr}`,
    wl: me.pts > opp.pts ? "W" : "L",
    pts: me.pts,
    reb: null,
    ast: null,
    fg_pct: null,
    plus_minus: me.pts - opp.pts,
    pending: true,
    espn_id: f.espn_id,
  };
}

const inTeamLog = (games: data.TeamGame[], f: data.RecentFinal, teamId: number) => {
  const opp = f.home.nba_id === teamId ? f.away.abbr : f.home.abbr;
  return games.some((g) => g.iso === f.iso && g.matchup.split(/\s+/).at(-1) === opp);
};

export async function teamOverview(teamId: number, season: string, cache: Cache) {
  const finals = (await recentFinals(season, teamId)).filter(countedFinal);
  const teamKeys = (k: string) =>
    k === `standings_all_${season}` || k.startsWith(`games_v3_${teamId}_${season}_`) || k.startsWith(`dashboard_v2_${teamId}_${season}_`);
  const regKey = `games_v3_${teamId}_${season}_${SEASON_TYPE_REGULAR}`;
  await expireForFinals(cache, regKey, finals, false, teamKeys);

  let standings = await data.fetchStandings(teamId, season, cache);
  let [reg, po, full] = await teamDashboards(teamId, season, cache);
  let gamesReg = await data.fetchGamelog(teamId, season, cache, 0);
  // only hit the API for playoff games if the team has any
  let gamesPo = data.hasDash(po) ? await data.fetchGamelog(teamId, season, cache, 0, SEASON_TYPE_PLAYOFFS) : [];
  const missing = () => finals.filter((f) => !inTeamLog(playoffFinal(f) ? gamesPo : gamesReg, f, teamId));
  // A final nba.com didn't have last time: ask again every so often.
  if (missing().length && (await expireForFinals(cache, regKey, finals, true, teamKeys))) {
    standings = await data.fetchStandings(teamId, season, cache);
    [reg, po, full] = await teamDashboards(teamId, season, cache);
    gamesReg = await data.fetchGamelog(teamId, season, cache, 0);
    gamesPo = data.hasDash(po) ? await data.fetchGamelog(teamId, season, cache, 0, SEASON_TYPE_PLAYOFFS) : [];
  }

  // Still missing: show ESPN's version on top, newest first.
  const add = missing().sort((a, b) => b.date_utc.localeCompare(a.date_utc));
  const regular = [...add.filter((f) => !playoffFinal(f)).map((f) => pendingTeamGame(f, teamId)), ...gamesReg];
  const playoffs = [...add.filter(playoffFinal).map((f) => pendingTeamGame(f, teamId)), ...gamesPo];

  // ESPN's record counts tonight's game before nba.com's standings do.
  const latest = finals.filter((f) => !playoffFinal(f)).sort((a, b) => b.date_utc.localeCompare(a.date_utc))[0];
  const espnRec = latest && record(latest.home.nba_id === teamId ? latest.home.record : latest.away.record);
  if (espnRec && "wins" in standings && espnRec[0] + espnRec[1] > (standings.wins as number) + (standings.losses as number)) {
    const [w, l] = espnRec;
    standings = { ...standings, wins: w, losses: l, win_pct: w / Math.max(w + l, 1) } as typeof standings;
  }

  return {
    team_id: teamId,
    team_name: getTeamName(teamId),
    season,
    standings,
    dash: { regular: publicDash(reg), playoffs: publicDash(po), full: publicDash(full) },
    games: { regular, playoffs },
    next_game: season === currentSeason() ? await nextGame(teamId, cache) : null,
  };
}

/** "45-12" -> [45, 12]. */
function record(s: string): [number, number] | null {
  const m = /^(\d+)-(\d+)/.exec(s ?? "");
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** "Luka Dončić" / "Jaren Jackson Jr." -> "lukadoncic" / "jarenjackson", so
 *  nba.com and ESPN spellings of a name match. */
export function nameKey(name: string): string {
  let s = name.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase();
  s = s.replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "");
  return s.replace(/[^a-z]/g, "");
}

/** {player id: [games, team abbr]} for a whole season, or {} if it hasn't started. */
async function seasonGp(season: string, cache: Cache): Promise<Map<number, [number, string]>> {
  if (seasonStartYear(season) > seasonStartYear(currentSeason())) return new Map();
  return new Map((await data.fetchLeaguePlayerStats(season, cache)).map((r) => [r.pid, [r.gp, r.team_abbr]]));
}

/** The roster, each player tagged with:
 *    injury  — ESPN's report entry; it's today's, so current season only;
 *    absence — for a finished season, players who never played get the games
 *              they played the season before and after, for context. */
export async function teamRoster(teamId: number, season: string, cache: Cache) {
  const current = season === currentSeason();
  const report = current ? ((await news.injuries(cache))[getTeamName(teamId)] ?? []) : [];
  const byName = new Map(report.map((r) => [nameKey(r.player), r]));
  const roster = await data.fetchRoster(teamId, season, cache);
  const missed = !current && roster.some((p) => p.gp === 0);
  const start = seasonStartYear(season);
  const prev = missed ? await seasonGp(seasonStr(start - 1), cache) : new Map();
  const nxt = missed ? await seasonGp(seasonStr(start + 1), cache) : new Map();

  const around = (table: Map<number, [number, string]>, s: string, pid: number) => {
    if (!table.size) return null;
    const [gp, team] = table.get(pid) ?? [0, ""];
    return { season: s, gp, team };
  };

  return roster.map((p) => {
    const r = byName.get(nameKey(p.name));
    const injury = r ? { status: r.status, injury: r.injury, return_date: r.return_date, comment: r.comment } : null;
    const absence =
      missed && p.gp === 0
        ? { prev: around(prev, seasonStr(start - 1), p.pid), next: around(nxt, seasonStr(start + 1), p.pid) }
        : null;
    return { ...p, injury, absence };
  });
}
export type TeamRosterRow = Awaited<ReturnType<typeof teamRoster>>[number];

/** {player id: web note} on why each player who sat out a finished season
 *  missed it. Separate from the roster since each note is a web search. */
export async function absenceNotes(teamId: number, season: string, cache: Cache) {
  if (season === currentSeason()) return {};
  const gone = (await data.fetchRoster(teamId, season, cache)).filter((p) => p.gp === 0);
  if (!gone.length) return {};
  const notes = await Promise.all(gone.map((p) => data.fetchAbsenceNote(p.name, season, cache)));
  const out: Record<string, unknown> = {};
  gone.forEach((p, i) => {
    if (Object.keys(notes[i]).length) out[String(p.pid)] = notes[i];
  });
  return out;
}

/** buildContext() text for one team (AI fallback / tool output). */
export async function teamContext(teamId: number, season: string, cache: Cache) {
  // The overview's record and games include tonight's ESPN final.
  const ov = await teamOverview(teamId, season, cache);
  const [reg, po, full] = await teamDashboards(teamId, season, cache);
  return data.buildContext(
    getTeamName(teamId),
    ov.standings,
    reg,
    await data.fetchHistory(teamId, cache),
    await data.fetchRoster(teamId, season, cache),
    ov.games.regular as data.TeamGame[],
    po,
    full,
  );
}

export async function leagueLeaders(season: string, cache: Cache) {
  return {
    categories: data.LEADER_CATEGORIES.map(([label, measure, field, hib, format, definition]) => ({
      label, measure, field, higher_is_better: hib, format, definition,
    })),
    Base: await data.fetchLeagueTeamStats(season, "Base", cache),
    Advanced: await data.fetchLeagueTeamStats(season, "Advanced", cache),
  };
}

/** Top 10 qualified players in every player category, from one league fetch
 *  (rookies only when `rookies`, ranked among that class). */
export async function playerLeaders(season: string, cache: Cache, rookies = false) {
  const rows = await data.fetchLeaguePlayerStats(season, cache, rookies);
  const categories = data.PLAYER_LEADER_CATEGORIES.map(([label, field, format, definition, qual]) => ({
    label,
    field,
    format,
    definition,
    min_per_game: qual ? { field: qual[0], value: round(qual[1], 1) } : null,
    leaders: data.topPlayers(rows, field, qual).map((r) => ({
      pid: r.pid, name: r.name, team_id: r.team_id, team_abbr: r.team_abbr, gp: r.gp, value: r[field],
    })),
  }));
  return { season, min_games: rows.length ? data.minGames(rows) : 0, categories };
}

export async function scores(season: string, cache: Cache) {
  const finals = (await recentFinals(season)).filter(countedFinal);
  const key = (t: string) => `lgl_v2_${season}_${t}`;
  const leagueKeys = (k: string) => k.startsWith(`lgl_v2_${season}_`);
  const inLog = (games: data.LeagueGame[], f: data.RecentFinal) => games.some((g) => g.date === f.iso && g.home?.team_id === f.home.nba_id);
  const load = async () => [
    await data.fetchLeagueScoreboard(season, cache, SEASON_TYPE_REGULAR),
    playoffsPossible(season) ? await data.fetchLeagueScoreboard(season, cache, SEASON_TYPE_PLAYOFFS) : [],
  ];
  await expireForFinals(cache, key(SEASON_TYPE_REGULAR), finals, false, leagueKeys);
  let [reg, po] = await load();
  const missing = () => finals.filter((f) => !inLog(playoffFinal(f) ? po : reg, f));
  if (missing().length && (await expireForFinals(cache, key(SEASON_TYPE_REGULAR), finals, true, leagueKeys))) [reg, po] = await load();

  // Finals nba.com hasn't logged yet, from ESPN (newest first, like the log).
  const pending = (f: data.RecentFinal) => ({
    game_id: `espn_${f.espn_id}`,
    date: f.iso,
    ot: f.period > 4,
    home: { team_id: f.home.nba_id, abbr: f.home.abbr, pts: f.home.pts },
    away: { team_id: f.away.nba_id, abbr: f.away.abbr, pts: f.away.pts },
    pending: true,
    espn_id: f.espn_id,
  });
  const byNewest = (a: { date: string; game_id: string }, b: { date: string; game_id: string }) =>
    a.date === b.date ? b.game_id.localeCompare(a.game_id) : b.date.localeCompare(a.date);
  const add = missing();
  const regular = [...add.filter((f) => !playoffFinal(f)).map(pending), ...reg].sort(byNewest);
  const playoffs = [...add.filter(playoffFinal).map(pending), ...po].sort(byNewest);
  const upcoming = season === currentSeason() ? await data.fetchUpcomingGames(cache) : [];
  return { season, regular, playoffs, upcoming };
}

// ── Compare ──────────────────────────────────────────────────────────────────

/** Dashboard for any team respecting the Compare page's season split. */
async function dashFor(teamId: number, season: string, stype: SeasonType, cache: Cache): Promise<MaybeDash> {
  if (stype === SEASON_TYPE_PLAYOFFS) return poDashboard(teamId, season, cache);
  const reg = await data.fetchDashboard(teamId, season, cache, SEASON_TYPE_REGULAR);
  if (stype === SEASON_TYPE_FULL) return data.combineDashboards(reg, await poDashboard(teamId, season, cache));
  return reg;
}

/** Primary team's games vs `oppAbbr`, each paired with the opponent's score via
 *  Game_ID. Returns [chronological list, [primary_w, opp_w]]. */
export function computeSeries(primaryId: number, primaryGames: FullGame[], oppPts: Map<string, number>, oppAbbr: string) {
  const myAbbr = getTeamAbbr(primaryId);
  const series: any[] = [];
  let pw = 0;
  let ow = 0;
  for (const g of primaryGames) {
    const parts = g.matchup.split(/\s+/).filter(Boolean);
    if (!parts.length || parts.at(-1) !== oppAbbr) continue;
    const win = g.wl === "W";
    if (win) pw++;
    else ow++;
    const home = g.matchup.includes("vs.");
    series.push({
      game_id: g.game_id,
      date: g.date,
      home,
      pts: g.pts,
      opp_pts: oppPts.get(g.game_id) ?? null,
      summary: `${myAbbr} ${g.pts}  ${home ? "vs" : "@"}  ${oppAbbr} ${oppPts.get(g.game_id) ?? "?"}`,
      win,
      po: g.po ?? false,
    });
  }
  series.reverse(); // game log is newest-first; show chronologically
  return [series, [pw, ow]] as const;
}

type Rec = [number, number] | null;

export async function compare(aId: number, bId: number, season: string, stype: SeasonType, cache: Cache) {
  const aSt = await data.fetchStandings(aId, season, cache);
  const bSt = await data.fetchStandings(bId, season, cache);
  const aDash = await dashFor(aId, season, stype, cache);
  const bDash = await dashFor(bId, season, stype, cache);

  // Season series: join both teams' full logs on Game_ID to get both scores.
  // Playoffs / Full Year fold in the postseason meetings.
  const regA = await data.fetchFullGamelog(aId, season, cache);
  const regB = await data.fetchFullGamelog(bId, season, cache);
  let poA: FullGame[] = [];
  let poB: FullGame[] = [];
  if (stype !== SEASON_TYPE_REGULAR) {
    poA = await poGamelog(aId, season, cache);
    poB = await poGamelog(bId, season, cache);
  }
  const tag = (games: FullGame[], po: boolean) => games.map((g) => ({ ...g, po }));
  let mine: FullGame[];
  let theirs: FullGame[];
  if (stype === SEASON_TYPE_PLAYOFFS) [mine, theirs] = [tag(poA, true), poB];
  // both logs are newest-first and playoffs postdate the regular season
  else if (stype === SEASON_TYPE_FULL) [mine, theirs] = [[...tag(poA, true), ...tag(regA, false)], [...poB, ...regB]];
  else [mine, theirs] = [tag(regA, false), regB];
  const oppPts = new Map(theirs.map((g) => [g.game_id, g.pts]));
  const [series, seriesRec] = computeSeries(aId, mine, oppPts, getTeamAbbr(bId));

  // W-L for the split — standings only cover the regular season, so playoff
  // records are counted from the playoff game logs.
  const recOf = (games: FullGame[]): Rec => {
    if (!games.length) return null;
    const w = games.filter((g) => g.wl === "W").length;
    return [w, games.length - w];
  };
  const srec = (s: data.Standings): Rec => ("wins" in s ? [s.wins as number, s.losses as number] : null);
  const add = (x: Rec, y: Rec): Rec => {
    if (x === null && y === null) return null;
    const [a, b] = [x ?? [0, 0], y ?? [0, 0]];
    return [a[0] + b[0], a[1] + b[1]];
  };
  const regRecs: [Rec, Rec] = [srec(aSt) ?? recOf(regA), srec(bSt) ?? recOf(regB)];
  let recs: [Rec, Rec];
  if (stype === SEASON_TYPE_PLAYOFFS) recs = [recOf(poA), recOf(poB)];
  else if (stype === SEASON_TYPE_FULL) recs = [add(regRecs[0], recOf(poA)), add(regRecs[1], recOf(poB))];
  else recs = regRecs;

  const result: any = {
    season,
    season_type: stype,
    a: { team_id: aId, team_name: getTeamName(aId), standings: aSt, dash: publicDash(aDash), record: recs[0] },
    b: { team_id: bId, team_name: getTeamName(bId), standings: bSt, dash: publicDash(bDash), record: recs[1] },
    series,
    series_record: [...seriesRec],
  };
  result.context = matchupContext(result);
  return result;
}

/** Plain-text matchup brief for the AI 'break down this matchup' prompt. */
export function matchupContext(cmp: any): string {
  const { a, b, season_type: st } = cmp;
  const p = a.team_name;
  const q = b.team_name;
  const block = (side: any) => {
    const out = [`${side.team_name}:`];
    const { record: rec, standings: s, dash: d } = side;
    if (rec) {
      let line = `  Record (${st}): ${rec[0]}-${rec[1]}`;
      if (s && Object.keys(s).length && st === SEASON_TYPE_REGULAR) line += ` (${s.conference ?? ""} #${s.conf_rank ?? "?"})`;
      out.push(line);
    }
    if (d && Object.keys(d).length) {
      out.push(`  PPG ${d.pts}  RPG ${d.reb}  APG ${d.ast}  +/- ${d.plus_minus}`);
      out.push(`  FG% ${d.fg_pct}  3P% ${d.fg3_pct}  FT% ${d.ft_pct}`);
    }
    return out;
  };
  const lines = [`HEAD-TO-HEAD MATCHUP: ${p} vs ${q}`, `Season ${cmp.season} — ${st} stats`, ""];
  lines.push(...block(a), "", ...block(b), "");
  if (cmp.series.length) {
    const [pw, ow] = cmp.series_record;
    lines.push(`HEAD-TO-HEAD MEETINGS (${p} ${pw} - ${ow} ${q}):`);
    for (const g of cmp.series) {
      lines.push(`  ${g.date}  ${g.summary}${g.po ? "  [playoffs]" : ""}  (${g.win ? "W" : "L"} for ${p})`);
    }
  } else {
    lines.push("These teams have not played each other in this view.");
  }
  return lines.join("\n");
}

// ── Player profile ───────────────────────────────────────────────────────────

export async function playerProfile(playerId: number, teamId: number, season: string, cache: Cache) {
  const roster = await teamRoster(teamId, season, cache);
  const player = roster.find((p) => p.pid === Number(playerId)) ?? null;
  const note = player && player.absence ? await data.fetchAbsenceNote(player.name, season, cache) : {};
  const adv = (await data.fetchPlayerAdvanced(teamId, season, cache))[String(playerId)] ?? {};
  const shots = await data.fetchShotchart(playerId, teamId, season, cache);
  const trend = await data.fetchPlayerGamelog(playerId, season, cache, 0);

  let per36: Record<string, number> = {};
  if (player?.mpg) {
    const f = 36 / player.mpg;
    per36 = { pts: round(player.ppg * f, 1), reb: round(player.rpg * f, 1), ast: round(player.apg * f, 1) };
  }
  // Bio and combine numbers are extras: the profile still loads without them.
  const bio = await data.fetchPlayerBio(playerId, cache);
  const hasBio = Object.keys(bio).length > 0;
  const anthro = hasBio ? await data.fetchAnthro(playerId, bio, cache) : null;
  return {
    bio: hasBio ? bio : null,
    anthro,
    player,
    absence_note: Object.keys(note).length ? note : null,
    team_id: teamId,
    team_name: getTeamName(teamId),
    season,
    advanced: adv,
    per36,
    shots,
    games: trend,
  };
}

// ── Refresh ──────────────────────────────────────────────────────────────────

/** Drop cached entries for a team + the league-wide keys for a season so the
 *  next request refetches. */
export async function forceRefresh(cache: Cache, season: string, teamId?: number) {
  const tid = teamId ? String(teamId) : null;
  const name = teamId ? getTeamName(teamId) : null;
  await cache.popWhere(
    (k) =>
      (!!tid && (k.includes(tid) || (!!name && k.includes(name)))) ||
      k === `standings_all_${season}` ||
      k.startsWith(`leaders_${season}`) ||
      k.startsWith(`lgl_v2_${season}`) ||
      k.startsWith("upcoming_"),
  );
}
