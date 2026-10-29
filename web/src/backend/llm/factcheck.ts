/** Fact-check: after an answer is written, its checkable claims are held up
 *  against the data it was built from (fact cards, tool results, a one-shot's
 *  game or stats data):
 *    - every player it names: in the data, not tied to a team he wasn't on in
 *      the season the sentence is about, and not called the teammate of
 *      someone he never shared a team with;
 *    - every game (a row or sentence naming two teams with a score or a
 *      player's line): in the data, with that score, and each player in it on
 *      one of the two teams with the numbers that game's data shows;
 *    - every game score, record or run ("112-110", "11-3", "a 12-0 run");
 *    - every player stat ("31 points", "8 rebounds"), against that player's
 *      own numbers;
 *    - every decimal or percentage (averages, ratings, shooting).
 *  Anything unsupported goes on a correction sheet and the model rewrites the
 *  answer once. Nothing here knows the question: it catches stale-memory
 *  slips and invented numbers wherever they turn up. */

import { currentSeason } from "../config";
import { TEAMS, type Team } from "../nba/teamData";
import { getTeamName } from "../nba/teams";
import { findSeasons, findTeams, fold, lastName, type IndexedPlayer, type PlayerIndex } from "./grounding";

export interface Problem {
  player: IndexedPlayer;
  reason: string;
  /** His teams by season, for the correction sheet ("2024-25 SAC · 2025-26 BOS"). */
  teams?: string;
}

/** {season: team tricodes} for one player (history.fetchStints). */
export type Stints = Record<string, string[]>;

/** A number in the answer the data doesn't back. */
export interface Claim {
  kind: "game" | "score" | "pair" | "stat" | "number";
  /** The words as written ("beat Brooklyn 118-110", "31 points"). */
  text: string;
  /** What the data does say, for the correction sheet ("" when nothing relevant). */
  hint: string;
}

export interface CheckResult {
  named: IndexedPlayer[];
  problems: Problem[];
  claims: Claim[];
  /** How many numbers were checked, for the badge. */
  numbers: number;
}

export interface CheckOptions {
  /** Skip "tied to the wrong team": a news brief can be newer than the stats. */
  teams?: boolean;
  /** Past seasons the question was about ("last year"): a sentence that names
   *  no season is taken to mean one of them, or this season. */
  seasons?: string[];
  /** Each named player's teams by season, so past ties can be checked
   *  (without them only this season's team is known). */
  stints?: Map<number, Stints>;
}

const MAX_CLAIMS = 8;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordIn = (text: string, w: string) => new RegExp(`(^|[^a-z0-9])${escape(w)}($|[^a-z0-9])`).test(text);

/** Sentences of an answer (Markdown bullets and table rows count as sentences). */
const sentences = (text: string) =>
  text
    .split(/(?<=[.!?])\s+(?=[A-Z*_\d])|\n+|\|/)
    .map((s) => s.trim())
    .filter(Boolean);

// ── players ──────────────────────────────────────────────────────────────────

/** Words that tie a player to a team, around the team's name. */
function affiliated(sentence: string, player: IndexedPlayer, teamWords: string[]): boolean {
  const f = fold(sentence);
  const p = [fold(player.name), lastName(player.name)].map(escape).join("|");
  return teamWords.some((tw) => {
    const t = escape(fold(tw));
    return [
      // "the Celtics' Smart", "Celtics guard Smart", "Celtics star Smart"
      new RegExp(`${t}s?'?s? (?:\\w+ ){0,2}(?:${p})`),
      new RegExp(`${t} (?:guard|forward|center|star|rookie|big|wing|point guard|veteran|sixth man|starter) (?:${p})`),
      // "Smart, the Celtics' (backup) point guard", "Smart of the Celtics", "Harden ... for the Nets"
      new RegExp(`(?:${p})(?:,| is| was| has been| remains)? (?:\\w+ ){0,3}(?:the )?${t}'?s? (?:\\w+ )?(?:guard|forward|center|star|starter|point guard|leader|top|big|wing|sixth man)`),
      new RegExp(`(?:${p})[^.]{0,60}\\b(?:for|with|on|of|joined|joins|signed with|traded to|plays for|playing for) the ${t}\\b`),
      // "Smart (BOS)"
      new RegExp(`(?:${p}) \\(${t}\\)`),
    ].some((re) => re.test(f));
  });
}

