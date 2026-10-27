/** Game Pulse (port of backend/pulse.py): win-probability timeline,
 *  scoring-run detection, momentum swings and leaders for one ESPN event, plus
 *  a text brief for the AI 'Catch Me Up' recap. */

import type { Cache } from "./cache";
import { fetchEspnSummary, parseBoxscore } from "./nba/data";
import { int, num, round } from "./nba/stats";
import { ESPN_ID_TO_NAME } from "./nba/teams";

const RUN_MIN = 8; // unanswered points that count as a run
const QUARTER = 12 * 60;
const OT = 5 * 60;

function clockSecs(s: string): number {
  if (typeof s !== "string") return 0;
  if (s.includes(":")) {
    const [m, sec] = s.split(":");
    const v = parseInt(m, 10) * 60 + parseFloat(sec);
    return Number.isFinite(v) ? v : 0;
  }
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : 0;
}

/** Game seconds elapsed at (period, clock remaining). */
export function elapsed(period: number, clock: string): number {
  const p = Math.max(1, Math.trunc(period || 1));
  const [base, length] = p <= 4 ? [(p - 1) * QUARTER, QUARTER] : [4 * QUARTER + (p - 5) * OT, OT];
  return round(base + Math.max(0, length - clockSecs(clock)), 1);
}

export const periodLabel = (p: number) => (p <= 4 ? `Q${p}` : p === 5 ? "OT" : `${p - 4}OT`);

function teamsOf(j: any) {
  const comp = j.header.competitions[0];
  const out: Record<string, any> = {};
  for (const c of comp.competitors) {
    const t = c.team;
    const tid = int(t.id);
    const rec = c.record?.length ? c.record : [{}];
    out[c.homeAway] = {
      espn_id: tid,
      app_name: ESPN_ID_TO_NAME[tid] ?? t.displayName ?? "",
      abbr: t.abbreviation ?? "",
      short: t.shortDisplayName || t.name || "",
      score: int(c.score),
      color: `#${t.color ?? "888888"}`,
      alt_color: `#${t.alternateColor ?? "cccccc"}`,
      record: (rec[0] ?? {}).summary ?? "",
      linescores: (c.linescores ?? []).map((l: any) => Math.trunc(num(l.displayValue))),
    };
  }
  return [out, comp] as const;
}

interface Play {
  id: string;
  t: number;
  period: number;
  clock: string;
  home: number;
  away: number;
  text: string;
  scoring: boolean;
  value: number;
  team_id: number;
}

/** Unanswered scoring streaks of RUN_MIN+ points. */
export function detectRuns(scoringPlays: Play[], homeId: number) {
  const runs: any[] = [];
  let cur: any = null;
  for (const p of scoringPlays) {
    const side = p.team_id === homeId ? "home" : "away";
    if (cur && cur.team === side) {
      cur.points += p.value;
      cur.end_t = p.t;
      cur.end_clock = p.clock;
      cur.end_period = p.period;
      cur.to = [p.away, p.home];
    } else {
      if (cur && cur.points >= RUN_MIN) runs.push(cur);
      cur = {
        team: side, points: p.value, start_t: p.t, end_t: p.t,
        start_clock: p.clock, start_period: p.period, end_clock: p.clock, end_period: p.period,
        from: [p.away - (side === "away" ? p.value : 0), p.home - (side === "home" ? p.value : 0)],
        to: [p.away, p.home],
      };
    }
  }
  if (cur && cur.points >= RUN_MIN) runs.push(cur);
  return runs;
}

const pick = (p: Play) => ({ t: p.t, period: p.period, clock: p.clock, home: p.home, away: p.away, text: p.text, scoring: p.scoring });

