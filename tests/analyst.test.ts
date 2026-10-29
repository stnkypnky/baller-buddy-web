/** The AI analyst's data: tonight's games by team or any id, injuries and
 *  rumors, results that fit, parallel tool calls and the NBA-only scope. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache } from "../web/src/backend/cache";
import * as openaiAdapter from "../web/src/backend/llm/openaiAdapter";
import * as router from "../web/src/backend/llm/router";
import * as tools from "../web/src/backend/llm/tools";
import * as data from "../web/src/backend/nba/data";
import * as settings from "../web/src/backend/settings";
import { resultSet, serve } from "./fake";

const BOS = 1610612738;
const ymd = data.nbaToday();
const iso = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

// Celtics 110, Nets 100 tonight: final on ESPN, not yet in nba.com's logs.
const competitors = [
  { homeAway: "home", score: "110", team: { id: "2", abbreviation: "BOS" }, records: [{ summary: "11-3" }], linescores: [28, 30, 25, 27].map((v) => ({ displayValue: String(v) })) },
  { homeAway: "away", score: "100", team: { id: "17", abbreviation: "BKN" }, records: [{ summary: "5-9" }], linescores: [25, 22, 30, 23].map((v) => ({ displayValue: String(v) })) },
];
const espnFinal = {
  id: "401800001",
  date: new Date(Date.now() - 3 * 3600_000).toISOString(),
  season: { type: 2 },
  status: { period: 4, displayClock: "0.0", type: { state: "post", shortDetail: "Final" } },
  competitions: [{ competitors }],
};
const scoreboard = (u: string) => ({ day: { date: iso }, events: new URL(u).searchParams.get("dates") === ymd ? [espnFinal] : [] });
const athlete = (name: string, stats: string[]) => ({ athlete: { id: name, displayName: name }, starter: true, stats });
const summary = {
  header: { competitions: [{ competitors, status: { period: 4, type: { state: "post", detail: "Final" } } }] },
  boxscore: { players: [
    { team: { id: "2", abbreviation: "BOS" }, statistics: [{ keys: ["minutes", "points", "rebounds", "assists"], athletes: [athlete("Jayson Tatum", ["36", "31", "9", "6"]), athlete("Jaylen Brown", ["34", "24", "5", "4"])], totals: [] }] },
    { team: { id: "17", abbreviation: "BKN" }, statistics: [{ keys: ["minutes", "points", "rebounds", "assists"], athletes: [athlete("Cam Thomas", ["35", "28", "3", "5"])], totals: [] }] },
  ] },
  plays: [],
};

const dash = { GP: 13, PTS: 1500, REB: 580, AST: 330, STL: 90, BLK: 70, TOV: 160, FGM: 560, FGA: 1200, FG3M: 210, FG3A: 560, FTM: 170, FTA: 210, PLUS_MINUS: 90 };
const older = { GAME_ID: "0022600100", GAME_DATE: "2026-01-02T00:00:00", MATCHUP: "BOS @ NYK", WL: "W", PTS: 115, REB: 44, AST: 26, FG_PCT: 0.48, PLUS_MINUS: 6 };

function nba() {
  return serve([
    ["scoreboard", scoreboard],
    ["summary", summary],
    ["injuries", { injuries: [{ id: "2", injuries: [{ athlete: { displayName: "Kristaps Porzingis", position: { abbreviation: "C" } }, status: "Out", details: { type: "Ankle", returnDate: "2026-11-05" }, shortComment: "Sprain" }] }] }],
    ["leaguestandingsv3", resultSet([{ TeamID: BOS, Conference: "East", PlayoffRank: 2, WINS: 10, LOSSES: 3, WinPCT: 0.769 }])],
    ["teamdashboardbygeneralsplits", resultSet([dash])],
    ["teamgamelogs", resultSet([older])],
  ]);
}

const run = async (name: string, args: Record<string, unknown>, limit?: number) => {
  const [text, summary, ok] = await tools.execute(name, args, new Cache({ persist: false }), limit);
  return { out: JSON.parse(text), summary, ok, text };
};

describe("games", () => {
  beforeEach(() => {
    data.clearRecentFinals();
    nba();
  });

  it("finds tonight's game from just the team", async () => {
    const { out, ok } = await run("get_game_details", { team: "Celtics" });
    expect(ok).toBe(true);
    expect(out.game_id).toBe("espn_401800001");
    expect(out.game).toContain("SCORE: BKN 100 – BOS 110");
    expect(out.game).toContain("FINAL");
    expect(out.top_players.home[0]).toMatchObject({ player: "Jayson Tatum", pts: 31 });
  });

  it("takes ESPN ids with or without the prefix", async () => {
    for (const game_id of ["401800001", "espn_401800001"]) {
      const { out, ok } = await run("get_game_details", { game_id });
      expect(ok).toBe(true);
      expect(out.game).toContain("SCORE: BKN 100 – BOS 110");
    }
  });

  it("says what to pass instead of a bad id", async () => {
    const { out, ok } = await run("get_game_details", { game_id: "tonight" });
    expect(ok).toBe(false);
    expect(out.error).toContain("team='Celtics'");
  });

  it("gives scoreboard ids that get_game_details accepts", async () => {
    const [text] = await tools.execute("get_scoreboard", {}, new Cache({ persist: false }));
    expect(text).toContain("every NBA game that day (1); there were no others");
    expect(text).toContain("FINAL: BKN 100 @ BOS 110 · game_id espn_401800001");
    expect((await run("get_game_details", { game_id: "espn_401800001" })).ok).toBe(true);
  });

  it("lists tonight's final first in the game log", async () => {
    const { out } = await run("get_team_games", { team: "BOS" });
    expect(out[0]).toMatchObject({ game_id: "espn_401800001", pending: true, iso, opp_pts: 100 });
    expect(out[1].game_id).toBe("0022600100");
  });
});

describe("news and injuries", () => {
  beforeEach(() => nba());

  it("reads one team's injuries", async () => {
    const { out, summary } = await run("get_injuries", { team: "Boston" });
    expect(summary).toBe("Read Celtics injuries");
    expect(out.injuries[0]).toMatchObject({ player: "Kristaps Porzingis", status: "Out", injury: "Ankle", return_date: "2026-11-05" });
  });

  it("keeps web searches on the NBA", async () => {
    const calls = serve([["duckduckgo", "<html></html>"], ["bing", "<rss></rss>"]]);
    const cache = new Cache({ persist: false });
    await tools.execute("web_search", { query: "Tatum contract" }, cache);
    await tools.execute("web_search", { query: "nba trade deadline" }, cache);
    expect(decodeURIComponent(calls[0]).replaceAll("+", " ")).toContain("NBA Tatum contract");
    expect(calls.some((u) => /q=NBA(\+|%20)nba/i.test(u))).toBe(false);
  });
});

describe("result size", () => {
  it("shortens lists to fit and stays valid JSON", () => {
    const big = { team: "BOS", games: Array.from({ length: 80 }, (_, i) => ({ game: i, note: "x".repeat(80) })) };
    const text = tools.fitResult(big, 4000);
    expect(text.length).toBeLessThanOrEqual(4000);
    const out = JSON.parse(text);
    expect(out.team).toBe("BOS");
    expect(out.games[0].game).toBe(0);
    expect(out.games.length).toBeGreaterThan(10);
  });
});

describe("parallel tool calls", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("runs a turn's calls together and reports them in order", async () => {
    const oa = (chunks: unknown[]) =>
      new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    const delta = (d: unknown) => ({ choices: [{ index: 0, delta: d }] });
    let turn = 0;
    vi.stubGlobal("fetch", vi.fn(async () =>
      turn++ === 0
        ? oa([delta({ tool_calls: [
            { index: 0, id: "a", function: { name: "get_standings", arguments: "{}" } },
            { index: 1, id: "b", function: { name: "get_news", arguments: "{}" } },
          ] })])
        : oa([delta({ content: "done" })]),
    ));
    await settings.update("ai", { custom_base_url: "http://mock.local/v1" });
    let running = 0;
    let peak = 0;
    const runTool = async (name: string): Promise<[string, string, boolean]> => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, name === "get_standings" ? 30 : 5));
      running--;
      return [name, name, true];
    };
    const events: any[] = [];
    for await (const e of openaiAdapter.stream("custom", "m", "sys", [{ role: "user", content: "hi" }], tools.SPECS, runTool)) events.push(e);
    expect(peak).toBe(2);
    expect(events.filter((e) => e.type === "tool_result").map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("scope", () => {
  beforeEach(() => nba());

  it("puts the NBA-only rule and today's games in the system prompt", async () => {
    const sys = await router.buildSystem({ mode: "chat" }, new Cache({ persist: false }), true);
    expect(sys).toContain("SCOPE: you only answer questions about the NBA");
    expect(sys).toContain(router.OFF_TOPIC_REPLY);
    expect(sys).toContain("BKN 100 @ BOS 110 · Final · game_id espn_401800001");
  });

  it("reminds the model on its copy of the latest message only", async () => {
    const sent: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "ok" } }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    }));
    await settings.update("ai", { custom_base_url: "http://mock.local/v1", provider: "custom", model: "m", fallbacks: [], no_tools: ["custom:m"] });
    const messages = [{ role: "user", content: "write me a poem" }];
    for await (const _ of router.chatEvents({ messages, mode: "chat" }, new Cache({ persist: false }))) void _;
    vi.unstubAllGlobals();
    const last = sent[0].messages.at(-1).content;
    expect(last.startsWith("write me a poem")).toBe(true);
    expect(last).toContain("answer only if this is about the NBA");
    expect(messages[0].content).toBe("write me a poem");
  });
});

describe("announcer", () => {
  it("reads line by line, faster and higher on the big plays", async () => {
    const { lines } = await import("../web/src/lib/announcer");
    const out = lines("**Celtics** lead it 110-100. Tatum from downtown! What a finish.");
    expect(out.map((l) => l.text)).toEqual(["Celtics lead it 110 to 100.", "Tatum from downtown!", "What a finish."]);
    expect(out[1]).toMatchObject({ big: true });
    expect(out[1].rate).toBeGreaterThan(out[2].rate);
    expect(out[1].pitch).toBeGreaterThan(out[2].pitch);
    expect(out[0].rate).toBeLessThan(out[2].rate);
  });

  it("prefers natural voices, then announcer-ish ones", async () => {
    const { pickVoice } = await import("../web/src/lib/announcer");
    const v = (name: string, lang = "en-US") => ({ name, lang }) as SpeechSynthesisVoice;
    expect(pickVoice([v("Samantha"), v("Microsoft Guy Online (Natural) - English (United States)"), v("Thomas", "fr-FR")])?.name).toContain("Guy");
    expect(pickVoice([v("Samantha"), v("Daniel")])?.name).toBe("Daniel");
    expect(pickVoice([v("Amélie", "fr-CA"), v("Karen", "en-AU")])?.name).toBe("Karen");
  });
});

describe("guessed game ids", () => {
  beforeEach(() => {
    data.clearRecentFinals();
    nba();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("refuses an id the model never saw, and defaults to the team being viewed", async () => {
    const replies = [
      { tool_calls: [{ index: 0, id: "a", function: { name: "get_game_details", arguments: '{"game_id":"0022600120"}' } }] },
      { tool_calls: [{ index: 0, id: "b", function: { name: "get_game_details", arguments: "{}" } }] },
      { content: "Celtics won." },
    ];
    const sent: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      const d = replies[sent.length - 1];
      return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: d }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    }));
    await settings.update("ai", { custom_base_url: "http://mock.local/v1", provider: "custom", model: "m", fallbacks: [], no_tools: [] });
    const events: any[] = [];
    for await (const e of router.chatEvents({ messages: [{ role: "user", content: "how was the game tonight?" }], mode: "chat", team_id: BOS }, new Cache({ persist: false }))) events.push(e);
    const results = events.filter((e) => e.event === "tool_result").map((e) => e.data);
    expect(results[0]).toMatchObject({ ok: false, summary: "Skipped a guessed game id" });
    expect(sent[1].messages.at(-1).content).toContain('team=\\"Boston Celtics\\"');
    expect(results[1]).toMatchObject({ ok: true, summary: "Pulled game story" });
    expect(sent[2].messages.at(-1).content).toContain("espn_401800001");
    // the slate marks the viewed team's game
    expect(sent[0].messages[0].content).toContain("game_id espn_401800001 ← the user's team");
  });
});

// ── previews and the screens' data ───────────────────────────────────────────

const NYK = 1610612752;
const MIA = 1610612748;
const BKN = 1610612751;
const season = (await import("../web/src/backend/config")).currentSeason();
const lastSeason = `${parseInt(season, 10) - 1}-${season.slice(2, 4)}`;

const pre = (id: string, home: [string, string, string], away: [string, string, string], odds?: object) => ({
  id,
  date: new Date(Date.now() + 6 * 3600_000).toISOString(),
  season: { type: 2 },
  status: { period: 0, displayClock: "0.0", type: { state: "pre", shortDetail: "7:30 PM ET" } },
  competitions: [{
    competitors: [
      { homeAway: "home", score: "0", team: { id: home[0], abbreviation: home[1] }, records: [{ summary: home[2] }] },
      { homeAway: "away", score: "0", team: { id: away[0], abbreviation: away[1] }, records: [{ summary: away[2] }] },
    ],
    ...(odds ? { odds: [odds] } : {}),
  }],
});
const advRow = (TEAM_ID: number, GP: number, NET_RATING: number, DEF_RATING = 110) => ({ TEAM_ID, TEAM_NAME: "", GP, NET_RATING, DEF_RATING });
const glRow = (gid: string, tid: number, abbr: string, matchup: string, wl: string, pts: number) =>
  ({ GAME_ID: gid, GAME_DATE: "2026-10-22", TEAM_ID: tid, TEAM_ABBREVIATION: abbr, MATCHUP: matchup, WL: wl, PTS: pts, MIN: 240 });

function slate() {
  return serve([
    ["scoreboard", { day: { date: iso }, events: [
      pre("401900001", ["2", "BOS", "11-3"], ["17", "BKN", "5-9"], { details: "BOS -9.5", overUnder: 221.5 }),
      pre("401900002", ["14", "MIA", "7-7"], ["18", "NY", "8-6"]),
      espnFinal,
    ] }],
    ["injuries", { injuries: [{ id: "2", injuries: [
      { athlete: { displayName: "Kristaps Porzingis" }, status: "Out", details: { type: "Ankle" } },
      { athlete: { displayName: "Jrue Holiday" }, status: "Day-To-Day", details: { type: "Hamstring" } },
    ] }] }],
    ["leaguestandingsv3", resultSet([
      { TeamID: BOS, Conference: "East", PlayoffRank: 2, WINS: 11, LOSSES: 3, L10: "8-2" },
      { TeamID: BKN, Conference: "East", PlayoffRank: 13, WINS: 5, LOSSES: 9, L10: "3-7" },
    ])],
    [`Season=${lastSeason}`, resultSet([advRow(BOS, 82, 9.0), advRow(BKN, 82, -8.0), advRow(NYK, 82, 4.0), advRow(MIA, 82, 1.0)])],
    ["leaguedashteamstats", resultSet([advRow(BOS, 14, 7.4, 106), advRow(BKN, 14, -6.1, 118), advRow(NYK, 14, 2.0, 111), advRow(MIA, 14, 0.5, 109)])],
    ["leaguegamelog", resultSet([glRow("0022600050", BOS, "BOS", "BOS @ BKN", "W", 120), glRow("0022600050", BKN, "BKN", "BKN vs. BOS", "L", 101)])],
  ]);
}

describe("game previews", () => {
  beforeEach(() => data.clearRecentFinals());

  it("does the estimate math", () => {
    const even = tools.estimate(0, 0);
    expect(even.margin).toBe(2);
    expect(even.homeWin).toBeCloseTo(0.566, 2);
    // early season: this year's 14 games lean on last season's rating
    expect(tools.blendedNet(7.4, 14, 9.0)).toBeCloseTo((14 * 7.4 + 6 * 9.0) / 24, 6);
    expect(tools.blendedNet(null, 0, 9.0)).toBeCloseTo(5.4, 6);
    expect(tools.blendedNet(null, 0, null)).toBeNull();
  });

  it("previews every game in one call", async () => {
    slate();
    const [text, summary, ok] = await tools.execute("get_game_previews", {}, new Cache({ persist: false }), 4000);
    expect(ok).toBe(true);
    expect(summary).toBe("Previewed 3 games");
    const [bos, mia, fin] = text.split("\n").filter((l) => l.startsWith("- "));
    // records, seeds, form, net, injuries
    expect(bos).toContain("BKN Nets 5-9 (E#13, L10 3-7, net -6.1)");
    expect(bos).toContain("BOS Celtics 11-3 (E#2, L10 8-2, net +7.4, out: Porzingis, Holiday (q))");
    // the line, then the app's estimate (blended nets 6.57 vs -5.56, +2 home)
    expect(bos).toContain("line BOS -9.5, O/U 221.5");
    expect(bos).toContain("estimate BOS by 14, 88%");
    expect(bos).toContain("season series BOS 1-0");
    expect(bos).toContain("game_id espn_401900001");
    // no line posted: still an estimate
    expect(mia).not.toContain("line ");
    expect(mia).toMatch(/estimate (MIA|NY) by \d+, \d+%/);
    expect(mia).toContain("first meeting this season");
    // finished games show the score instead
    expect(fin).toContain("FINAL: BKN 100 @ BOS 110");
    expect(fin).not.toContain("estimate");
    expect(text).toContain("an estimate, not a certainty");
  });

  it("filters to one team", async () => {
    slate();
    const [text, summary] = await tools.execute("get_game_previews", { team: "Heat" }, new Cache({ persist: false }));
    expect(summary).toBe("Previewed 1 game");
    expect(text).toContain("MIA Heat");
    expect(text).not.toContain("BOS Celtics");
  });

  it("puts the slate in the snapshot for models without tools", async () => {
    slate();
    const sys = await router.buildSystem({ mode: "chat" }, new Cache({ persist: false }), false);
    expect(sys).toContain("estimate BOS by 14");
    expect(sys).toContain("BKN (5-9) @ BOS (11-3)");
  });
});

describe("the screens' data", () => {
  it("ranks one team in a category (League › Team rankings)", async () => {
    slate();
    const { out } = await run("get_league_leaders", { category: "def rating", team: "Nets", top: 2 });
    expect(out.ranking.map((r: any) => r.value)).toEqual([106, 109]);
    expect(out.team_rank).toMatchObject({ rank: 4, of: 4, value: 118 });
  });

  it("asks for the rookie class (League › Rookies)", async () => {
    const calls = serve([["leaguedashplayerstats", resultSet([{ PLAYER_ID: 9, PLAYER_NAME: "Zed Rookieman", TEAM_ID: BOS, TEAM_ABBREVIATION: "BOS", GP: 10, PTS: 15 }])]]);
    const { out, summary } = await run("get_player_leaders", { category: "points", rookies: true, season: "2017-18" });
    expect(calls[0]).toContain("PlayerExperience=Rookie");
    expect(summary).toBe("Ranked rookies by Points");
    expect(out.group).toBe("rookies only");
    expect(out.ranking[0].player).toBe("Zed Rookieman");
  });

  it("finds players the bundled list doesn't know", async () => {
    serve([
      ["leaguedashplayerstats", resultSet([{ PLAYER_ID: 1650001, PLAYER_NAME: "Zed Rookieman", TEAM_ID: BOS, TEAM_ABBREVIATION: "BOS", GP: 3, PTS: 9 }])],
      ["playergamelog", resultSet([], ["GAME_ID", "GAME_DATE", "MATCHUP"])],
    ]);
    const { out, ok } = await run("get_player", { name: "zed rookieman" });
    expect(ok).toBe(true);
    expect(out.player).toBe("Zed Rookieman");
  });

  it("goes back season by season (Trends)", async () => {
    const row = (YEAR: string, WINS: number, CONF_RANK: number, PO_WINS: number, PO_LOSSES: number, NBA_FINALS_APPEARANCE: string) =>
      ({ YEAR, WINS, LOSSES: 82 - WINS, WIN_PCT: WINS / 82, PTS: 115, REB: 44, AST: 26, FG_PCT: 0.47, FG3_PCT: 0.37, FT_PCT: 0.8, CONF_RANK, PO_WINS, PO_LOSSES, NBA_FINALS_APPEARANCE });
    serve([["teamyearbyyearstats", resultSet([row("2022-23", 57, 2, 11, 9, "N/A"), row("2023-24", 64, 1, 16, 3, "LEAGUE CHAMPION"), row("2024-25", 61, 2, 5, 6, "N/A")])]]);
    const { out } = await run("get_team_history", { team: "BOS", seasons: 2 });
    expect(out.seasons.map((s: any) => s.season)).toEqual(["2024-25", "2023-24"]);
    expect(out.seasons[1]).toMatchObject({ wins: 64, conf_rank: 1, playoffs: "16-3", finals: "champion" });
  });

  it("searches a season's results (Scores)", async () => {
    serve([["leaguegamelog", resultSet([
      glRow("0021700001", BOS, "BOS", "BOS vs. NYK", "W", 130), glRow("0021700001", NYK, "NYK", "NYK @ BOS", "L", 90),
      glRow("0021700002", BOS, "BOS", "BOS @ MIA", "L", 120), glRow("0021700002", MIA, "MIA", "MIA vs. BOS", "W", 125),
      glRow("0021700003", NYK, "NYK", "NYK vs. MIA", "W", 101), glRow("0021700003", MIA, "MIA", "MIA @ NYK", "L", 99),
    ])]]);
    let { out } = await run("get_season_games", { season: "2017-18", sort: "margin" });
    expect(out.matching_games).toBe(3);
    expect(out.games[0]).toContain("NYK 90 @ BOS 130 (BOS by 40)");
    ({ out } = await run("get_season_games", { season: "2017-18", sort: "total" }));
    expect(out.games[0]).toContain("BOS 120 @ MIA 125");
    ({ out } = await run("get_season_games", { season: "2017-18", team: "Celtics", opponent: "Knicks" }));
    expect(out.games).toHaveLength(1);
    expect(out.record).toBe("BOS 1-0 vs NYK in these games");
  });

  it("routes questions in the prompt and doesn't pin the slate to the viewed team", async () => {
    slate();
    const sys = await router.buildSystem({ mode: "chat", team_id: BOS }, new Cache({ persist: false }), true);
    expect(sys).toContain("tonight's / a date's games, matchups, previews, predictions, who's favored → get_game_previews");
    expect(sys).toContain("rookies=true");
    expect(sys).toContain("Questions about tonight's games, the league, other teams or players are not limited to the Boston Celtics");
    expect(sys).not.toContain("Assume questions are about this team");
  });
});