// Old tricodes in nba.com's career tables -> the franchise's tricode today.
const FRANCHISE: Record<string, string> = {
  NJN: "BKN", NYN: "BKN", SEA: "OKC", VAN: "MEM", NOH: "NOP", NOK: "NOP", CHH: "CHA", WSB: "WAS", BAL: "WAS", CAP: "WAS",
  SDC: "LAC", BUF: "LAC", KCK: "SAC", KCO: "SAC", CIN: "SAC", ROC: "SAC", NOJ: "UTA", SDR: "HOU", PHW: "GSW", SFW: "GSW",
  SYR: "PHI", MNL: "LAL", FTW: "DET", MLH: "ATL", STL: "ATL", TRI: "ATL", GOS: "GSW", UTH: "UTA", PHL: "PHI", SAN: "SAS",
};
const franchise = (abbr: string) => FRANCHISE[abbr] ?? abbr;

/** Seasons a sentence is about: the ones it names; else the question's plus
 *  this one; else, told in the past tense ("was", "played"), any season of a
 *  career; else this season. */
type When = string[] | "any";
const NOW = /\b(this (?:season|year)|currently|right now|these days|now)\b/i;
const PAST = /\b(was|were|played|spent|came up|began|drafted|former|formerly|used to|previously|back in|then-|earlier in (?:his|their) career)\b/i;

function whenOf(sentence: string, opts: CheckOptions): When {
  const season = currentSeason();
  const past = findSeasons(sentence);
  const now = NOW.test(sentence) || sentence.includes(season);
  if (past.length) return now ? [...past, season] : past;
  if (now) return [season];
  if (opts.seasons?.length) return [...opts.seasons, season];
  return PAST.test(sentence) ? "any" : [season];
}

/** The teams a player was on in those seasons; `known` is false when there's
 *  nothing to go on (no stints for a past season, no games this season). */
function teamsOf(p: IndexedPlayer, when: When, opts: CheckOptions): { known: boolean; teams: Set<string> } {
  const season = currentSeason();
  const st: Stints = { ...(opts.stints?.get(p.pid) ?? {}) };
  if (p.team_abbr) st[season] = [...new Set([...(st[season] ?? []), p.team_abbr])];
  const hasPast = !!opts.stints?.get(p.pid) && Object.keys(opts.stints.get(p.pid)!).length > 0;
  const seasons = when === "any" ? Object.keys(st) : when;
  const known = when === "any" ? seasons.length > 0 : when.some((s) => (s === season ? !!p.team_abbr : hasPast));
  return { known, teams: new Set(seasons.flatMap((s) => st[s] ?? []).map(franchise)) };
}

/** "2024-25 SAC · 2025-26 SAC · 2026-27 BOS": his last few seasons, for the sheet. */
function teamsBySeason(p: IndexedPlayer, opts: CheckOptions): string {
  const st: Stints = { ...(opts.stints?.get(p.pid) ?? {}) };
  if (p.team_abbr) st[currentSeason()] = [...new Set([...(st[currentSeason()] ?? []), p.team_abbr])];
  return Object.keys(st).sort().slice(-5).map((s) => `${s} ${st[s].join("/")}`).join(" · ");
}

const whenText = (w: When) => (w === "any" ? "at any point in his career" : `in ${w.join(" or ")}`);

// "alongside Duren", "teamed with", "his backcourt partner": the players after it are called teammates
const TEAMMATE =
  /\b(alongside|teammates?|teamed (?:up )?with|played with|playing with|plays with|paired with|pairing with|next to|joined by|(?:backcourt|frontcourt) (?:mate|partner)s?|running mates?|sharing the (?:floor|court|ball|backcourt|frontcourt) with|with the likes of|surrounded by)\b/i;
// Words that put a team on the other side of the sentence.
const OPPOSED = /\b(against|vs\.?|versus|beat|beating|faced|facing|traded|trade|over)\b/i;

