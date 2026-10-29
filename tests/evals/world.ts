/** A small, fully known NBA world for the accuracy evals: yesterday's three
 *  finals (the Celtics didn't play), tonight's Hawks @ Celtics with a line,
 *  rosters, league stats, standings and one injury. Every answer can be
 *  scored against it. */

import { shiftDay } from "../../web/src/backend/llm/grounding";
import * as data from "../../web/src/backend/nba/data";
import { resultSet, serve } from "../fake";

export const TODAY = data.nbaToday();
export const YESTERDAY = shiftDay(TODAY, -1);
const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

// [nba id, espn id, tricode]
const T = {
  ATL: [1610612737, 1, "ATL"],
  BOS: [1610612738, 2, "BOS"],
  CHI: [1610612741, 4, "CHI"],
  DEN: [1610612743, 7, "DEN"],
  GSW: [1610612744, 9, "GS"],
  LAL: [1610612747, 13, "LAL"],
  NYK: [1610612752, 18, "NY"],
  PHX: [1610612756, 21, "PHX"],
} as const;
type Abbr = keyof typeof T;

// [pid, name, team, pos, ppg]
export const PLAYERS: [number, string, Abbr, string, number][] = [
  [1628369, "Jayson Tatum", "BOS", "F", 27.1],
  [1627759, "Jaylen Brown", "BOS", "G", 23.4],
  [202331, "Paul George", "BOS", "F", 18.4],
  [1628401, "Derrick White", "BOS", "G", 15.2],
  [204001, "Kristaps Porzingis", "BOS", "C", 17.0],
  [1629027, "Trae Young", "ATL", "G", 24.0],
  [1628973, "Jalen Brunson", "NYK", "G", 26.0],
  [1629632, "Coby White", "CHI", "G", 20.1],
  [1629029, "Luka Doncic", "LAL", "G", 29.5],
  [1626164, "Devin Booker", "PHX", "G", 26.3],
  [203999, "Nikola Jokic", "DEN", "C", 28.0],
  [201939, "Stephen Curry", "GSW", "G", 25.5],
];

// [espn id, away, away pts, home, home pts, periods, away top scorer, pts, home top scorer, pts]
export const FINALS: [string, Abbr, number, Abbr, number, number, string, number, string, number][] = [
  ["401900001", "NYK", 101, "CHI", 99, 4, "Jalen Brunson", 33, "Coby White", 27],
  ["401900002", "LAL", 118, "PHX", 112, 4, "Luka Doncic", 35, "Devin Booker", 30],
  ["401900003", "DEN", 125, "GSW", 121, 5, "Nikola Jokic", 31, "Stephen Curry", 34],
];

const side = (abbr: Abbr, homeAway: string, score: number | null, record: string, scorer?: [string, number]) => ({
  homeAway,
  score: score === null ? "" : String(score),
  team: { id: String(T[abbr][1]), abbreviation: T[abbr][2], displayName: abbr },
  records: [{ summary: record }],
  ...(scorer ? { leaders: [{ name: "points", leaders: [{ athlete: { displayName: scorer[0] }, displayValue: String(scorer[1]) }] }] } : {}),
});

const finalEvent = ([id, a, ap, h, hp, periods, as, asp, hs, hsp]: (typeof FINALS)[number]) => ({
  id,
  date: `${iso(YESTERDAY)}T23:30Z`,
  season: { type: 2 },
  status: { period: periods, displayClock: "0.0", type: { state: "post", shortDetail: periods > 4 ? "Final/OT" : "Final" } },
  competitions: [{ competitors: [side(h, "home", hp, "3-2", [hs, hsp]), side(a, "away", ap, "4-1", [as, asp])] }],
});

