/** Grounding: before the model answers, find what the question is about
 *  (teams, players, dates) and fetch compact, current fact cards for them, so
 *  answers start from this season's data instead of the model's memory, which
 *  is seasons out of date. Deterministic: no model involved, any model gets
 *  the same facts. The same name matching powers the fact-check. */

import type { Cache } from "../cache";
import { currentSeason, seasonStartYear, seasonStr } from "../config";
import * as news from "../news";
import * as data from "../nba/data";
import * as history from "../nba/history";
import * as services from "../nba/services";
import { TEAMS } from "../nba/teamData";
import { getTeamName, type Team } from "../nba/teams";
import { leaderText, scoreTags } from "./tools";

// ── text helpers ─────────────────────────────────────────────────────────────

/** Lowercase, no accents, no periods/apostrophes: "Dončić" -> "doncic", "Jr." -> "jr". */
export const fold = (s: string) =>
  // possessives drop their 's ("Brunson's" is Brunson)
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/(\w)['’]s\b/g, "$1").replace(/[.'’]/g, "").toLowerCase();

const SUFFIX = /^(jr|sr|ii|iii|iv|v)$/;
export const lastName = (name: string) => fold(name).split(/[\s-]+/).filter((w) => !SUFFIX.test(w)).at(-1) ?? fold(name);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word (whole-phrase) test on folded text. */
const has = (text: string, phrase: string) => new RegExp(`(^|[^a-z0-9])${escape(phrase)}($|[^a-z0-9])`).test(text);

// ── teams ────────────────────────────────────────────────────────────────────

// Short forms fans use that aren't a name, nickname or city.
const TEAM_ALIASES: Record<string, string> = {
  celts: "BOS", sixers: "PHI", cavs: "CLE", mavs: "DAL", wolves: "MIN", "t-wolves": "MIN", twolves: "MIN",
  blazers: "POR", dubs: "GSW", pels: "NOP", grizz: "MEM", nola: "NOP", okc: "OKC", "the bay": "GSW",
};
// Cities two teams share can't pick one.
const SHARED_CITIES = new Set(["los angeles", "la", "new york"]);

/** Teams a text mentions, in order of first mention. Tricodes count only in capitals ("BOS", not "bos"). */
export function findTeams(text: string): Team[] {
  const f = fold(text);
  const hits: [number, Team][] = [];
  for (const t of TEAMS) {
    const names = [t.full_name, t.nickname, ...(SHARED_CITIES.has(fold(t.city)) ? [] : [t.city])].map(fold);
    for (const [alias, abbr] of Object.entries(TEAM_ALIASES)) if (abbr === t.abbreviation) names.push(alias);
    let at = -1;
    for (const n of names) {
      const m = new RegExp(`(^|[^a-z0-9])${escape(n)}($|[^a-z0-9])`).exec(f);
      if (m && (at < 0 || m.index < at)) at = m.index;
    }
    const tri = new RegExp(`\\b${t.abbreviation}\\b`).exec(text);
    if (tri && (at < 0 || tri.index < at)) at = tri.index;
    if (at >= 0) hits.push([at, t]);
  }
  return hits.sort((a, b) => a[0] - b[0]).map(([, t]) => t);
}

// ── players ──────────────────────────────────────────────────────────────────

export interface IndexedPlayer {
  pid: number;
  name: string;
  /** This season's team, when the player has played (league stats). */
  team_abbr?: string;
  team_id?: number;
  row?: data.LeaguePlayerRow;
  /** Not an active player: matched by full name or nickname only. */
  retired?: boolean;
}