/** Where in a sentence a player is named (his last name), or -1. */
const at = (sentence: string, p: IndexedPlayer) => fold(sentence).indexOf(lastName(p.name));

function checkTies(answer: string, named: IndexedPlayer[], opts: CheckOptions): Problem[] {
  const problems: Problem[] = [];
  const flag = (p: IndexedPlayer, reason: string) => problems.push({ player: p, reason, teams: teamsBySeason(p, opts) || undefined });
  for (const s of sentences(answer)) {
    const here = named.filter((p) => at(s, p) >= 0);
    if (!here.length) continue;
    const when = whenOf(s, opts);
    const teams = findTeams(s);
    // "the Celtics' Smart", "Harden ... for the Nets"
    for (const p of here) {
      const { known, teams: his } = teamsOf(p, when, opts);
      if (!known) continue;
      for (const t of teams) {
        if (his.has(t.abbreviation)) continue;
        if (affiliated(s, p, [t.nickname, t.full_name, t.abbreviation])) flag(p, `tied to the ${t.full_name} ${whenText(when)}`);
      }
    }
    // "Carter played alongside Jalen Duren (on the Kings)"
    const m = TEAMMATE.exec(fold(s));
    if (!m) continue;
    const subject = here.filter((p) => at(s, p) < m.index).sort((a, b) => at(s, a) - at(s, b))[0];
    const mates = here.filter((p) => at(s, p) > m.index);
    const team = teams.length === 1 && !OPPOSED.test(s) ? teams[0] : undefined;
    if (team) {
      for (const p of [...(subject ? [subject] : []), ...mates]) {
        const { known, teams: his } = teamsOf(p, when, opts);
        if (known && !his.has(team.abbreviation)) flag(p, `called a ${team.nickname} teammate, but he wasn't on the ${team.full_name} ${whenText(when)}`);
      }
    } else if (subject) {
      const seasons = when === "any" ? Object.keys({ ...opts.stints?.get(subject.pid), [currentSeason()]: [] }) : when;
      for (const p of mates) {
        const both = seasons.map((x) => [teamsOf(subject, [x], opts), teamsOf(p, [x], opts)] as const);
        if (!both.some(([a, b]) => a.known && b.known)) continue;
        if (both.some(([a, b]) => [...a.teams].some((t) => b.teams.has(t)))) continue;
        flag(p, `called ${subject.name}'s teammate, but they weren't on the same team ${whenText(when)}`);
      }
    }
  }
  return problems;
}

function checkPlayers(answer: string, data: string, named: IndexedPlayer[], opts: CheckOptions): Problem[] {
  const problems: Problem[] = [];
  const present: IndexedPlayer[] = [];
  for (const p of named) {
    const inData = data.includes(fold(p.name)) || (!!p.row && wordIn(data, lastName(p.name)) && lastName(p.name).length >= 5);
    if (inData) present.push(p);
    // a legend mentioned in passing isn't a claim; his numbers are still checked
    else if (!p.retired) problems.push({ player: p, reason: "not in the data this answer was built from" });
  }
  if (opts.teams !== false) problems.push(...checkTies(answer, present, opts));
  const seen = new Set<number>();
  return problems.filter((x) => !seen.has(x.player.pid) && seen.add(x.player.pid));
}

/** Players whose team ties need their past seasons checked: named in a
 *  sentence that also names a team or calls someone a teammate. */
export function tiedPlayers(answer: string, named: IndexedPlayer[]): IndexedPlayer[] {
  const ss = sentences(answer).filter((s) => findTeams(s).length || TEAMMATE.test(fold(s)));
  return named.filter((p) => ss.some((s) => at(s, p) >= 0));
}

// ── numbers ──────────────────────────────────────────────────────────────────

const NUM = /-?\d+(?:\.\d+)?/g;

/** Every number in a text, plus its percentage form for fractions (0.471 -> 47.1). */
function numbersIn(text: string): number[] {
  const out: number[] = [];
  // seasons and years ("2026-27") aren't stats
  for (const m of text.replace(/\b(19|20)\d\d(?:-\d\d)?\b/g, " ").matchAll(NUM)) {
    const n = parseFloat(m[0]);
    if (!Number.isFinite(n)) continue;
    out.push(Math.abs(n));
    if (m[0].includes(".") && Math.abs(n) <= 1) out.push(Math.abs(n) * 100);
  }
  return out;
}

