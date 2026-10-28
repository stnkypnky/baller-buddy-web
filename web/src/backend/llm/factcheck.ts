/** Fact-check: after an answer is written, its checkable claims are held up
 *  against the data it was built from (fact cards, tool results, a one-shot's
 *  game or stats data):
 *    - every player it names: in the data, and not tied to a team he doesn't
 *      play for;
 *    - every game score, record or run ("112-110", "11-3", "a 12-0 run");
 *    - every player stat ("31 points", "8 rebounds"), against that player's
 *      own numbers;
 *    - every decimal or percentage (averages, ratings, shooting).
 *  Anything unsupported goes on a correction sheet and the model rewrites the
 *  answer once. Nothing here knows the question: it catches stale-memory
 *  slips and invented numbers wherever they turn up. */

import { currentSeason } from "../config";
import { getTeamName } from "../nba/teams";
import { findTeams, fold, lastName, type IndexedPlayer, type PlayerIndex } from "./grounding";

export interface Problem {
  player: IndexedPlayer;
  reason: string;
}

/** A number in the answer the data doesn't back. */
export interface Claim {
  kind: "score" | "pair" | "stat" | "number";
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
      // "Smart, the Celtics' point guard", "Smart of the Celtics", "Harden ... for the Nets"
      new RegExp(`(?:${p})(?:,| is| was| has been| remains)? (?:\\w+ ){0,3}(?:the )?${t}'?s? (?:guard|forward|center|star|starter|point guard|leader|top)`),
      new RegExp(`(?:${p})[^.]{0,60}\\b(?:for|with|on|of|joined|joins|signed with|traded to|plays for|playing for) the ${t}\\b`),
      // "Smart (BOS)"
      new RegExp(`(?:${p}) \\(${t}\\)`),
    ].some((re) => re.test(f));
  });
}

function checkPlayers(answer: string, data: string, named: IndexedPlayer[], opts: CheckOptions): Problem[] {
  const problems: Problem[] = [];
  for (const p of named) {
    const inData = data.includes(fold(p.name)) || (!!p.row && wordIn(data, lastName(p.name)) && lastName(p.name).length >= 5);
    if (!inData) {
      problems.push({ player: p, reason: "not in the data this answer was built from" });
      continue;
    }
    if (!p.team_abbr || opts.teams === false) continue;
    for (const s of sentences(answer)) {
      if (!fold(s).includes(lastName(p.name))) continue;
      for (const t of findTeams(s)) {
        if (t.abbreviation === p.team_abbr) continue;
        if (affiliated(s, p, [t.nickname, t.full_name, t.abbreviation])) problems.push({ player: p, reason: `tied to the ${t.full_name}` });
      }
    }
  }
  const seen = new Set<number>();
  return problems.filter((x) => !seen.has(x.player.pid) && seen.add(x.player.pid));
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
      const nl = data.indexOf("\n", i);
      const close = data.indexOf("}", i);
      const end = Math.min(nl < 0 ? data.length : nl, close < 0 ? data.length : close + 1, i + 400);
      out.push(data.slice(start, end));
    }
  }
  return out;
}

const STAT_UNITS =
  "points?|pts|ppg|rebounds?|rebs?|rpg|boards|assists?|asts?|apg|dimes|steals?|stl|spg|blocks?|blk|bpg|threes|3s|3-pointers|triples|minutes|mins?|mpg|turnovers?|tov";
const STAT = new RegExp(`(?<![\\d.\\-–])(\\d{1,3}(?:\\.\\d)?)\\s*(?:${STAT_UNITS})\\b`, "gi");

function checkNumbers(answer: string, dataText: string, named: IndexedPlayer[], idx: PlayerIndex): { claims: Claim[]; numbers: number } {
  const known = numbersIn(dataText);
  const pairs = pairsIn(dataText);
  const claims: Claim[] = [];
  let numbers = 0;
  const dataLines = dataText.split("\n");

  for (const s of sentences(answer)) {
    // a season ("2026-27"), a date ("10/26"), a time ("7:30") isn't a claim
    const plain = s.replace(/\b(19|20)\d\d(?:-\d\d)?\b/g, " ").replace(/\b\d{1,2}[/:]\d{1,2}\b/g, " ");

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
    const who = named.filter((p) => fold(s).includes(lastName(p.name)));
    for (const m of plain.matchAll(STAT)) {
      numbers++;
      // the player named nearest before the stat, else the only one in the sentence
      const at = m.index!;
      const before = who
        .map((p) => [p, s.toLowerCase().lastIndexOf(lastName(p.name).split(" ")[0], at)] as const)
        .filter(([, i]) => i >= 0 && i < at)
        .sort((x, y) => y[1] - x[1]);
      const p = before[0]?.[0] ?? (who.length === 1 ? who[0] : undefined);
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
  const { claims, numbers } = checkNumbers(answer, dataText, named.filter((p) => !flagged.has(p.pid)), idx);
  return { named, problems, claims, numbers };
}

/** How many things the fix covers (players plus numbers). */
export const issueCount = (r: CheckResult) => r.problems.length + r.claims.length;

/** What the model gets to correct itself with. */
export function correctionSheet(problems: Problem[], claims: Claim[] = []): string {
  const season = currentSeason();
  const n1 = (v: unknown) => (typeof v === "number" ? v.toFixed(1) : "?");
  const lines = problems.map(({ player: p, reason }) => {
    const fact = p.row
      ? `plays for the ${getTeamName(p.row.team_id) || p.row.team_abbr} (${p.row.team_abbr}) in ${season}: ${p.row.gp} GP, ${n1(p.row.PTS)} pts, ${n1(p.row.REB)} reb, ${n1(p.row.AST)} ast`
      : `has no NBA games logged in ${season}; don't say which team he's on`;
    return `- ${p.name} — ${fact}. (Your answer: ${reason}.)`;
  });
  const label = { score: "score", pair: "record/run", stat: "stat", number: "number" } as const;
  for (const c of claims) {
    lines.push(`- "${c.text}" (${label[c.kind]}) isn't in the data.${c.hint ? ` The data says: ${c.hint}` : ""}`);
  }
  return (
    "FACT CHECK — parts of your answer aren't supported by the current data:\n" +
    lines.join("\n") +
    "\nRewrite your full answer. Fix every team, role, game, score or stat claim listed using only this sheet and the DATA above; " +
    "if the data doesn't show a number or what a player did, leave it out rather than guess. Keep everything that was right. " +
    "Output only the corrected answer, with no note about the correction."
  );
}