// Well-known nicknames -> full names. Used only if that player is in the index.
const NICKNAMES: Record<string, string> = {
  pg: "Paul George", pg13: "Paul George", kd: "Kevin Durant", ad: "Anthony Davis", sga: "Shai Gilgeous-Alexander",
  wemby: "Victor Wembanyama", lebron: "LeBron James", bron: "LeBron James", giannis: "Giannis Antetokounmpo",
  luka: "Luka Dončić", steph: "Stephen Curry", joker: "Nikola Jokić", "ant-man": "Anthony Edwards", ant: "Anthony Edwards",
  dame: "Damian Lillard", cp3: "Chris Paul", zion: "Zion Williamson", trae: "Trae Young", jokic: "Nikola Jokić",
  embiid: "Joel Embiid", jt: "Jayson Tatum", jb: "Jaylen Brown", "the brow": "Anthony Davis", spida: "Donovan Mitchell",
  // legends
  mj: "Michael Jordan", "his airness": "Michael Jordan", "larry legend": "Larry Bird", shaq: "Shaquille O'Neal",
  kobe: "Kobe Bryant", "the mamba": "Kobe Bryant", "the dream": "Hakeem Olajuwon", hakeem: "Hakeem Olajuwon",
  "the mailman": "Karl Malone", "the admiral": "David Robinson", "dr j": "Julius Erving", "the big fundamental": "Tim Duncan",
  kareem: "Kareem Abdul-Jabbar", wilt: "Wilt Chamberlain", "the big o": "Oscar Robertson", "the logo": "Jerry West",
  "the answer": "Allen Iverson", dirk: "Dirk Nowitzki", "pistol pete": "Pete Maravich",
  "the glove": "Gary Payton", "penny": "Anfernee Hardaway", kg: "Kevin Garnett", "the truth": "Paul Pierce",
};
// Last names that are everyday words: only matched when capitalized.
const COMMON_WORDS = new Set([
  "smart", "young", "love", "holiday", "green", "white", "brown", "black", "house", "banks", "price", "bridges", "hunter",
  "walker", "wall", "king", "rose", "mann", "james", "johnson", "jones", "williams", "allen", "carter", "porter", "ball",
  "hart", "bell", "booker", "rivers", "wells", "sharpe", "bates", "little", "strong", "early", "christian", "moody",
  "payne", "reed", "ware", "battle", "hood", "fox", "gay", "bane", "nance", "grant", "may", "wiggins", "mobley",
]);

export class PlayerIndex {
  /** folded full name -> players */
  private full = new Map<string, IndexedPlayer[]>();
  /** folded last name -> players (league index only) */
  private last = new Map<string, IndexedPlayer[]>();
  readonly list: IndexedPlayer[];

  constructor(league: data.LeaguePlayerRow[], listed: [number, string, number][] = []) {
    const byPid = new Map<number, IndexedPlayer>();
    for (const r of league) byPid.set(r.pid, { pid: r.pid, name: r.name, team_abbr: r.team_abbr, team_id: r.team_id, row: r });
    for (const [pid, name, active] of listed) if (!byPid.has(pid)) byPid.set(pid, active ? { pid, name } : { pid, name, retired: true });
    this.list = [...byPid.values()];
    for (const p of this.list) {
      const k = fold(p.name);
      // the same name in two eras (Gary Payton, Gary Payton II): the current player first
      this.full.set(k, p.retired ? [...(this.full.get(k) ?? []), p] : [p, ...(this.full.get(k) ?? [])]);
      if (p.row) {
        const l = lastName(p.name);
        if (l.length >= 4) this.last.set(l, [...(this.last.get(l) ?? []), p]);
      }
    }
  }

  byName(name: string) {
    return this.full.get(fold(name))?.[0];
  }

