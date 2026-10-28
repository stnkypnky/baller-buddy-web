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
    const { out } = await run("get_scoreboard", {});
    expect(out.games[0]).toMatchObject({ game_id: "espn_401800001", status: "final", home: { abbr: "BOS", score: "110" } });
    expect((await run("get_game_details", { game_id: out.games[0].game_id })).ok).toBe(true);
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
