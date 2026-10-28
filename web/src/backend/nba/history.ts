/** Basketball history on demand: any player's whole career (every season,
 *  playoffs, awards, his best stretch), league leaders and scoring levels for
 *  any past season from stats.nba.com, and background from Wikipedia. Nothing
 *  is stored ahead of time; what's asked for is cached (finished careers and
 *  seasons for a month, active ones for hours). */

import type { Cache } from "../cache";
import { CACHE_TTL, currentSeason, PAST_SEASON_TTL, seasonStartYear } from "../config";
import { getJson } from "../http";
import { fetchPlayerBio } from "./data";
import { int, num, resultSet, round, statsGet, str, type Row } from "./stats";

/** Rows of a result set by its name ("SeasonTotalsRegularSeason"). */
function named(j: any, name: string): Row[] {
  const set = (j?.resultSets ?? []).find((s: any) => s?.name === name);
  if (!set) return [];
  const headers: string[] = set.headers ?? [];
  return (set.rowSet ?? []).map((r: unknown[]) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

const seasonOf = (start: number) => `${start}-${String((start + 1) % 100).padStart(2, "0")}`;

// ── a career ─────────────────────────────────────────────────────────────────

export interface SeasonLine {
  season: string;
  team: string;
  age: number | null;
  gp: number;
  mpg: number;
  ppg: number;
  rpg: number;
  apg: number;
  spg: number | null;
  bpg: number | null;
  fg_pct: number | null;
  fg3_pct: number | null;
  ft_pct: number | null;
  ts_pct: number | null;
  /** Hollinger's Game Score per game: one number for a season's overall impact. */
  gmsc: number;
}

/** stats.nba.com only began counting steals and blocks in 1973-74. */
const tracked = (season: string) => seasonStartYear(season) >= 1973;

function line(r: Row, teams?: string): SeasonLine {
  const season = str(r.SEASON_ID);
  const pts = num(r.PTS);
  const fga = num(r.FGA);
  const fta = num(r.FTA);
  const tsa = 2 * (fga + 0.44 * fta);
  const s = tracked(season);
  const pct = (v: unknown) => (v === null || v === undefined || v === "" ? null : round(num(v) * 100, 1));
  const gmsc =
    pts + 0.4 * num(r.FGM) - 0.7 * fga - 0.4 * (fta - num(r.FTM)) + 0.7 * num(r.OREB) + 0.3 * num(r.DREB) +
    num(r.STL) + 0.7 * num(r.AST) + 0.7 * num(r.BLK) - 0.4 * num(r.PF) - num(r.TOV);
  return {
    season,
    team: teams ?? str(r.TEAM_ABBREVIATION),
    age: r.PLAYER_AGE === null || r.PLAYER_AGE === undefined ? null : int(r.PLAYER_AGE),
    gp: int(r.GP),
    mpg: round(num(r.MIN), 1),
    ppg: round(pts, 1),
    rpg: round(num(r.REB), 1),
    apg: round(num(r.AST), 1),
    spg: s ? round(num(r.STL), 1) : null,
    bpg: s ? round(num(r.BLK), 1) : null,
    fg_pct: pct(r.FG_PCT),
    fg3_pct: seasonStartYear(season) >= 1979 ? pct(r.FG3_PCT) : null,
    ft_pct: pct(r.FT_PCT),
    ts_pct: tsa > 0 ? round((pts / tsa) * 100, 1) : null,
    gmsc: round(gmsc, 1),
  };
}

/** One line per season: a traded season is its combined ("TOT") row, with the teams joined. */
function seasons(rows: Row[]): SeasonLine[] {
  const bySeason = new Map<string, Row[]>();
  for (const r of rows) bySeason.set(str(r.SEASON_ID), [...(bySeason.get(str(r.SEASON_ID)) ?? []), r]);
  return [...bySeason.values()].map((rs) => {
    const tot = rs.find((r) => str(r.TEAM_ABBREVIATION) === "TOT");
    const teams = rs.filter((r) => str(r.TEAM_ABBREVIATION) !== "TOT").map((r) => str(r.TEAM_ABBREVIATION));
    return tot ? line(tot, teams.join("/")) : line(rs[0]);
  });
}

export interface Peak {
  seasons: string;
  gp: number;
  ppg: number;
  rpg: number;
  apg: number;
  ts_pct: number | null;
  gmsc: number;
}

/** The best run of `n` straight seasons by Game Score (seasons with 40+ games). */
export function peak(lines: SeasonLine[], n: number): Peak | null {
  const full = lines.filter((l) => l.gp >= 40);
  let best: Peak | null = null;
  for (let i = 0; i + n <= full.length; i++) {
    const w = full.slice(i, i + n);
    // straight seasons only
    if (seasonStartYear(w.at(-1)!.season) - seasonStartYear(w[0].season) !== n - 1) continue;
    const gp = w.reduce((a, l) => a + l.gp, 0);
    const avg = (f: (l: SeasonLine) => number) => round(w.reduce((a, l) => a + f(l) * l.gp, 0) / gp, 1);
    const ts = w.every((l) => l.ts_pct !== null) ? avg((l) => l.ts_pct!) : null;
    const p = { seasons: `${w[0].season} to ${w.at(-1)!.season}`, gp, ppg: avg((l) => l.ppg), rpg: avg((l) => l.rpg), apg: avg((l) => l.apg), ts_pct: ts, gmsc: avg((l) => l.gmsc) };
    if (!best || p.gmsc > best.gmsc) best = p;
  }
  return best;
}

export interface Awards {
  /** "NBA Most Valuable Player" -> seasons won */
  [award: string]: string[];
}

const AWARD_NAMES: [RegExp, string][] = [
  [/^NBA Most Valuable Player/i, "MVP"],
  [/Finals Most Valuable Player/i, "Finals MVP"],
  [/^NBA Champion/i, "Champion"],
  [/^All-NBA/i, "All-NBA"],
  [/^NBA All-Star Most Valuable Player/i, "All-Star MVP"],
  [/^NBA All-Star$/i, "All-Star"],
  [/^All-Defensive/i, "All-Defensive"],
  [/Defensive Player of the Year/i, "Defensive Player of the Year"],
  [/^NBA Rookie of the Year/i, "Rookie of the Year"],
  [/All-Rookie/i, "All-Rookie"],
  [/Sixth Man/i, "Sixth Man of the Year"],
  [/Most Improved/i, "Most Improved Player"],
  [/Clutch Player/i, "Clutch Player of the Year"],
  [/Olympic Gold/i, "Olympic gold"],
  [/Hall of Fame/i, "Hall of Fame"],
  [/Scoring Champion|Scoring Title/i, "Scoring title"],
];

function awards(rows: Row[]): Awards {
  const out: Awards = {};
  for (const r of rows) {
    if (/weekly|monthly/i.test(str(r.TYPE))) continue;
    const desc = str(r.DESCRIPTION);
    const hit = AWARD_NAMES.find(([re]) => re.test(desc));
    if (!hit) continue;
    let label = hit[1];
    const team = str(r.ALL_NBA_TEAM_NUMBER);
    if ((label === "All-NBA" || label === "All-Defensive" || label === "All-Rookie") && team) label += ` ${team === "1" ? "1st" : team === "2" ? "2nd" : team === "3" ? "3rd" : team}`;
    out[label] = [...(out[label] ?? []), str(r.SEASON)].filter(Boolean);
  }
  return out;
}

export interface Career {
  pid: number;
  name: string;
  active: boolean;
  years: string;
  position: string;
  height: string;
  draft: string;
  teams: string[];
  regular: SeasonLine[];
  playoffs: SeasonLine[];
  career: SeasonLine | null;
  playoff_career: SeasonLine | null;
  awards: Awards;
  peak3: Peak | null;
  peak5: Peak | null;
}

/** A player's whole career, from one stats.nba.com call plus his awards and bio. */
export function fetchCareer(pid: number, name: string, active: boolean, cache: Cache): Promise<Career | null> {
  return cache.getOrFetch<Career | null>(
    `career_v1_${pid}`,
    async () => {
      const j = await statsGet("playercareerstats", { PlayerID: pid, PerMode: "PerGame", LeagueID: "00" });
      const regular = seasons(named(j, "SeasonTotalsRegularSeason"));
      if (!regular.length) return null;
      const playoffs = seasons(named(j, "SeasonTotalsPostSeason"));
      const total = (set: string) => {
        const r = named(j, set)[0];
        return r ? { ...line({ ...r, SEASON_ID: "career" }), season: "career" } : null;
      };
      const aw = await statsGet("playerawards", { PlayerID: pid }).then((a) => awards(named(a, "PlayerAwards"))).catch(() => ({}));
      const bio = await fetchPlayerBio(pid, cache).catch(() => ({}) as Record<string, any>);
      const teams: string[] = [];
      for (const l of regular) for (const t of l.team.split("/")) if (!teams.includes(t)) teams.push(t);
      const h = bio.height_in ? `${Math.floor(bio.height_in / 12)}-${bio.height_in % 12}` : "";
      const draft = bio.draft_year ? (bio.draft_pick ? `${bio.draft_year} round ${bio.draft_round}, pick ${bio.draft_pick}` : `${bio.draft_year}, undrafted`) : "";
      return {
        pid,
        name: bio.name || name,
        active,
        years: `${regular[0].season} to ${regular.at(-1)!.season}`,
        position: bio.position ?? "",
        height: h,
        draft,
        teams,
        regular,
        playoffs,
        career: total("CareerTotalsRegularSeason"),
        playoff_career: total("CareerTotalsPostSeason"),
        awards: aw,
        peak3: peak(regular, 3),
        peak5: peak(regular, 5),
      };
    },
    { ttl: active ? CACHE_TTL : PAST_SEASON_TTL, fallback: null },
  );
}

// ── text forms (compact, for the model and the fact-check) ─────────────────

const f1 = (v: number | null) => (v === null ? "—" : v.toFixed(1));

export function seasonText(l: SeasonLine) {
  const stocks = l.spg === null ? "" : ` ${f1(l.spg)} stl ${f1(l.bpg)} blk`;
  const shoot = [l.fg_pct !== null && `FG ${f1(l.fg_pct)}%`, l.fg3_pct !== null && `3P ${f1(l.fg3_pct)}%`, l.ft_pct !== null && `FT ${f1(l.ft_pct)}%`, l.ts_pct !== null && `TS ${f1(l.ts_pct)}%`]
    .filter(Boolean)
    .join(" ");
  return `${l.season}${l.team && l.season !== "career" ? ` ${l.team}` : ""}${l.age ? ` age ${l.age}` : ""}: ${l.gp} GP, ${f1(l.mpg)} min, ${f1(l.ppg)} pts ${f1(l.rpg)} reb ${f1(l.apg)} ast${stocks}, ${shoot}`;
}

const peakText = (p: Peak) => `${p.seasons}: ${f1(p.ppg)} pts ${f1(p.rpg)} reb ${f1(p.apg)} ast${p.ts_pct !== null ? `, TS ${f1(p.ts_pct)}%` : ""} (${p.gp} GP)`;

export function awardsText(a: Awards) {
  const order = ["Champion", "MVP", "Finals MVP", "All-NBA 1st", "All-NBA 2nd", "All-NBA 3rd", "All-Star", "Defensive Player of the Year", "All-Defensive 1st", "All-Defensive 2nd", "Rookie of the Year", "Scoring title", "Sixth Man of the Year", "Most Improved Player", "Clutch Player of the Year", "All-Star MVP", "Olympic gold"];
  const keys = [...order.filter((k) => a[k]), ...Object.keys(a).filter((k) => !order.includes(k) && !/All-Rookie/.test(k))];
  return keys.map((k) => (a[k].length > 3 ? `${k} ×${a[k].length}` : `${k} ${a[k].join(", ")}`)).join("; ") || "none listed";
}

/** A compact career summary: who, when, where, averages, best stretch, honors. */
export function careerSummary(c: Career) {
  const best = [...c.regular].filter((l) => l.gp >= 40).sort((a, b) => b.gmsc - a.gmsc)[0];
  return [
    `CAREER ${c.name} (${c.active ? "active" : "retired"}) · ${c.years} · ${c.teams.join(", ")}${c.position ? ` · ${c.position}` : ""}${c.height ? ` · ${c.height}` : ""}${c.draft ? ` · drafted ${c.draft}` : ""}`,
    c.career && `career regular season ${seasonText(c.career).replace(/^career: /, "")}`,
    c.playoff_career && `career playoffs ${seasonText(c.playoff_career).replace(/^career: /, "")}`,
    c.peak5 && `best 5 straight seasons ${peakText(c.peak5)}`,
    c.peak3 && `best 3 straight seasons ${peakText(c.peak3)}`,
    best && `best single season ${seasonText(best)}`,
    `honors: ${awardsText(c.awards)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The summary plus every season (and playoff season). */
export function careerText(c: Career, opts: { playoffs?: boolean } = {}) {
  const out = [careerSummary(c), "regular seasons:", ...c.regular.map(seasonText)];
  if (opts.playoffs !== false && c.playoffs.length) out.push("playoffs:", ...c.playoffs.map(seasonText));
  return out.join("\n");
}

// ── seasons ──────────────────────────────────────────────────────────────────

/** League-wide scoring that season: points, FG% and threes per team game. */
export function fetchLeagueAverages(season: string, cache: Cache) {
  return cache.getOrFetch<{ season: string; ppg: number; fg_pct: number; fg3a: number } | null>(
    `league_avg_${season}`,
    async () => {
      const j = await statsGet("leaguegamelog", {
        Counter: 0, Direction: "ASC", LeagueID: "00", PlayerOrTeam: "T", Season: season,
        SeasonType: "Regular Season", Sorter: "DATE", DateFrom: "", DateTo: "",
      }, 45);
      const done = resultSet(j).filter((r) => str(r.WL).trim());
      if (!done.length) return null;
      const avg = (k: string) => done.reduce((a, r) => a + num(r[k]), 0) / done.length;
      return { season, ppg: round(avg("PTS"), 1), fg_pct: round(avg("FG_PCT") * 100, 1), fg3a: round(avg("FG3A"), 1) };
    },
    { ttl: season === currentSeason() ? CACHE_TTL : PAST_SEASON_TTL, fallback: null },
  );
}

/** League leaders for any season back to the 1950s (nba.com's leagueleaders),
 *  qualified per that era's rules. `category` is a stat column (PTS, REB, AST,
 *  STL, BLK, FG_PCT, FG3_PCT, FT_PCT, FG3M, MIN, TOV, EFF). */
export function fetchHistoricalLeaders(season: string, category: string, cache: Cache, seasonType = "Regular Season") {
  return cache.getOrFetch<Row[]>(
    `hist_leaders_${season}_${category}_${seasonType}`,
    async () => {
      const j = await statsGet("leagueleaders", {
        LeagueID: "00", PerMode: "PerGame", Scope: "S", Season: season, SeasonType: seasonType, StatCategory: category, ActiveFlag: "",
      });
      const set = j?.resultSet ?? j?.resultSets?.[0];
      const headers: string[] = set?.headers ?? [];
      return (set?.rowSet ?? []).map((r: unknown[]) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
    },
    { ttl: season === currentSeason() ? CACHE_TTL : PAST_SEASON_TTL, fallback: [] },
  );
}

/** nba.com's per-player league dashboards start in 1996-97; older seasons use leagueleaders. */
export const DASH_FIRST_SEASON = 1996;
export const isOldSeason = (season: string) => seasonStartYear(season) < DASH_FIRST_SEASON;
export { seasonOf };

// ── background (Wikipedia) ───────────────────────────────────────────────────

const WIKI = "https://en.wikipedia.org/w/api.php";

/** A Wikipedia article's lead section for a basketball topic: history,
 *  accolades, playing style, rivalries, a season's story. */
export function fetchBackground(topic: string, cache: Cache) {
  const q = /\b(nba|basketball|aba)\b/i.test(topic) ? topic : `${topic} basketball`;
  return cache.getOrFetch<{ title: string; text: string; url: string } | null>(
    `wiki_v1_${q.toLowerCase()}`,
    async () => {
      const search = await getJson(WIKI, { params: { action: "query", list: "search", srsearch: q, srlimit: 1, format: "json", formatversion: 2 }, timeout: 12, retries: 1 });
      const title: string | undefined = search?.query?.search?.[0]?.title;
      if (!title) return null;
      const page = await getJson(WIKI, {
        params: { action: "query", prop: "extracts", exintro: 1, explaintext: 1, redirects: 1, titles: title, format: "json", formatversion: 2 },
        timeout: 12,
        retries: 1,
      });
      const text: string = page?.query?.pages?.[0]?.extract ?? "";
      if (!text.trim()) return null;
      return { title, text: text.length > 2500 ? text.slice(0, 2500).replace(/\s+\S*$/, "") + "…" : text, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}` };
    },
    { ttl: 7 * 86400, fallback: null },
  );
}