  /** Players a text names, by first mention: full names, nicknames, then
   *  league-unique last names (common-word surnames only when capitalized). */
  find(text: string, max = 6): IndexedPlayer[] {
    const f = fold(text);
    const hits = new Map<number, [number, IndexedPlayer]>();
    const add = (at: number, p: IndexedPlayer | undefined) => {
      if (p && (!hits.has(p.pid) || hits.get(p.pid)![0] > at)) hits.set(p.pid, [at, p]);
    };
    const tokens = [...f.matchAll(/[a-z0-9]+(?:-[a-z0-9]+)*/g)];
    // full names: check each player's full name against the text
    for (const [k, ps] of this.full) {
      if (k.length < 5 || !f.includes(k)) continue;
      const m = new RegExp(`(^|[^a-z0-9])${escape(k)}($|[^a-z0-9])`).exec(f);
      if (m) add(m.index, ps[0]);
    }
    for (const t of tokens) {
      const nick = NICKNAMES[t[0]];
      if (nick) add(t.index!, this.byName(nick));
      const ps = this.last.get(t[0]);
      if (ps?.length === 1) {
        const p = ps[0];
        // capitalized in the original text, or not an everyday word
        const orig = text.normalize("NFKD").replace(/[̀-ͯ]/g, "").slice(t.index!, t.index! + t[0].length);
        if (!COMMON_WORDS.has(t[0]) || /^[A-Z]/.test(orig)) add(t.index!, p);
      }
    }
    // a two-word nickname like "the brow"
    for (const [k, full] of Object.entries(NICKNAMES)) if (k.includes(" ") && has(f, k)) add(f.indexOf(k), this.byName(full));
    return [...hits.values()].sort((a, b) => a[0] - b[0]).map(([, p]) => p).slice(0, max);
  }
}

let listed: Promise<[number, string, number][]> | null = null;
const loadListed = () => (listed ??= import("./players.json").then((m) => m.default as [number, string, number][]).catch(() => []));

/** Everyone who's played this season, plus the bundled list for the rest. */
export async function playerIndex(cache: Cache) {
  const [league, all] = await Promise.all([data.fetchLeaguePlayerStats(currentSeason(), cache).catch(() => [] as data.LeaguePlayerRow[]), loadListed()]);
  return new PlayerIndex(league, all);
}

// ── dates ────────────────────────────────────────────────────────────────────

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** YYYYMMDD shifted by `days`. */
export function shiftDay(ymd: string, days: number) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + days, 12));
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}
const isoOf = (ymd: string) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
const weekdayOf = (ymd: string) => new Date(`${isoOf(ymd)}T12:00:00Z`).getUTCDay();