/** A claimed number matches data when equal at the claim's own precision
 *  ("27" matches 27.1 or 26.8; "47.1" matches 0.471). */
function matches(claim: string, known: number[]): boolean {
  const x = Math.abs(parseFloat(claim));
  const decimals = claim.includes(".") ? claim.split(".")[1].length : 0;
  const f = 10 ** decimals;
  return known.some((d) => Math.abs(d - x) < 1e-9 || Math.round(d * f) / f === x || (decimals === 0 && Math.abs(d - x) < 0.5));
}

/** Pairs written "a-b" / "a–b" / "a to b" / "AAA a @ BBB b" in the data, as "hi-lo". */
function pairsIn(text: string): Set<string> {
  const out = new Set<string>();
  const add = (a: string, b: string) => out.add([+a, +b].sort((x, y) => y - x).join("-"));
  for (const m of text.matchAll(/(?<![\d.])(\d{1,3})\s*(?:-|–|—|to)\s*(\d{1,3})(?!\d|\.\d)/g)) add(m[1], m[2]);
  for (const m of text.matchAll(/\b[A-Z]{2,4} (\d{2,3})\s*(?:@|vs\.?|at|–|-)\s*[A-Z]{2,4} (\d{2,3})\b/g)) add(m[1], m[2]);
  // game logs as JSON: {"pts":112, ..., "opp_pts":110}
  for (const m of text.matchAll(/"pts":(\d{2,3})[^{}]*?"opp_pts":(\d{2,3})/g)) add(m[1], m[2]);
  for (const m of text.matchAll(/\b(?:wins|w)"?:\s*(\d{1,2})[^{}\n]{0,40}?\b(?:losses|l)"?:\s*(\d{1,2})/gi)) add(m[1], m[2]);
  // two score-sized numbers in one line or record ({"home":{"score":112},"away":{"score":110}})
  for (const chunk of text.split(/\n|\},\s*\{/)) {
    if (chunk.length > 800) continue;
    const scores = [...chunk.matchAll(/(?<![\d.])(\d{2,3})(?![\d.])/g)].map((m) => m[1]).filter((n) => +n >= 70 && +n <= 200);
    if (scores.length > 6) continue;
    for (let i = 0; i < scores.length; i++) for (let j = i + 1; j < scores.length; j++) add(scores[i], scores[j]);
  }
  return out;
}

/** The data's text around each mention of a player: his card line, roster
 *  entry, leader line, the JSON object he's in. */
