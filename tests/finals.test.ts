/** Tonight's finals: ESPN fills in games nba.com hasn't logged yet. */

import { beforeEach, describe, expect, it } from "vitest";
import { Cache } from "../web/src/backend/cache";
import { currentSeason, SEASON_TYPE_REGULAR } from "../web/src/backend/config";
import * as data from "../web/src/backend/nba/data";
import * as services from "../web/src/backend/nba/services";
import { resultSet, serve } from "./fake";

const BOS = 1610612738;
const season = currentSeason();
const ymd = data.nbaToday();
const iso = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

// Celtics 110, Nets 100 tonight, final on ESPN.
const espnFinal = {
  id: "401800001",
  date: new Date(Date.now() - 3 * 3600_000).toISOString(),
  season: { type: 2 },
  status: { period: 4, displayClock: "0.0", type: { state: "post", shortDetail: "Final" } },
  competitions: [{ competitors: [
    { homeAway: "home", score: "110", team: { id: "2", abbreviation: "BOS" }, records: [{ summary: "11-3" }] },
    { homeAway: "away", score: "100", team: { id: "17", abbreviation: "BKN" }, records: [{ summary: "5-9" }] },
  ] }],
};
const scoreboard = (u: string) => ({ events: new URL(u).searchParams.get("dates") === ymd ? [espnFinal] : [] });

const dash = { GP: 13, PTS: 1500, REB: 580, AST: 330, STL: 90, BLK: 70, TOV: 160, FGM: 560, FGA: 1200, FG3M: 210, FG3A: 560, FTM: 170, FTA: 210, PLUS_MINUS: 90 };
const logRow = (gid: string, date: string, matchup: string, wl: string, pts: number, pm: number) =>
  ({ GAME_ID: gid, GAME_DATE: `${date}T00:00:00`, MATCHUP: matchup, WL: wl, PTS: pts, REB: 44, AST: 26, FG_PCT: 0.48, PLUS_MINUS: pm });
const older = logRow("0022600100", "2026-01-02", "BOS @ NYK", "W", 115, 6);
const tonight = logRow("0022600120", iso, "BOS vs. BKN", "W", 110, 10);

function nba(log: object[]) {
  return serve([
    ["scoreboard", scoreboard],
    ["leaguestandingsv3", resultSet([{ TeamID: BOS, Conference: "East", PlayoffRank: 2, WINS: 10, LOSSES: 3, WinPCT: 0.769 }])],
    ["teamdashboardbygeneralsplits", resultSet([dash])],
    ["teamgamelogs", resultSet(log as Record<string, unknown>[], Object.keys(older))],
    ["leaguegamelog", resultSet([], ["GAME_ID", "GAME_DATE", "TEAM_ID", "TEAM_ABBREVIATION", "MATCHUP", "WL", "PTS", "MIN"])],
  ]);
}

describe("tonight's finals", () => {
  beforeEach(() => data.clearRecentFinals());

  it("shows an ESPN final nba.com hasn't logged, with the updated record", async () => {
    nba([older]);
    const o: any = await services.teamOverview(BOS, season, new Cache({ persist: false }));
    const top = o.games.regular[0];
    expect(top).toMatchObject({ pending: true, espn_id: "401800001", wl: "W", pts: 110, plus_minus: 10, matchup: "BOS vs. BKN", reb: null, iso });
    expect(o.games.regular[1].game_id).toBe("0022600100");
    expect(o.standings).toMatchObject({ wins: 11, losses: 3 });
  });

  it("uses nba.com's row once it has the game, without a duplicate", async () => {
    nba([tonight, older]);
    const o: any = await services.teamOverview(BOS, season, new Cache({ persist: false }));
    expect(o.games.regular.map((g: any) => g.game_id)).toEqual(["0022600120", "0022600100"]);
    expect(o.games.regular.some((g: any) => g.pending)).toBe(false);
  });

  it("refetches a game log cached before tonight's final", async () => {
    const cache = new Cache({ persist: false });
    const key = `games_v3_${BOS}_${season}_${SEASON_TYPE_REGULAR}`;
    await cache.set(key, [{ game_id: "0022600100", iso: "2026-01-02", date: "Jan 02, 2026", matchup: "BOS @ NYK", wl: "W", pts: 115, reb: 44, ast: 26, fg_pct: 48, plus_minus: 6 }]);
    (cache as any).mem.get(key).ts -= 5 * 3600; // written before tip-off
    const calls = nba([tonight, older]);
    const o: any = await services.teamOverview(BOS, season, cache);
    expect(calls.some((u) => u.includes("teamgamelogs"))).toBe(true);
    expect(o.games.regular[0].game_id).toBe("0022600120");
  });

  it("adds the final to Scores", async () => {
    nba([]);
    const s: any = await services.scores(season, new Cache({ persist: false }));
    expect(s.regular[0]).toMatchObject({ pending: true, date: iso, home: { abbr: "BOS", pts: 110 }, away: { abbr: "BKN", pts: 100 } });
  });

  it("never asks ESPN for past seasons", async () => {
    const calls = nba([older]);
    await services.teamOverview(BOS, "2019-20", new Cache({ persist: false }));
    expect(calls.some((u) => u.includes("scoreboard"))).toBe(false);
  });
});