/** Days (YYYYMMDD, NBA/Eastern calendar) a text refers to. */
export function findDates(text: string, today = data.nbaToday()): string[] {
  const f = fold(text);
  const out: string[] = [];
  const add = (d: string) => !out.includes(d) && out.push(d);
  // typos too ("yesterdat", "tonite", "tmrw")
  if (/\b(today|tdy|tonight|tonights|tonite|toniight)\b/.test(f)) add(today);
  if (/\b(yest[a-z]*|ystrdy|last (?:night|nite))\b/.test(f)) add(shiftDay(today, -1));
  if (/\b(tom+or+ow[a-z]*|tmrw|tmr|tomm?or+ow)\b/.test(f)) add(shiftDay(today, 1));
  WEEKDAYS.forEach((w, i) => {
    const m = new RegExp(`\\b(next |this )?${w}s?\\b`).exec(f);
    if (!m) return;
    const diff = (weekdayOf(today) - i + 7) % 7;
    add(m[1] ? shiftDay(today, (i - weekdayOf(today) + 7) % 7 || 7) : shiftDay(today, -diff));
  });
  // The season runs Oct-Jun: months from October belong to its first year.
  const start = seasonStartYear(currentSeason());
  const year = (month: number) => (month >= 9 ? start : start + 1);
  const day = (mo: number, d: number) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${year(mo)}${String(mo).padStart(2, "0")}${String(d).padStart(2, "0")}` : "");
  for (const m of f.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? (\d{1,2})(st|nd|rd|th)?\b/g)) {
    const d = day(MONTHS.indexOf(m[1].slice(0, 3)) + 1, +m[2]);
    if (d) add(d);
  }
  for (const m of f.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g)) add(`${m[1]}${m[2]}${m[3]}`);
  // 10/26 — but not shooting lines like "7/15 from three"
  for (const m of f.matchAll(/(^|[^\d/])(\d{1,2})\/(\d{1,2})(?![\d/])(?!\s*(from|fg|ft|3|three|shooting|on))/g)) {
    const mo = +m[2];
    if (mo >= 10 || mo <= 6) {
      const d = day(mo, +m[3]);
      if (d) add(d);
    }
  }
  return out.slice(0, 3);
}

// ── seasons ──────────────────────────────────────────────────────────────────

const COUNT: Record<string, number> = { one: 1, a: 1, two: 2, three: 3, four: 4, five: 5 };

/** Past seasons a text refers to ("last year", "2024-25", "two seasons ago",
 *  "the 2025 playoffs"), newest first. The current season isn't listed. */
export function findSeasons(text: string, current = currentSeason()): string[] {
  const f = fold(text);
  const now = seasonStartYear(current);
  const out: number[] = [];
  const add = (start: number) => start < now && start >= 1946 && !out.includes(start) && out.push(start);
  if (/\b(last|previous|past|prior) (season|year)\b|\b(a|one) (season|year) ago\b|\blast years?\b/.test(f)) add(now - 1);
  if (/\b(season|year) before last\b/.test(f)) add(now - 2);
  for (const m of f.matchAll(/\b(one|two|three|four|five|\d) (seasons|years) ago\b/g)) add(now - (COUNT[m[1]] ?? +m[1]));
  // "2024-25", "2024-2025", "2024/25"
  for (const m of f.matchAll(/\b(19[4-9]\d|20\d\d)\s*[-–/]\s*(\d{2}|\d{4})\b/g)) {
    const start = +m[1];
    if (+m[2].slice(-2) === (start + 1) % 100) add(start);
  }
  // "the 24-25 season", "'24-25"
  for (const m of f.matchAll(/(?:^|[^\d])(\d\d)-(\d\d) season\b|'(\d\d)-(\d\d)\b/g)) {
    const a = +(m[1] ?? m[3]);
    const b = +(m[2] ?? m[4]);
    if ((a + 1) % 100 === b) add(a > 45 ? 1900 + a : 2000 + a);
  }
  // A bare year is the season that ended in it: "the 2025 playoffs" is 2024-25 (a draft isn't a season).
  for (const m of f.matchAll(/\b(?:in|the|of|during|for|from|since)\s+(19[4-9]\d|20\d\d)(?![\d/–-])(?! draft)/g)) add(+m[1] - 1);
  return out.sort((a, b) => b - a).slice(0, 2).map(seasonStr);
}

// ── fact cards ───────────────────────────────────────────────────────────────

export interface Card {
  label: string;
  text: string;
}

const pct = (v: unknown) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "");
const num1 = (v: unknown) => (typeof v === "number" ? v.toFixed(1) : "?");

async function playerCard(p: IndexedPlayer, injuries: Record<string, news.InjuryRow[]>, cache: Cache, withLog: boolean): Promise<Card> {
  const season = currentSeason();
  const injured = Object.entries(injuries).flatMap(([team, rows]) => rows.filter((r) => fold(r.player) === fold(p.name)).map((r) => ({ team, ...r })))[0];
  const lines: string[] = [];
  if (p.row) {
    const r = p.row;
    lines.push(
      `${p.name} — plays for ${getTeamName(r.team_id) || r.team_abbr} (${r.team_abbr}) in ${season} · ${r.gp} GP · ` +
        `${num1(r.PTS)} pts, ${num1(r.REB)} reb, ${num1(r.AST)} ast, ${num1(r.MIN)} min, FG ${pct(r.FG_PCT)}, 3P ${pct(r.FG3_PCT)}`,
    );
  } else if (injured) {
    lines.push(`${p.name} — on the ${injured.team} (injury report), no games yet in ${season}`);
  } else {
    lines.push(`${p.name} — no NBA games logged in ${season}; current team unknown (do not assume one)`);
  }
  if (injured) lines.push(`status: ${injured.status}${injured.injury ? ` (${injured.injury})` : ""}${injured.return_date ? `, expected back ${injured.return_date}` : ""}`);
  if (withLog && p.row) {
    const games = await data.fetchPlayerGamelog(p.pid, season, cache, 5).catch(() => []);
    if (games.length) lines.push("last games: " + [...games].reverse().map((g) => `${g.date} ${g.matchup} ${g.pts}p ${g.reb}r ${g.ast}a`).join("; "));
  }
  return { label: p.name, text: `PLAYER ${lines.join(" · ")}` };
}

/** Questions about the past: a prime, a career, an era, a hypothetical, a year. */
export const HISTORY = /\b(prime|peak|career|all[- ]time|greatest|goat|best season|back in|in his day|era|eras|hypothetical|who would win|would (?:win|beat)|vs\.?|versus|compare[ds]?|comparison|legacy|hall of fame|rookie (?:year|season)|retired|legend|(?:last|previous|past|prior) (?:season|year)|(?:seasons|years) ago|used to|formerly|(?:19[4-9]\d|20[0-2]\d)(?:-\d\d)?|'\d\d)\b/i;

/** A player's career in a few lines: years, teams, averages, best stretch, honors. */
export async function careerCard(p: IndexedPlayer, cache: Cache): Promise<Card | null> {
  const c = await history.fetchCareer(p.pid, p.name, !p.retired, cache).catch(() => null);
  return c ? { label: `${c.name} (career)`, text: history.careerSummary(c) } : null;
}

/** Data for players an answer names that the question didn't bring up: the
 *  current card for active players, the career for everyone else. */
export async function namedPlayerData(players: IndexedPlayer[], cache: Cache): Promise<string> {
  const injuries = await news.injuries(cache).catch(() => ({}) as Record<string, news.InjuryRow[]>);
  const cards = await Promise.all(
    players.slice(0, 4).map((p) => (p.retired || !p.row ? careerCard(p, cache) : playerCard(p, injuries, cache, true)).catch(() => null)),
  );
  return cards.flatMap((c) => (c ? [c.text] : [])).join("\n\n");
}

async function teamCard(t: Team, cache: Cache, injuries: Record<string, news.InjuryRow[]>): Promise<Card> {
  const season = currentSeason();
  const [standings, roster, overview, next] = await Promise.all([
    data.fetchAllStandings(season, cache).catch(() => [] as data.StandingRow[]),
    services.teamRoster(t.id, season, cache).catch(() => [] as services.TeamRosterRow[]),
    services.teamOverview(t.id, season, cache).catch(() => null),
    services.nextGame(t.id, cache).catch(() => null),
  ]);
  const st = standings.find((r) => r.team_id === t.id);
  const ov: any = overview?.standings;
  const rec = ov?.wins !== undefined ? `${ov.wins}-${ov.losses}` : st ? `${st.wins}-${st.losses}` : "";
  const head = [
    `TEAM ${t.full_name} ${season}`,
    rec && `record ${rec}`,
    st && `${st.conference} #${st.rank}`,
    st?.last10 && `L10 ${st.last10}`,
    st?.streak && `streak ${st.streak}`,
  ].filter(Boolean).join(" · ");
  const inj = new Map((injuries[t.full_name] ?? []).map((r) => [fold(r.player), r.status]));
  const players = [...roster]
    .sort((a, b) => b.mpg - a.mpg)
    .slice(0, 12)
    .map((p) => `${p.name}${p.pos ? ` ${p.pos}` : ""} ${p.gp ? `${p.ppg.toFixed(1)} ppg` : "no games yet"}${inj.has(fold(p.name)) ? ` (${inj.get(fold(p.name))!.toLowerCase()})` : ""}`);
  const lines = [head];
  lines.push(players.length ? `ROSTER (complete current roster; anyone not listed is NOT on this team): ${players.join(", ")}` : "ROSTER: couldn't be loaded right now");
  const last: any = overview?.games.regular[0];
  if (last) lines.push(`last game: ${last.date} ${last.matchup} ${last.wl} ${last.pts}-${last.pts - last.plus_minus}${last.pending ? " (box score pending)" : ""}`);
  if (next) lines.push(`next game: ${next.away.abbr} @ ${next.home.abbr}, ${next.date_utc}`);
  return { label: t.nickname, text: lines.join("\n") };
}

