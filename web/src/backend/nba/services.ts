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

export async function teamOverview(teamId: number, season: string, cache: Cache) {
  const standings = await data.fetchStandings(teamId, season, cache);
  const [reg, po, full] = await teamDashboards(teamId, season, cache);
  const gamesReg = await data.fetchGamelog(teamId, season, cache, 0);
  // only hit the API for playoff games if the team has any
  const gamesPo = data.hasDash(po) ? await data.fetchGamelog(teamId, season, cache, 0, SEASON_TYPE_PLAYOFFS) : [];
  return {
    team_id: teamId,
    team_name: getTeamName(teamId),
    season,
    standings,
    dash: { regular: publicDash(reg), playoffs: publicDash(po), full: publicDash(full) },
    games: { regular: gamesReg, playoffs: gamesPo },
    next_game: season === currentSeason() ? await nextGame(teamId, cache) : null,
  };
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
  const [reg, po, full] = await teamDashboards(teamId, season, cache);
  return data.buildContext(
    getTeamName(teamId),
    await data.fetchStandings(teamId, season, cache),
    reg,
    await data.fetchHistory(teamId, cache),
    await data.fetchRoster(teamId, season, cache),
    await data.fetchGamelog(teamId, season, cache),
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
  const reg = await data.fetchLeagueScoreboard(season, cache, SEASON_TYPE_REGULAR);
  const po = playoffsPossible(season) ? await data.fetchLeagueScoreboard(season, cache, SEASON_TYPE_PLAYOFFS) : [];
  const upcoming = season === currentSeason() ? await data.fetchUpcomingGames(cache) : [];
  return { season, regular: reg, playoffs: po, upcoming };
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