function playerWindows(data: string, p: IndexedPlayer): string[] {
  const lower = data.toLowerCase();
  const keys = [p.name.toLowerCase(), ...(lastName(p.name).length >= 5 ? [p.name.split(" ").filter((w) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(w)).at(-1)!.toLowerCase()] : [])];
  const out: string[] = [];
  for (const k of keys) {
    for (let i = lower.indexOf(k); i >= 0 && out.length < 12; i = lower.indexOf(k, i + k.length)) {
      // stats follow the name in cards and lists; inside a JSON record, take the whole record
      const open = data.lastIndexOf("{", i);
      const inRecord = open > data.lastIndexOf("}", i) && open > data.lastIndexOf("\n", i) && i - open < 300;
      const start = inRecord ? open : i;
      // a player's card or career block runs on for several lines: take the block
      const lineStart = data.lastIndexOf("\n", i) + 1;
      if (/^(CAREER|PLAYER|COMPARE) /.test(data.slice(lineStart, lineStart + 8))) {
        const next = data.slice(i).search(/\n\n|\n(?:PLAYER|TEAM|CAREER|GAMES ON|\[)/);
        out.push(data.slice(lineStart, next < 0 ? data.length : i + next));
        continue;
      }
      const nl = data.indexOf("\n", i);
      const close = data.indexOf("}", i);
      const end = Math.min(nl < 0 ? data.length : nl, close < 0 ? data.length : close + 1, i + 400);
      out.push(data.slice(start, end));
    }
  }
  return out;
}

const SPECULATIVE =
  /\b(would|wouldn'?t|could|might|projects?|projected|projection|predict(?:ed|ion)?|expect(?:ed)?|likely|imagine|hypothetical(?:ly)?|in a series|my pick|i'?d (?:take|pick|say)|i think|estimate[ds]?|if (?:he|they|we|you)|in theory)\b/i;

const STAT_UNITS =
  "points?|pts|ppg|rebounds?|rebs?|rpg|boards|assists?|asts?|apg|dimes|steals?|stl|spg|blocks?|blk|bpg|threes|3s|3-pointers|triples|minutes|mins?|mpg|turnovers?|tov";
const STAT = new RegExp(`(?<![\\d.\\-–])(\\d{1,3}(?:\\.\\d)?)\\s*(?:${STAT_UNITS})\\b`, "gi");

/** A sentence with seasons, dates and times blanked out ("2026-27", "10/26", "7:30" aren't claims). */
const plainOf = (s: string) => s.replace(/\b(19|20)\d\d(?:-\d\d)?\b/g, " ").replace(/\b\d{1,2}[/:]\d{1,2}\b/g, " ");

/** Each stat in a sentence and whose it is: the player named nearest before
 *  it, else the only one in the sentence. */
function statsIn(s: string, plain: string, named: IndexedPlayer[]): [RegExpMatchArray, IndexedPlayer | undefined][] {
  const who = named.filter((p) => fold(s).includes(lastName(p.name)));
  return [...plain.matchAll(STAT)].map((m) => {
    const at = m.index!;
    const before = who
      .map((p) => [p, s.toLowerCase().lastIndexOf(lastName(p.name).split(" ")[0], at)] as const)
      .filter(([, i]) => i >= 0 && i < at)
      .sort((x, y) => y[1] - x[1]);
    return [m, before[0]?.[0] ?? (who.length === 1 ? who[0] : undefined)];
  });
}

// ── games ────────────────────────────────────────────────────────────────────

/** Words that make a stretch of the data about a game between the teams it names. */
const GAME_WORDS = /@|\bvs\.?(?=\s)|\bFINAL\b|"(?:home|away|matchup|result)"/i;
/** Scores in a sentence: two numbers in a basketball score's range. */
const SCORE = /(?<![\d.])(\d{2,3})\s*(?:-|–|—|to)\s*(\d{2,3})(?!\d|\.\d|%)/g;
const AVERAGE = /\b(averag\w*|per game|a night|this season|on the season|ppg|rpg|apg|mpg)\b/i;
const isScore = (a: number, b: number) => a >= 70 && b >= 70 && a <= 200 && b <= 200;

/** The teams a stretch of text names, ESPN's tricodes ("GS", "NY", "WSH") included. */
function teamsIn(text: string): Team[] {
  const out = findTeams(text);
  for (const t of TEAMS) {
    const espn = t.espn_abbr.toUpperCase();
    if (!out.includes(t) && espn !== t.abbreviation && new RegExp(`\\b${espn}\\b`).test(text)) out.push(t);
  }
  return out;
}

/** The answer's rows: table rows and bullets whole, prose by sentence. */
const rows = (text: string) => text.split(/\n+/).flatMap((l) => (l.includes("|") ? [l.trim()] : sentences(l)));

/** Every game the data shows ("BOS 125 @ ATL 124", a scoreboard entry, a box score), with its teams. */
function gamesIn(data: string): { text: string; teams: Team[] }[] {
  return data
    .split(/\n|\},\s*\{/)
    .filter((c) => GAME_WORDS.test(c))
    .map((text) => ({ text, teams: teamsIn(text) }))
    .filter((g) => g.teams.length >= 2);
}

/** "BOS 125 @ ATL 124; NYK 101 @ CHI 99": the finished games the data has, for the sheet. */
function slate(data: string): string {
  const out = new Set<string>();
  for (const m of data.matchAll(/FINAL: ([A-Z]{2,4} \d+ @ [A-Z]{2,4} \d+)|"result":"([^"]+)"/g)) out.add(m[1] ?? m[2]);
  return out.size ? `the games in the data are ${[...out].slice(0, 15).join("; ")}` : "";
}

/** Games the answer describes (two teams, plus a score or a player's line):
 *  the game has to be in the data, with that score, and each player in it on
 *  one of the two teams with numbers that game's data shows. */
function checkGames(answer: string, dataText: string, named: IndexedPlayer[], opts: CheckOptions): { problems: Problem[]; claims: Claim[] } {
  const problems: Problem[] = [];
  const claims: Claim[] = [];
  const known = gamesIn(dataText);
  for (const row of rows(answer)) {
    if (SPECULATIVE.test(row)) continue;
    const ts = findTeams(row);
    if (ts.length !== 2) continue;
    const plain = plainOf(row);
    const scores = [...plain.matchAll(SCORE)].filter((m) => isScore(+m[1], +m[2]));
    // "George is averaging 18 points" next to a result is his season, not that game
    const stats = AVERAGE.test(row) ? [] : statsIn(row, plain, named);
    if (!scores.length && !stats.some(([, p]) => p)) continue; // a matchup mentioned, not a result
    const games = known.filter((g) => ts.every((t) => g.teams.includes(t))).map((g) => g.text);
    if (!games.length) {
      claims.push({ kind: "game", text: `${ts[0].nickname}–${ts[1].nickname} game`, hint: slate(dataText) || "no game between these teams" });
      continue;
    }
    const these = games.join("\n");
    const hint = games[0].slice(0, 400);
    const pairs = pairsIn(these);
    for (const m of scores) if (!pairs.has([+m[1], +m[2]].sort((x, y) => y - x).join("-"))) claims.push({ kind: "score", text: m[0], hint });
    for (const [m, p] of stats) {
      if (!p) continue;
      const { known: k, teams: his } = teamsOf(p, whenOf(row, opts), opts);
      if (k && !ts.some((t) => his.has(t.abbreviation))) {
        problems.push({ player: p, reason: `named in the ${ts[0].nickname}–${ts[1].nickname} game, but he plays for neither team`, teams: teamsBySeason(p, opts) || undefined });
        continue;
      }
      const windows = playerWindows(these, p);
      if (!windows.length || !matches(m[1], numbersIn(windows.join(" ")))) claims.push({ kind: "stat", text: `${p.name}: ${m[0]}`, hint });
    }
  }
  return { problems, claims };
}

function checkNumbers(answer: string, dataText: string, named: IndexedPlayer[], idx: PlayerIndex): { claims: Claim[]; numbers: number } {
  const known = numbersIn(dataText);
  const pairs = pairsIn(dataText);
  const claims: Claim[] = [];
  let numbers = 0;
  const dataLines = dataText.split("\n");

  for (const s of sentences(answer)) {
    // a hypothetical or a prediction isn't a claim of fact
    if (SPECULATIVE.test(s)) continue;
    const plain = plainOf(s);

    // scores, records and runs: "118-110", "11-3", "a 12-0 run"
    for (const m of plain.matchAll(/(?<![\d.])(\d{1,3})\s*(?:-|–|—)\s*(\d{1,3})(?!\d|\.\d|%)/g)) {
      const a = +m[1];
      const b = +m[2];
      const score = a >= 70 && b >= 70 && a <= 200 && b <= 200;
      if (!score && a + b > 82) continue; // neither a score nor a record/run
      numbers++;
      if (pairs.has([a, b].sort((x, y) => y - x).join("-"))) continue;
      const teams = findTeams(s);
      const hint = teams.length
        ? dataLines.filter((l) => teams.some((t) => l.includes(t.abbreviation) || l.includes(t.nickname))).slice(0, 3).join(" | ").slice(0, 400)
        : "";
      claims.push({ kind: score ? "score" : "pair", text: m[0], hint });
    }

    // player stats: "31 points", "8.4 rebounds", checked against that player's own numbers
    for (const [m, p] of statsIn(s, plain, named)) {
      numbers++;
      if (p) {
        const windows = playerWindows(dataText, p);
        if (!windows.length) continue; // reported as a player problem already
        if (matches(m[1], numbersIn(windows.join(" ")))) continue;
        claims.push({ kind: "stat", text: `${p.name}: ${m[0]}`, hint: windows.slice(0, 3).join(" | ").slice(0, 400) });
      } else if (!matches(m[1], known)) {
        claims.push({ kind: "stat", text: m[0], hint: "" });
      }
    }

    // other decimals and percentages: ratings, averages, shooting
    for (const m of plain.matchAll(/(?<![\d.\w])([+-]?\d{1,3}\.\d+|\d{1,3}(?:\.\d+)?%)/g)) {
      const raw = m[1].replace(/[%+]/g, "");
      const after = plain.slice(m.index! + m[0].length, m.index! + m[0].length + 14);
      if (new RegExp(`^\\s*(?:${STAT_UNITS})\\b`, "i").test(after)) continue; // a stat, checked above
      numbers++;
      if (matches(raw, known)) continue;
      claims.push({ kind: "number", text: m[0], hint: "" });
    }
  }
  void idx;
  const seen = new Set<string>();
  return { claims: claims.filter((c) => !seen.has(c.text) && seen.add(c.text)).slice(0, MAX_CLAIMS), numbers };
}

// ── the check ────────────────────────────────────────────────────────────────

/** Problems with an answer. `dataText` is everything it was built from. */
export function checkAnswer(answer: string, dataText: string, idx: PlayerIndex, opts: CheckOptions = {}): CheckResult {
  const named = idx.find(answer, 12);
  const problems = checkPlayers(answer, fold(dataText), named, opts);
  const flagged = new Set(problems.map((p) => p.player.pid));
  const ok = named.filter((p) => !flagged.has(p.pid));
  // game claims first: their hints are that game's data, not the player's season
  const games = checkGames(answer, dataText, ok, opts);
  for (const p of games.problems) if (!flagged.has(p.player.pid)) flagged.add(p.player.pid) && problems.push(p);
  const nums = checkNumbers(answer, dataText, ok.filter((p) => !flagged.has(p.pid)), idx);
  const seen = new Set<string>();
  const claims = [...games.claims, ...nums.claims].filter((c) => !seen.has(c.text) && seen.add(c.text)).slice(0, MAX_CLAIMS);
  return { named, problems, claims, numbers: nums.numbers };
}

/** How many things the fix covers (players plus numbers). */
export const issueCount = (r: CheckResult) => r.problems.length + r.claims.length;

/** What the model gets to correct itself with. */
export function correctionSheet(problems: Problem[], claims: Claim[] = []): string {
  const season = currentSeason();
  const n1 = (v: unknown) => (typeof v === "number" ? v.toFixed(1) : "?");
  const lines = problems.map(({ player: p, reason, teams }) => {
    const fact = p.row
      ? `plays for the ${getTeamName(p.row.team_id) || p.row.team_abbr} (${p.row.team_abbr}) in ${season}: ${p.row.gp} GP, ${n1(p.row.PTS)} pts, ${n1(p.row.REB)} reb, ${n1(p.row.AST)} ast`
      : `has no NBA games logged in ${season}${teams ? "" : "; don't say which team he's on"}`;
    return `- ${p.name} — ${fact}.${teams ? ` His teams by season: ${teams}.` : ""} (Your answer: ${reason}.)`;
  });
  const label = { game: "game", score: "score", pair: "record/run", stat: "stat", number: "number" } as const;
  for (const c of claims) {
    if (c.kind === "game") lines.push(`- The ${c.text} isn't in the data: nothing shows these teams played that game. Remove it. (${c.hint})`);
    else lines.push(`- "${c.text}" (${label[c.kind]}) isn't in the data.${c.hint ? ` The data says: ${c.hint}` : ""}`);
  }
  return (
    "FACT CHECK — parts of your answer aren't supported by the current data:\n" +
    lines.join("\n") +
    "\nRewrite your full answer. Fix every team, teammate, role, game, score or stat claim listed using only this sheet and the DATA above " +
    "(two players were teammates only if they were on the same team in the same season); " +
    "if the data doesn't show a number or what a player did, leave it out rather than guess. Never add a game that isn't in the data. Keep everything that was right. " +
    "Output only the corrected answer, with no note about the correction."
  );
}