/** One player in one past season: team(s), games and starts, averages, playoffs.
 *  `teams` are that season's teams, so their rosters can be pulled too. */
async function playerSeasonCard(p: IndexedPlayer, season: string, cache: Cache): Promise<(Card & { teams: string[] }) | null> {
  const c = await history.fetchCareer(p.pid, p.name, !p.retired, cache).catch(() => null);
  if (!c) return null;
  const reg = c.regular.find((l) => l.season === season);
  const po = c.playoffs.find((l) => l.season === season);
  const label = `${c.name} ${season}`;
  if (!reg) return { label, teams: [], text: `PLAYER ${c.name} in ${season}: no NBA games that season (career ${c.years}, teams ${c.teams.join(", ")})` };
  const lines = [`PLAYER ${c.name} in ${season} — regular season ${history.seasonText(reg)}`, po ? `playoffs ${history.seasonText(po)}` : "no playoff games"];
  return { label, teams: reg.team.split("/"), text: lines.join(" · ") };
}

/** A team in one past season: record, seed, and everyone who played for it. */
async function pastTeamCard(t: Team, season: string, cache: Cache): Promise<Card> {
  const [standings, roster] = await Promise.all([
    data.fetchAllStandings(season, cache).catch(() => [] as data.StandingRow[]),
    data.fetchRoster(t.id, season, cache).catch(() => [] as data.RosterRow[]),
  ]);
  const st = standings.find((r) => r.team_id === t.id);
  const head = [`TEAM ${t.full_name} in ${season}`, st && `record ${st.wins}-${st.losses}`, st && `${st.conference} #${st.rank}`].filter(Boolean).join(" · ");
  const played = roster.filter((p) => p.gp > 0).sort((a, b) => b.mpg - a.mpg);
  const players = played.map((p) => `${p.name}${p.pos ? ` ${p.pos}` : ""} ${p.gp} GP ${p.mpg.toFixed(1)} min ${p.ppg.toFixed(1)} ppg`);
  const lines = [head];
  lines.push(
    players.length
      ? `ROSTER ${season} (everyone who played for the ${t.nickname} that season, most minutes first; anyone not listed did NOT play for them in ${season}): ${players.join(", ")}`
      : `ROSTER ${season}: couldn't be loaded right now`,
  );
  return { label: `${t.nickname} ${season}`, text: lines.join("\n") };
}

