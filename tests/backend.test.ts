/** Offline tests for the data layer (ported from the desktop's tests/test_backend.py).
 *  No network: the HTTP layer serves canned payloads. */

import { describe, expect, it, vi } from "vitest";
import { Cache, localIsoDate, Memo } from "../web/src/backend/cache";
import * as config from "../web/src/backend/config";
import * as data from "../web/src/backend/nba/data";
import * as services from "../web/src/backend/nba/services";
import { handle } from "../web/src/backend/router";
import { resultSet, serve } from "./fake";

const BOS = 1610612738;
const LAL = 1610612747;
const mem = (c: Cache) => (c as any).mem as Map<string, { ts: number; data: unknown }>;

// ── Cache ────────────────────────────────────────────────────────────────────

describe("cache", () => {
  it("expires by ttl and retries empty results", async () => {
    const cache = new Cache({ persist: false });
    await cache.set("k", [1]);
    expect(await cache.get("k")).toEqual([1]);
    mem(cache).get("k")!.ts -= 10_000;
    expect(await cache.get("k", 5_000)).toBeUndefined();
    expect(await cache.get("k", null)).toEqual([1]);

    await cache.set("empty", []);
    expect(await cache.get("empty")).toEqual([]); // fresh empty result is a hit
    mem(cache).get("empty")!.ts -= config.EMPTY_TTL + 1;
    expect(await cache.get("empty")).toBeUndefined(); // ...but retried after EMPTY_TTL
  });

  it("runs one fetch for concurrent callers and never caches failures", async () => {
    const cache = new Cache({ persist: false });
    let calls = 0;
    const slow = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 50));
      return { v: 1 };
    };
    await Promise.all(Array.from({ length: 5 }, () => cache.getOrFetch("k", slow, { fallback: {} })));
    expect(calls).toBe(1);

    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await cache.getOrFetch("bad", async () => Promise.reject(new Error("network down")), { fallback: [] })).toEqual([]);
    quiet.mockRestore();
    expect(await cache.get("bad")).toBeUndefined();
  });

  it("persists to IndexedDB and prunes dead entries", async () => {
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const cache = new Cache({ persist: true });
    await cache.set("gbd_1", { old: true });
    await cache.set("gbd_2", { old: false });
    await cache.set(`upcoming_v3_${localIsoDate(yesterday)}_14`, [1]);
    await cache.set(`upcoming_v3_${localIsoDate(today)}_14`, [2]);
    // age gbd_1 on disk
    const { idbGet, idbSet } = await import("../web/src/backend/idb");
    const e = (await idbGet<{ ts: number; data: unknown }>("cache", "gbd_1"))!;
    await idbSet("cache", "gbd_1", { ...e, ts: e.ts - config.PAST_SEASON_TTL - 1 });

    const again = new Cache({ persist: true });
    expect(await again.prune()).toBe(2);
    expect(await again.get("gbd_2", null)).toEqual({ old: false });
    expect(await again.get("gbd_1", null)).toBeUndefined();
    expect(await again.get(`upcoming_v3_${localIsoDate(today)}_14`, null)).toEqual([2]);
  });

  it("memo expires and drops the least recently used entry", () => {
    vi.useFakeTimers();
    try {
      const m = new Memo(2);
      m.set("a", 1, 10);
      m.set("b", 2, 10);
      expect(m.get("a")).toBe(1); // touching "a" makes "b" the oldest
      m.set("c", 3, 10);
      expect(m.get("b")).toBeUndefined();
      expect(m.get("a")).toBe(1);
      expect(m.get("c")).toBe(3);
      vi.advanceTimersByTime(11_000);
      expect(m.get("a")).toBeUndefined(); // expired
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── Seasons ──────────────────────────────────────────────────────────────────

describe("seasons", () => {
  it.each([
    [new Date(2026, 9, 22), 2026],
    [new Date(2026, 9, 1), 2025],
    [new Date(2027, 2, 1), 2026],
    [new Date(2027, 5, 15), 2026],
  ])("rolls over on Oct 15 (%s)", (day, expected) => {
    expect(config.dateSeasonStart(day)).toBe(expected);
  });

  it("formats seasons and parses season types", () => {
    expect(config.seasonStr(2026)).toBe("2026-27");
    expect(config.seasonStr(2099)).toBe("2099-00");
    expect(config.parseSeasonType("playoffs")).toBe(config.SEASON_TYPE_PLAYOFFS);
    expect(config.parseSeasonType("Full Year")).toBe(config.SEASON_TYPE_FULL);
    expect(config.parseSeasonType("junk")).toBe(config.SEASON_TYPE_REGULAR);
    const seasons = config.allSeasons();
    expect(seasons.length).toBe(config.SEASON_COUNT);
    expect(seasons[0]).toBe(config.currentSeason());
  });

  it("knows when playoffs are possible", () => {
    const cur = config.currentSeason();
    const start = config.seasonStartYear(cur);
    expect(config.playoffsPossible(cur, new Date(start, 9, 24))).toBe(false);
    expect(config.playoffsPossible(cur, new Date(start + 1, 2, 31))).toBe(false);
    expect(config.playoffsPossible(cur, new Date(start + 1, 3, 1))).toBe(true);
    expect(config.playoffsPossible(config.seasonStr(start - 1), new Date(start, 9, 24))).toBe(true); // past seasons always
  });
});

// ── Services ─────────────────────────────────────────────────────────────────

const dashRow = (gp: number, pts: number) => ({
  GP: gp, PTS: pts, REB: 0, AST: 0, STL: 0, BLK: 0, TOV: 0, FGM: 0, FGA: 0, FG3M: 0, FG3A: 0, FTM: 0, FTA: 0, PLUS_MINUS: 0,
});

describe("services", () => {
  it("combines dashboards into Full Year", async () => {
    const cache = new Cache({ persist: false });
    serve([
      [/SeasonType=Regular/, resultSet([dashRow(82, 82 * 110)])],
      [/SeasonType=Playoffs/, resultSet([dashRow(10, 10 * 100)])],
    ]);
    const reg = await data.fetchDashboard(BOS, "2024-25", cache);
    const po = await data.fetchDashboard(BOS, "2024-25", cache, config.SEASON_TYPE_PLAYOFFS);
    const full: any = data.combineDashboards(reg, po);
    expect(full.gp).toBe(92);
    expect(full.pts).toBe(Math.round(((82 * 110 + 10 * 100) / 92) * 10) / 10);
    expect(data.combineDashboards({}, {})).toEqual({});
  });

  it("skips playoff fetches early in the season", async () => {
    const cache = new Cache({ persist: false });
    const cur = config.currentSeason();
    if (config.playoffsPossible(cur)) return; // only meaningful Oct-Mar
    const calls = serve([
      ["teamdashboardbygeneralsplits", resultSet([dashRow(1, 100)])],
      ["leaguegamelog", resultSet([])],
      ["scoreboard", { events: [] }],
    ]);
    const [, po, full] = await services.teamDashboards(BOS, cur, cache);
    expect(po).toEqual({});
    expect((full as any).gp).toBe(1);
    expect((await services.scores(cur, cache)).playoffs).toEqual([]);
    expect(calls.some((u) => u.includes("Playoffs"))).toBe(false);
  });

  it("builds a head-to-head series", () => {
    const games = [
      { game_id: "3", date: "MAR 08", matchup: "BOS vs. LAL", wl: "W", pts: 111 },
      { game_id: "2", date: "FEB 01", matchup: "BOS @ NYK", wl: "W", pts: 120 },
      { game_id: "1", date: "JAN 23", matchup: "BOS @ LAL", wl: "L", pts: 96 },
    ];
    const [series, rec] = services.computeSeries(BOS, games, new Map([["1", 117], ["3", 101]]), "LAL");
    expect(rec).toEqual([1, 1]);
    expect(series.map((g) => g.game_id)).toEqual(["1", "3"]); // chronological
    expect(series[0].summary).toBe("BOS 96  @  LAL 117");
  });

  it("counts Full Year records from standings plus playoff logs", async () => {
    const cache = new Cache({ persist: false });
    const gl = (gid: string, matchup: string, wl: string, pts: number) => ({ Game_ID: gid, GAME_DATE: "JAN", MATCHUP: matchup, WL: wl, PTS: pts });
    serve([
      ["leaguestandingsv3", resultSet([
        { TeamID: BOS, Conference: "East", PlayoffRank: 1, WINS: 61, LOSSES: 21 },
        { TeamID: LAL, Conference: "West", PlayoffRank: 4, WINS: 50, LOSSES: 32 },
      ])],
      ["teamdashboardbygeneralsplits", resultSet([dashRow(1, 100)])],
      [new RegExp(`teamgamelog\\?TeamID=${BOS}.*SeasonType=Regular`), resultSet([gl("1", "BOS @ LAL", "L", 96)])],
      [new RegExp(`teamgamelog\\?TeamID=${LAL}.*SeasonType=Regular`), resultSet([gl("1", "LAL vs. BOS", "W", 117)])],
      [new RegExp(`teamgamelog\\?TeamID=${BOS}.*SeasonType=Playoffs`), resultSet(Array(6).fill(gl("9", "BOS vs. NYK", "W", 100)))],
      [new RegExp(`teamgamelog\\?TeamID=${LAL}.*SeasonType=Playoffs`), resultSet([], ["Game_ID", "GAME_DATE", "MATCHUP", "WL", "PTS"])],
    ]);
    const out = await services.compare(BOS, LAL, "2024-25", config.SEASON_TYPE_FULL, cache);
    expect(out.a.record).toEqual([67, 21]);
    expect(out.b.record).toEqual([50, 32]);
    expect(out.series_record).toEqual([0, 1]);
    expect("_tot" in out.a.dash).toBe(false);
    expect(out.context).toContain("HEAD-TO-HEAD MEETINGS");
  });

  it("fetches the schedule a day at a time and never caches a partial one", async () => {
    const cache = new Cache({ persist: false });
    const ev = {
      id: "1", date: "2026-10-23T23:30Z", season: { type: 2 }, status: { type: { state: "pre" } },
      competitions: [{ competitors: [
        { homeAway: "home", team: { id: "2", abbreviation: "BOS" } },
        { homeAway: "away", team: { id: "13", abbreviation: "LAL" } },
      ] }],
    };
    serve([["scoreboard", { events: [ev] }]]);
    const games = await data.fetchUpcomingGames(cache, 2);
    expect(games.length).toBe(3);
    expect(games[0].home.app_name).toBe("Boston Celtics");

    const cache2 = new Cache({ persist: false });
    serve([["scoreboard", new Response("bad", { status: 400 })]]);
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await data.fetchUpcomingGames(cache2, 2)).toEqual([]);
    quiet.mockRestore();
    expect(mem(cache2).size === 0 || [...mem(cache2).values()].every((e) => e === null)).toBe(true);
  });
});

// ── Leaders ──────────────────────────────────────────────────────────────────

const prow = (pid: number, gp: number, vals: Record<string, number> = {}) =>
  ({ pid, name: `P${pid}`, team_id: BOS, team_abbr: "BOS", gp, ...vals }) as data.LeaguePlayerRow;

describe("leaders", () => {
  it("qualifies on 70% of the most games played", () => {
    expect(data.minGames([prow(1, 82), prow(2, 10)])).toBe(58);
    expect(data.minGames([prow(1, 2)])).toBe(2); // early season: ceil(1.4)
    expect(data.minGames([])).toBe(1);
  });

  it("applies per-game volume qualifiers", () => {
    let rows = [prow(1, 10, { PTS: 20 }), prow(2, 3, { PTS: 40 }), prow(3, 9, { PTS: 25 })];
    expect(data.topPlayers(rows, "PTS").map((r) => r.pid)).toEqual([3, 1]);
    // FG% needs 300/82 = 3.66 makes a game: the 1-for-1 big man is out.
    rows = [prow(1, 10, { FG_PCT: 1, FGM: 1 }), prow(2, 10, { FG_PCT: 0.55, FGM: 8 }), prow(3, 10, { FG_PCT: 0.6, FGM: 4 })];
    expect(data.topPlayers(rows, "FG_PCT", ["FGM", 300 / 82]).map((r) => r.pid)).toEqual([3, 2]);
    rows = Array.from({ length: 15 }, (_, i) => prow(i + 1, 5, { PF: i + 1 }));
    const top = data.topPlayers(rows, "PF");
    expect(top.length).toBe(10);
    expect(top[0].pid).toBe(15);
  });

  it("serves player leaders, rookies from their own pool", async () => {
    const row = (pid: number, pts: number, fgPct: number, fgm: number) =>
      ({ PLAYER_ID: pid, PLAYER_NAME: `P${pid}`, TEAM_ID: BOS, TEAM_ABBREVIATION: "BOS", GP: 2, PTS: pts, FG_PCT: fgPct, FGM: fgm });
    const calls = serve([
      [/PlayerExperience=Rookie/, resultSet([row(9, 12, 0.5, 5)])],
      ["leaguedashplayerstats", resultSet([row(1, 30, 0.5, 9), row(2, 20, 0.7, 2)])],
    ]);
    const r: any = await handle("GET", "/league/player-leaders?season=2019-20");
    const cats = Object.fromEntries(r.categories.map((c: any) => [c.label, c]));
    expect(r.min_games).toBe(2);
    expect(cats.Points.leaders.map((p: any) => p.pid)).toEqual([1, 2]);
    expect(cats["FG%"].leaders.map((p: any) => p.pid)).toEqual([1]); // player 2 lacks volume
    expect(cats["FG%"].min_per_game).toEqual({ field: "FGM", value: 3.7 });
    const rook: any = await handle("GET", "/league/player-leaders?season=2019-20&rookies=true");
    expect(rook.categories[0].leaders.map((p: any) => p.pid)).toEqual([9]);
    await handle("GET", "/league/player-leaders?season=2019-20&rookies=true"); // cached
    expect(calls.filter((u) => u.includes("Rookie")).length).toBe(1);
  });

  it("stores only the columns the leaderboards use", async () => {
    const cache = new Cache({ persist: false });
    serve([["leaguedashplayerstats", resultSet([{
      PLAYER_ID: 1, PLAYER_NAME: "A", TEAM_ID: BOS, TEAM_ABBREVIATION: "BOS", GP: 3, PTS: 20, FGM: 8, FG_PCT: 0.5,
      PTS_RANK: 4, NBA_FANTASY_PTS: 40, AGE: 25,
    }])]]);
    const row = (await data.fetchLeaguePlayerStats("2018-19", cache))[0];
    expect(row).toEqual({ pid: 1, name: "A", team_id: BOS, team_abbr: "BOS", gp: 3, PTS: 20, FGM: 8, FG_PCT: 0.5 });
  });
});

// ── Box scores ───────────────────────────────────────────────────────────────

const v3Player = (pid: number, first: string, last: string, pos: string, minutes: string, pts: number, comment = "") => ({
  personId: pid, firstName: first, familyName: last, position: pos, comment,
  statistics: minutes ? { minutes, points: pts, fieldGoalsMade: Math.floor(pts / 2), fieldGoalsAttempted: pts, plusMinusPoints: 3.0 } : { minutes: "" },
});

describe("box scores", () => {
  it("parses an nba.com box", () => {
    const team = (tri: string, tid: number) => ({
      teamTricode: tri, teamId: tid, statistics: { points: 30, fieldGoalsMade: 15 },
      players: [v3Player(1, "A", "Star", "F", "36:10", 20), v3Player(2, "B", "Sub", "", "12:00", 10), v3Player(3, "C", "Hurt", "", "", 0, "Inactive - Injury/Illness")],
    });
    const box: any = data.parseNbaBox({ awayTeam: team("NYK", 1), homeTeam: team("BOS", BOS) });
    expect(box.final).toBe(true);
    expect(box.home.abbr).toBe("BOS");
    expect(box.home.totals.pts).toBe(30);
    const [star, sub, hurt] = box.home.players;
    expect(star.starter && !sub.starter).toBe(true); // only starters get a position
    expect([star.min, star.fgm, star.pm]).toEqual(["36:10", 10, 3]);
    expect(hurt.dnp).toBe("Inactive - Injury/Illness");
    expect(sub.dnp).toBe("");
  });

  it("parses an ESPN box", () => {
    const keys = ["minutes", "points", "fieldGoalsMade-fieldGoalsAttempted", "threePointFieldGoalsMade-threePointFieldGoalsAttempted", "rebounds", "plusMinus"];
    const team = (tid: string, abbr: string) => ({
      team: { id: tid, abbreviation: abbr },
      statistics: [{
        keys, totals: ["", "110", "40-90", "12-35", "45", ""],
        athletes: [
          { athlete: { id: "9", displayName: "Top Guy", position: { abbreviation: "G" } }, starter: true, didNotPlay: false, reason: "COACH'S DECISION", stats: ["34", "28", "10-19", "4-9", "5", "+7"] },
          { athlete: { id: "8", displayName: "Bench Guy" }, starter: false, didNotPlay: true, reason: "COACH'S DECISION", stats: [] },
        ],
      }],
    });
    const j = {
      header: { competitions: [{ status: { type: { state: "in" } }, competitors: [
        { team: { id: "2" }, homeAway: "home", score: "61" },
        { team: { id: "18" }, homeAway: "away", score: "58" },
      ] }] },
      boxscore: { players: [team("18", "NY"), team("2", "BOS")] },
    };
    const box = data.parseEspnBox(j);
    expect(box.final).toBe(false);
    expect(box.home.abbr).toBe("BOS");
    expect(box.home.score).toBe(61);
    const [top, bench] = box.away.players;
    expect([top.pts, top.fgm, top.fga, top.tpm, top.pm]).toEqual([28, 10, 19, 4, 7]);
    expect(top.dnp).toBe(""); // a reason alone doesn't mean he sat
    expect(top.starter).toBe(true);
    expect(bench.dnp).toBe("Coach's Decision");
    expect(box.away.totals.fga).toBe(90);
  });

  it("holds full boxes in memory, not the cache", async () => {
    const calls = serve([["boxscoretraditionalv3", { boxScoreTraditional: {} }]]);
    for (let i = 0; i < 2; i++) {
      const r: any = await handle("GET", "/game/0022600008/box");
      expect(r.source).toBe("nba");
    }
    expect(calls.length).toBe(1); // second open came from memory
  });
});

// ── Player extras ────────────────────────────────────────────────────────────

describe("players", () => {
  it("trims absence notes to what's about the player", async () => {
    const zion =
      "forward Zion Williamson missed the entire season due to foot and knee injuries. " +
      "† Denotes player spent time with another team in the season. Stats reflect";
    const clean = "forward Zion Williamson missed the entire season due to foot and knee injuries.";
    expect(data.trimNote(zion, "Zion Williamson", "2021-22")).toBe(clean);
    const bbref = "2021-22. Did not play - holdout/back injury. Click Season link for player's season game log";
    expect(data.trimNote(bbref, "Ben Simmons", "2021-22")).toBe("2021-22. Did not play - holdout/back injury.");
    expect(data.trimNote("Stats reflect", "Zion Williamson", "2021-22")).toBe("Stats reflect"); // keep it all
    // Notes cached untrimmed come back trimmed.
    const cache = new Cache({ persist: false });
    await cache.set("absence_Zion Williamson_2021-22", { text: zion, title: "t", source: "s", url: "u" });
    const calls = serve([]);
    expect((await data.fetchAbsenceNote("Zion Williamson", "2021-22", cache)).text).toBe(clean);
    expect(calls).toEqual([]); // cached note: no search
  });

  it("reads heights and finds combine measurements", async () => {
    expect(data.heightInches("6-8")).toBe(80);
    expect(data.heightInches("")).toBeNull();
    const cache = new Cache({ persist: false });
    const seen: string[] = [];
    serve([["draftcombineplayeranthro", (u: string) => {
      const y = new URL(u).searchParams.get("SeasonYear")!;
      seen.push(y);
      return resultSet(y === "2016" ? [{ PLAYER_ID: 7, WINGSPAN: 83.75 }] : [], ["PLAYER_ID", "WINGSPAN"]);
    }]]);
    // Measured a year before his rookie season (went back to school).
    const hit = await data.fetchAnthro(7, { draft_year: null, from_year: 2017 }, cache);
    expect(hit.year).toBe(2016);
    expect(hit.wingspan).toBe(83.75);
    expect(seen).toEqual(["2017", "2016"]);
    expect(await data.fetchAnthro(8, { draft_year: 1996, from_year: 1996 }, cache)).toBeNull(); // pre-2000
  });
});

// ── API ──────────────────────────────────────────────────────────────────────

describe("api router", () => {
  it("rejects bad params like the desktop API", async () => {
    await expect(handle("GET", "/team/123/overview")).rejects.toMatchObject({ status: 404 });
    await expect(handle("GET", "/league/standings?season=2025")).rejects.toMatchObject({ status: 422 });
    await expect(handle("GET", `/compare?a=${BOS}&b=${BOS}`)).rejects.toMatchObject({ status: 400 });
    await expect(handle("GET", "/game/12/story")).rejects.toMatchObject({ status: 422 });
    await expect(handle("GET", "/nope")).rejects.toMatchObject({ status: 404 });
  });

  it("serves meta with every team and its colors", async () => {
    const meta: any = await handle("GET", "/meta");
    expect(meta.teams.length).toBe(30);
    expect(meta.seasons[0]).toBe(meta.season);
    const bos = meta.teams.find((t: any) => t.id === BOS);
    expect(bos).toMatchObject({ abbr: "BOS", espn_abbr: "bos", conference: "East", colors: { primary: "#007A33" } });
  });

  it("assembles a team overview", async () => {
    serve([
      ["leaguestandingsv3", resultSet([{ TeamID: BOS, Conference: "East", PlayoffRank: 2, WINS: 10, LOSSES: 3, WinPCT: 0.769, ConferenceGamesBack: 1, strCurrentStreak: "W 3 ", L10: "8-2", HOME: "6-1", ROAD: "4-2" }])],
      ["teamdashboardbygeneralsplits", resultSet([dashRow(13, 13 * 115)])],
      ["teamgamelogs", resultSet([{ GAME_ID: "0022500001", GAME_DATE: "2025-04-13T00:00:00", MATCHUP: "BOS vs. LAL", WL: "W", PTS: 120, REB: 44, AST: 28, FG_PCT: 0.5, PLUS_MINUS: 12 }])],
      ["scoreboard", { events: [] }],
    ]);
    const o: any = await handle("GET", `/team/${BOS}/overview?season=2024-25`);
    expect(o.standings).toMatchObject({ wins: 10, conf_rank: 2, streak: "W 3" });
    expect(o.dash.regular.pts).toBe(115);
    expect("_tot" in o.dash.regular).toBe(false);
    expect(o.games.regular[0]).toMatchObject({ date: "Apr 13, 2025", iso: "2025-04-13", fg_pct: 50 });
    expect(o.next_game).toBeNull(); // past season
  });
});