export async function build(eventId: string, cache?: Cache): Promise<any> {
  const key = `pulse_${eventId}`;
  if (cache) {
    const hit = await cache.get<any>(key, null);
    if (hit && Object.keys(hit).length) return hit;
  }
  const j = await fetchEspnSummary(eventId);
  const [teams, comp] = teamsOf(j);
  const homeId = teams.home.espn_id;
  const stype = comp.status?.type ?? {};
  const status = {
    state: stype.state ?? "",
    detail: stype.shortDetail || stype.detail || "",
    period: int(comp.status?.period),
    clock: comp.status?.displayClock ?? "",
  };

  const byId = new Map<string, Play>();
  const scoring: Play[] = [];
  for (const p of j.plays ?? []) {
    const period = int(p.period?.number, 1) || 1;
    const clock = p.clock?.displayValue ?? "";
    const rec: Play = {
      id: String(p.id),
      t: elapsed(period, clock),
      period,
      clock,
      home: int(p.homeScore),
      away: int(p.awayScore),
      text: p.text ?? "",
      scoring: !!p.scoringPlay,
      value: int(p.scoreValue),
      team_id: int(p.team?.id),
    };
    byId.set(rec.id, rec);
    if (rec.scoring && rec.value > 0) scoring.push(rec);
  }

  let timeline: any[] = [];
  for (const wp of j.winprobability ?? []) {
    const p = byId.get(String(wp.playId));
    if (!p) continue;
    timeline.push({ ...pick(p), wp: round(num(wp.homeWinPercentage, 0.5) * 100, 1) });
  }
  if (!timeline.length) {
    // no WP model (e.g. some preseason games) — chart the margin instead
    timeline = [...byId.values()].map((p) => ({ ...pick(p), wp: null }));
  }
  timeline.sort((a, b) => a.t - b.t);

  // Momentum: biggest win-probability swings
  let swings: any[] = [];
  for (let i = 1; i < timeline.length; i++) {
    const a = timeline[i - 1];
    const b = timeline[i];
    if (a.wp !== null && b.wp !== null) swings.push({ ...b, delta: round(b.wp - a.wp, 1) });
  }
  swings = swings.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 6);
  swings.sort((a, b) => a.t - b.t);

  // Lead changes, ties, largest leads
  let leadChanges = 0;
  let ties = 0;
  let leader: string | null = null;
  const biggest: Record<string, any> = {
    home: { margin: 0, t: 0, clock: "", period: 1 },
    away: { margin: 0, t: 0, clock: "", period: 1 },
  };
  for (const p of scoring) {
    const diff = p.home - p.away;
    const now = diff > 0 ? "home" : diff < 0 ? "away" : null;
    if (now === null) ties++;
    else if (leader && now !== leader) leadChanges++;
    if (now) {
      leader = now;
      if (Math.abs(diff) > biggest[now].margin) biggest[now] = { margin: Math.abs(diff), t: p.t, clock: p.clock, period: p.period };
    }
  }

  const leaders: any[] = [];
  for (const team of j.leaders ?? []) {
    const abbr = team.team?.abbreviation ?? "";
    for (const cat of (team.leaders ?? []).slice(0, 3)) {
      const top = cat.leaders?.[0] ?? {};
      const ath = top.athlete ?? {};
      leaders.push({
        team: abbr, category: cat.displayName ?? "", player: ath.displayName ?? "",
        value: top.displayValue ?? "", headshot: ath.headshot?.href ?? "",
      });
    }
  }

  const plays = [...byId.values()];
  const totalPeriods = Math.max(4, status.period, plays.length ? Math.max(...plays.map((p) => p.period)) : 4);
  const out = {
    event_id: String(eventId),
    status,
    teams,
    timeline,
    game_length: elapsed(totalPeriods, "0:00"),
    periods: Array.from({ length: totalPeriods }, (_, i) => ({ label: periodLabel(i + 1), start: elapsed(i + 1, i + 1 <= 4 ? "12:00" : "5:00") })),
    runs: detectRuns([...scoring].sort((a, b) => a.t - b.t), homeId),
    swings,
    lead_changes: leadChanges,
    ties,
    biggest_lead: biggest,
    leaders,
    box: parseBoxscore(j),
    recent_plays: [...plays].sort((a, b) => a.t - b.t).slice(-8).map((p) => p.text),
    venue: j.gameInfo?.venue?.fullName ?? "",
  };
  if (cache && status.state === "post" && timeline.length) await cache.set(key, out);
  return out;
}

const signed1 = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}`;

/** Plain-text game brief for the AI broadcaster recap. */
export async function recapContext(eventId: string): Promise<string> {
  const p = await build(eventId);
  const h = p.teams.home;
  const a = p.teams.away;
  const st = p.status;
  const lines = [
    `GAME: ${a.app_name} (${a.record}) at ${h.app_name} (${h.record})` + (p.venue ? ` — ${p.venue}` : ""),
    `STATUS: ${st.detail} (${st.state === "post" ? "FINAL" : st.state === "in" ? "LIVE" : "NOT STARTED"})`,
    `SCORE: ${a.abbr} ${a.score} – ${h.abbr} ${h.score}`,
  ];
  if (h.linescores.length) {
    const n = Math.min(h.linescores.length, a.linescores.length);
    lines.push(
      "BY PERIOD: " +
        Array.from({ length: n }, (_, i) => `${periodLabel(i + 1)} ${a.abbr} ${a.linescores[i]}-${h.linescores[i]} ${h.abbr}`).join(" | "),
    );
  }
  const lastWp = p.timeline.at(-1)?.wp;
  if (p.timeline.length && lastWp !== null && lastWp !== undefined) {
    lines.push(`WIN PROBABILITY NOW: ${h.abbr} ${lastWp.toFixed(0)}% / ${a.abbr} ${(100 - lastWp).toFixed(0)}%`);
  }
  lines.push(`LEAD CHANGES: ${p.lead_changes}, TIES: ${p.ties}`);
  for (const side of ["away", "home"]) {
    const b = p.biggest_lead[side];
    if (b.margin) lines.push(`${p.teams[side].abbr} BIGGEST LEAD: ${b.margin} (${periodLabel(b.period)} ${b.clock})`);
  }
  if (p.runs.length) {
    lines.push("SCORING RUNS (unanswered):");
    for (const r of p.runs) {
      lines.push(
        `  ${p.teams[r.team].abbr} ${r.points}-0 run, ${periodLabel(r.start_period)} ${r.start_clock} → ` +
          `${periodLabel(r.end_period)} ${r.end_clock} (score went ${r.from[0]}-${r.from[1]} → ${r.to[0]}-${r.to[1]}, away-home)`,
      );
    }
  }
  if (p.swings.length) {
    lines.push("BIGGEST MOMENTUM SWINGS (home win-prob change):");
    for (const s of p.swings) lines.push(`  ${periodLabel(s.period)} ${s.clock}: ${s.text} (${signed1(s.delta)} pts)`);
  }
  if (p.leaders.length) {
    lines.push("LEADERS: " + p.leaders.map((l: any) => `${l.team} ${l.category}: ${l.player} ${l.value}`).join("; "));
  }
  for (const side of ["away", "home"]) {
    const b = p.box[side];
    if (b) lines.push(`${b.abbr} TEAM: FG ${b.fg} (${b.fg_pct}%), 3P ${b.tp} (${b.tp_pct}%), REB ${b.reb}, AST ${b.ast}, TOV ${b.tov}`);
  }
  if (p.recent_plays.length) lines.push("LAST PLAYS: " + p.recent_plays.join(" / "));
  return lines.join("\n");
}