async function dateCard(day: string): Promise<Card> {
  const sb = await data.fetchScoreboard(day);
  const iso = isoOf(day);
  const label = new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) + " games";
  if (!sb.games.length) return { label, text: `GAMES ON ${iso}: none` };
  const line = (g: data.LiveGame) => {
    if (g.state === "pre") return `${g.away.abbr} (${g.away.record}) @ ${g.home.abbr} (${g.home.record}) · ${g.status_text}${g.odds?.details ? ` · line ${g.odds.details}` : ""}`;
    const lead = [leaderText(g.away), leaderText(g.home)].filter(Boolean).join(" · ");
    return `${g.state === "post" ? "FINAL" : `LIVE ${g.status_text}`}: ${scoreTags(g)}${lead ? ` · ${lead}` : ""}`;
  };
  const all = `every NBA game that day (${sb.games.length}); there were no others, and a team not listed didn't play`;
  return { label, text: `GAMES ON ${iso} — ${all}:\n${sb.games.map((g) => `- ${line(g)}`).join("\n")}` };
}

// ── putting it together ──────────────────────────────────────────────────────

export interface Grounding {
  cards: Card[];
  /** The block added to the model's copy of the user's message, or "". */
  block: string;
}

export const GROUNDING_HEADER =
  "DATA FOR THIS QUESTION (from nba.com and ESPN; this season unless a card names another season; it overrides anything you remember):";

