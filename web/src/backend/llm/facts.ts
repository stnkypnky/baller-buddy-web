/** Fact tables: for questions that are about facts (a day's games, the
 *  standings, a player's numbers), the app builds the answer's facts straight
 *  from the data and shows them above the model's answer, where no model can
 *  change them. The model is asked for its take instead of re-typing numbers,
 *  so any model, small or large, starts from the same verified facts. */

import type { Cache } from "../cache";
import { currentSeason } from "../config";
import * as data from "../nba/data";
import { TEAMS } from "../nba/teamData";
import { type Team } from "../nba/teams";
import { findDates, findSeasons, findTeams, fold, type PlayerIndex } from "./grounding";
import { watchRank } from "./tools";

export interface FactTable {
  title: string;
  source: string;
  columns: string[];
  rows: string[][];
  /** A line under the table ("Best watch: DEN @ GS — overtime, decided by 4"). */
  note?: string;
}

// What a question has to be about for each table.
const GAMES = /\b(games?|scores?|results?|final|slate|played|play|won|wins?|lost|lose|beat|matchups?|watch|happen\w*|turn(?:ed)? out|how did|do last|did last)\b/;
const STANDINGS = /\b(standings?|seeds?|seeded|seeding|rank(?:ed|ing)?|place in|stand(?:s)? in|playoff (?:picture|race)|top of the (?:east|west)|in the (?:east|west))\b/;
const NUMBERS = /\b(stats?|numbers|averag\w*|ppg|how(?:'s| is)? .{0,30}(?:playing|doing)|stat line|line this season|shooting)\b/;

/** "Cavaliers", not "CLE": a tricode is a guess for a small model (and a squint on a phone). */
const nick = (s: data.EspnSide) => TEAMS.find((t) => t.espn_id === s.espn_id)?.nickname ?? s.abbr;
const pts = (l?: data.GameLeader) => (l ? `${l.player.split(" ").slice(1).join(" ") || l.player} ${l.value}` : "");

/** One day's games: every game, its result or tip time, its top scorers. */
async function dayTable(day: string, teams: Team[]): Promise<FactTable | null> {
  const sb = await data.fetchScoreboard(day);
  const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
  const title = `Games on ${new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}`;
  const espn = new Set(teams.map((t) => t.espn_id));
  const mine = espn.size ? sb.games.filter((g) => espn.has(g.home.espn_id) || espn.has(g.away.espn_id)) : sb.games;
  const missing = teams.filter((t) => !sb.games.some((g) => g.home.espn_id === t.espn_id || g.away.espn_id === t.espn_id));
  if (!sb.games.length) return { title, source: "ESPN", columns: [], rows: [], note: "No NBA games that day." };
  const rows = mine.map((g) => {
    const leaders = [g.away, g.home].map((s) => pts(s.leaders?.find((l) => l.category === "PTS"))).filter(Boolean).join(" · ");
    const result =
      g.state === "pre"
        ? `${g.status_text}${g.odds?.details ? ` · ${g.odds.details}` : ""}`
        : `${g.away.score}–${g.home.score} ${g.state === "post" ? (g.period > 4 ? `F/${g.period > 5 ? g.period - 4 : ""}OT` : "F") : g.status_text}`;
    return [`${nick(g.away)} @ ${nick(g.home)}`, result, leaders];
  });
  const notes: string[] = [];
  if (missing.length) notes.push(`${missing.map((t) => `The ${t.nickname}`).join(" and ")} didn't play that day.`);
  const best = watchRank(mine).filter((w) => w.why.length)[0];
  if (best && mine.filter((g) => g.state === "post").length > 1) notes.push(`Best watch: ${nick(best.game.away)} @ ${nick(best.game.home)} — ${best.why.join(", ")}`);
  if (!rows.length) return { title, source: "ESPN", columns: [], rows: [], note: notes.join(" ") };
  return { title, source: "ESPN", columns: ["Game", "Result", "Top scorers"], rows, note: notes.join(" ") || undefined };
}

/** A conference's standings (the named or followed team's, else both). */
async function standingsTable(teams: Team[], question: string, cache: Cache): Promise<FactTable[]> {
  const all = await data.fetchAllStandings(currentSeason(), cache);
  if (!all.length) return [];
  const f = fold(question);
  const confs = /\beast/.test(f) ? ["East"] : /\bwest/.test(f) ? ["West"] : teams.length ? [...new Set(teams.map((t) => (t.east ? "East" : "West")))] : ["East", "West"];
  const mark = new Set(teams.map((t) => t.id));
  return confs.map((c) => ({
    title: `${c}ern Conference · ${currentSeason()}`,
    source: "NBA.com",
    columns: ["#", "Team", "W-L", "GB", "L10", "Streak"],
    rows: all
      .filter((r) => r.conference === c)
      .sort((a, b) => a.rank - b.rank)
      .map((r) => [String(r.rank), `${mark.has(r.team_id) ? "▸ " : ""}${r.team_name}`, `${r.wins}-${r.losses}`, r.gb ? String(r.gb) : "—", r.last10 || "—", r.streak || "—"]),
  }));
}

const num = (v: unknown, d = 1) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—");
const pct = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—");

/** The verified tables for a question, or none when it isn't about facts. */
export async function factsFor(question: string, opts: { followed?: number | null; cache: Cache; index: PlayerIndex }): Promise<FactTable[]> {
  const f = fold(question);
  const teams = findTeams(question).slice(0, 2);
  const out: FactTable[] = [];
  // "last year", "2023-24": history has its own cards; these tables are this season
  if (findSeasons(question).length) return out;
  const dates = findDates(question);
  if (dates.length && GAMES.test(f)) {
    const t = await dayTable(dates[0], teams).catch(() => null);
    if (t) out.push(t);
  }
  if (STANDINGS.test(f)) {
    // "where do we stand?" is the followed team
    const followed = TEAMS.find((t) => t.id === opts.followed);
    out.push(...(await standingsTable(teams.length || !followed ? teams : [followed], question, opts.cache).catch(() => [])));
  }
  const players = opts.index.find(question, 3).filter((p) => p.row);
  if (players.length && NUMBERS.test(f) && !dates.length) {
    out.push({
      title: `This season · ${currentSeason()}`,
      source: "NBA.com",
      columns: ["Player", "Team", "GP", "PTS", "REB", "AST", "FG%", "3P%"],
      rows: players.map(({ name, row }) => [name, String(row!.team_abbr), String(row!.gp), num(row!.PTS), num(row!.REB), num(row!.AST), pct(row!.FG_PCT), pct(row!.FG3_PCT)]),
    });
  }
  return out;
}

/** The tables as text for the model (and the fact-check). */
export function factsText(tables: FactTable[]): string {
  return tables
    .map((t) => {
      const head = `${t.title} (${t.source}; complete)`;
      const rows = t.rows.map((r) => `- ${r.map((c, i) => (t.columns[i] && i ? `${t.columns[i]} ${c}` : c)).join(" · ")}`);
      return [head, ...rows, ...(t.note ? [t.note] : [])].join("\n");
    })
    .join("\n\n");
}
