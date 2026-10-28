/** Fact-check: after an answer is written, every player it names is checked
 *  against this season's data. A player who isn't in the data the answer was
 *  built from, or who a sentence ties to a team he doesn't play for, earns a
 *  correction sheet, and the model rewrites the answer once with it. Catches
 *  the stale-memory slips (a player on his old team, a game credited to the
 *  wrong man) without knowing anything about the question. */

import { currentSeason } from "../config";
import { getTeamName } from "../nba/teams";
import { findTeams, fold, lastName, type IndexedPlayer, type PlayerIndex } from "./grounding";

export interface Problem {
  player: IndexedPlayer;
  reason: string;
}

export interface CheckResult {
  named: IndexedPlayer[];
  problems: Problem[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordIn = (text: string, w: string) => new RegExp(`(^|[^a-z0-9])${escape(w)}($|[^a-z0-9])`).test(text);

/** Sentences of an answer (Markdown bullets and table rows count as sentences). */
const sentences = (text: string) => text.split(/(?<=[.!?])\s+|\n+|\|/).map((s) => s.trim()).filter(Boolean);

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

/** Problems with the players an answer names. `dataText` is everything the
 *  answer was built from: fact cards, tool results, earlier data. */
export function checkAnswer(answer: string, dataText: string, idx: PlayerIndex): CheckResult {
  const named = idx.find(answer, 12);
  const data = fold(dataText);
  const problems: Problem[] = [];
  for (const p of named) {
    const inData = data.includes(fold(p.name)) || (!!p.row && wordIn(data, lastName(p.name)) && lastName(p.name).length >= 5);
    if (!inData) {
      problems.push({ player: p, reason: "not in the data this answer was built from" });
      continue;
    }
    if (!p.team_abbr) continue;
    for (const s of sentences(answer)) {
      const f = fold(s);
      if (!f.includes(lastName(p.name))) continue;
      for (const t of findTeams(s)) {
        if (t.abbreviation === p.team_abbr) continue;
        if (affiliated(s, p, [t.nickname, t.full_name, t.abbreviation])) {
          problems.push({ player: p, reason: `tied to the ${t.full_name}` });
        }
      }
    }
  }
  // one problem per player is enough
  const seen = new Set<number>();
  return { named, problems: problems.filter((x) => !seen.has(x.player.pid) && seen.add(x.player.pid)) };
}

/** What the model gets to correct itself with. */
export function correctionSheet(problems: Problem[]): string {
  const season = currentSeason();
  const n1 = (v: unknown) => (typeof v === "number" ? v.toFixed(1) : "?");
  const lines = problems.map(({ player: p, reason }) => {
    const fact = p.row
      ? `plays for the ${getTeamName(p.row.team_id) || p.row.team_abbr} (${p.row.team_abbr}) in ${season}: ${p.row.gp} GP, ${n1(p.row.PTS)} pts, ${n1(p.row.REB)} reb, ${n1(p.row.AST)} ast`
      : `has no NBA games logged in ${season}; don't say which team he's on`;
    return `- ${p.name} — ${fact}. (Your answer: ${reason}.)`;
  });
  return (
    "FACT CHECK — your answer named players in ways the current data doesn't support:\n" +
    lines.join("\n") +
    "\nRewrite your full answer. Fix every team, role, game or stat claim about these players using only this sheet and the DATA above; " +
    "if the data doesn't show what a player did in a game, don't credit him with it. Keep everything that was right. " +
    "Output only the corrected answer, with no note about the correction."
  );
}