/** Cards for one past season: each named player's season, and the rosters of
 *  the teams named or that those players were on (the followed team if neither). */
async function seasonCards(season: string, teams: Team[], players: IndexedPlayer[], followed: Team | undefined, cache: Cache): Promise<Card[]> {
  const mine = (await Promise.all(players.slice(0, 3).map((p) => playerSeasonCard(p, season, cache).catch(() => null)))).filter((c) => !!c);
  const their = mine.flatMap((c) => c.teams).map((abbr) => TEAMS.find((t) => t.abbreviation === abbr)).filter((t): t is Team => !!t);
  const list = [...teams, ...their].filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i);
  if (!list.length && !players.length && followed) list.push(followed);
  const rosters = await Promise.all(list.slice(0, 3).map((t) => pastTeamCard(t, season, cache).catch(() => null)));
  return [...mine.map(({ label, text }) => ({ label, text })), ...rosters.filter((c) => !!c)];
}

/** Fact cards for a question. `followed` is the team the user follows; its
 *  card is always included. Cards that don't fit `budget` are dropped whole. */
export async function ground(
  question: string,
  opts: { followed?: number | null; cache: Cache; budget: number; previous?: string; index?: PlayerIndex },
): Promise<Grounding> {
  const { cache, budget } = opts;
  const idx = opts.index ?? (await playerIndex(cache));
  // A follow-up ("and him?") inherits what the previous question was about.
  const subject = findTeams(question).length || idx.find(question).length || findDates(question).length ? question : `${opts.previous ?? ""}\n${question}`;
  const teams = findTeams(subject).slice(0, 3);
  const players = idx.find(subject, 4);
  const dates = findDates(subject);
  // "last year", "2023-24": a follow-up keeps the season the conversation was on
  const seasons = findSeasons(question).length ? findSeasons(question) : findSeasons(subject);
  const injuries = await news.injuries(cache).catch(() => ({}) as Record<string, news.InjuryRow[]>);
  const followed = opts.followed ? TEAMS.find((t) => t.id === opts.followed) : undefined;
  const teamList = [...teams, ...(followed && !teams.some((t) => t.id === followed.id) ? [followed] : [])];

  const settled = await Promise.allSettled([
    ...seasons.map((s) => seasonCards(s, teams, players, followed, cache)),
    ...dates.map((d) => dateCard(d)),
    // retired players get their career; active ones their season, plus the career when the question reaches back
    ...players.map((p, i) => (p.retired ? careerCard(p, cache) : playerCard(p, injuries, cache, i < 3))),
    ...(HISTORY.test(subject) ? players.filter((p) => !p.retired).slice(0, 3).map((p) => careerCard(p, cache)) : []),
    ...teamList.map((t) => teamCard(t, cache, injuries)),
  ]);
  const cards = settled.flatMap((r) => (r.status === "fulfilled" && r.value ? (Array.isArray(r.value) ? r.value : [r.value]) : []));
  // The followed team's card is reserved first; the rest fill in by order of mention.
  const followedCard = followed ? cards.find((c) => c.label === followed.nickname) : undefined;
  const kept: Card[] = [];
  let used = followedCard ? followedCard.text.length : 0;
  for (const c of cards) {
    if (c === followedCard) continue;
    if (used + c.text.length > budget) continue;
    kept.push(c);
    used += c.text.length;
  }
  if (followedCard) kept.push(followedCard);
  return { cards: kept, block: kept.length ? `${GROUNDING_HEADER}\n${kept.map((c) => c.text).join("\n\n")}` : "" };
}