const tonight = {
  id: "401900010",
  date: `${iso(TODAY)}T23:30Z`,
  season: { type: 2 },
  status: { period: 0, displayClock: "0.0", type: { state: "pre", shortDetail: "7:30 PM ET" } },
  competitions: [{ competitors: [side("BOS", "home", null, "4-1"), side("ATL", "away", null, "2-3")], odds: [{ details: "BOS -6.5", overUnder: 224.5 }] }],
};

const scoreboard = (u: string) => {
  const day = new URL(u).searchParams.get("dates");
  const events = day === YESTERDAY ? FINALS.map(finalEvent) : day === TODAY ? [tonight] : [];
  return { day: { date: day ? iso(day) : iso(TODAY) }, events };
};

const summary = (u: string) => {
  const id = new URL(u).searchParams.get("event");
  const f = FINALS.find((g) => g[0] === id);
  if (!f) return new Response("no game", { status: 404 });
  const [, a, ap, h, hp, periods, as, asp, hs, hsp] = f;
  const competitors = [side(h, "home", hp, "3-2"), side(a, "away", ap, "4-1")];
  const athlete = (name: string, pts: number) => ({ athlete: { id: name, displayName: name }, starter: true, stats: ["36", String(pts), "6", "5"] });
  const box = (abbr: Abbr, name: string, pts: number) => ({
    team: { id: String(T[abbr][1]), abbreviation: T[abbr][2] },
    statistics: [{ keys: ["minutes", "points", "rebounds", "assists"], athletes: [athlete(name, pts)], totals: [] }],
  });
  return {
    header: { competitions: [{ competitors, status: { period: periods, type: { state: "post", detail: "Final" } } }] },
    boxscore: { players: [box(h, hs, hsp), box(a, as, asp)] },
    plays: [],
  };
};

const statsRows = (u: string) => {
  const team = new URL(u).searchParams.get("TeamID");
  const rows = PLAYERS.filter(([, , t]) => !team || String(T[t][0]) === team);
  return resultSet(
    rows.map(([pid, name, t, , ppg]) => ({ PLAYER_ID: pid, PLAYER_NAME: name, TEAM_ID: T[t][0], TEAM_ABBREVIATION: t, GP: 5, PTS: ppg, REB: 5, AST: 4, MIN: 32, FG_PCT: 0.47, FG3_PCT: 0.37 })),
  );
};

const roster = (u: string) => {
  const team = Number(new URL(u).searchParams.get("TeamID"));
  return resultSet(PLAYERS.filter(([, , t]) => T[t][0] === team).map(([pid, name, , pos]) => ({ PLAYER_ID: pid, PLAYER: name, POSITION: pos, HOW_ACQUIRED: "" })));
};

// [team, conference, rank, wins, losses]
const STANDINGS: [Abbr, string, number, number, number][] = [
  ["BOS", "East", 1, 4, 1],
  ["NYK", "East", 2, 4, 1],
  ["CHI", "East", 6, 3, 2],
  ["ATL", "East", 9, 2, 3],
  ["DEN", "West", 1, 4, 1],
  ["LAL", "West", 3, 4, 1],
  ["PHX", "West", 7, 3, 2],
  ["GSW", "West", 8, 3, 2],
];

/** Serve the world to the data layer. */
export function serveWorld() {
  return serve([
    ["scoreboard", scoreboard],
    ["summary", summary],
    ["leaguedashplayerstats", statsRows],
    ["commonteamroster", roster],
    ["leaguestandingsv3", resultSet(STANDINGS.map(([t, c, r, w, l]) => ({ TeamID: T[t][0], Conference: c, PlayoffRank: r, WINS: w, LOSSES: l, WinPCT: w / (w + l), L10: `${w}-${l}`, strCurrentStreak: "W 1" })))],
    ["injuries", { injuries: [{ id: "2", injuries: [{ athlete: { displayName: "Kristaps Porzingis", position: { abbreviation: "C" } }, status: "Out", details: { type: "Ankle", returnDate: "2026-11-05" }, shortComment: "Ankle sprain" }] }] }],
  ]);
}
