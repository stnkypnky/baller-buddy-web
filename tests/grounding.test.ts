/** Grounding (facts fetched before the model answers), the fact-check, and
 *  data carried across a chat. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache } from "../web/src/backend/cache";
import { checkAnswer, correctionSheet } from "../web/src/backend/llm/factcheck";
import { findDates, findSeasons, findTeams, ground, PlayerIndex, shiftDay } from "../web/src/backend/llm/grounding";
import * as router from "../web/src/backend/llm/router";
import type { LeaguePlayerRow } from "../web/src/backend/nba/data";
import * as settings from "../web/src/backend/settings";
import { resultSet, serve } from "./fake";

const BOS = 1610612738;
const WAS = 1610612764;
const LAC = 1610612746;
const BKN = 1610612751;

const row = (pid: number, name: string, team_id: number, team_abbr: string, PTS: number): LeaguePlayerRow =>
  ({ pid, name, team_id, team_abbr, gp: 5, PTS, REB: 5, AST: 4, MIN: 32, FG_PCT: 0.47, FG3_PCT: 0.37 }) as LeaguePlayerRow;
const LEAGUE = [
  row(202331, "Paul George", BOS, "BOS", 18.4),
  row(1628369, "Jayson Tatum", BOS, "BOS", 27.1),
  row(1628401, "Derrick White", BOS, "BOS", 15.2),
  row(203935, "Marcus Smart", WAS, "WAS", 9.3),
  row(201935, "James Harden", LAC, "LAC", 21.0),
  row(1629008, "Michael Porter Jr.", BKN, "BKN", 24.5),
  row(1628973, "Jalen Brunson", 1610612752, "NYK", 26.0),
];
const idx = new PlayerIndex(LEAGUE, [[1, "Larry Bird", 0], [2, "Some Rookie", 1]]);

describe("finding what a question is about", () => {
  it("finds teams by name, nickname, short form and capital tricode", () => {
    expect(findTeams("thoughts on the Celts vs the Sixers?").map((t) => t.abbreviation)).toEqual(["BOS", "PHI"]);
    expect(findTeams("how did BOS look").map((t) => t.abbreviation)).toEqual(["BOS"]);
    expect(findTeams("bos and min are words here")).toEqual([]);
    expect(findTeams("anyone in Los Angeles")).toEqual([]);
    expect(findTeams("Golden State at Oklahoma City").map((t) => t.abbreviation)).toEqual(["GSW", "OKC"]);
  });

  it("finds players by full name, nickname and unique last name", () => {
    expect(idx.find("thoughts on Paul George as a Celtic").map((p) => p.name)).toEqual(["Paul George"]);
    expect(idx.find("is PG better than JT?").map((p) => p.name)).toEqual(["Paul George", "Jayson Tatum"]);
    expect(idx.find("how's george doing").map((p) => p.name)).toEqual(["Paul George"]);
    expect(idx.find("michael porter jr went off").map((p) => p.name)).toEqual(["Michael Porter Jr."]);
    // everyday words count only when capitalized
    expect(idx.find("that was a smart play")).toEqual([]);
    expect(idx.find("is Smart still in Boston?").map((p) => p.name)).toEqual(["Marcus Smart"]);
    // legends are found by full name or nickname, marked retired
    expect(idx.find("prime Larry Bird vs prime LeBron").map((p) => [p.name, !!p.retired])).toEqual([["Larry Bird", true]]);
    expect(idx.find("Larry Legend").map((p) => p.name)).toEqual(["Larry Bird"]);
  });

  it("finds dates on the NBA calendar, not shooting lines", () => {
    const today = "20261028"; // a Wednesday
    expect(findDates("what games should i watch from yesterday", today)).toEqual(["20261027"]);
    expect(findDates("how was the game last night", today)).toEqual(["20261027"]);
    expect(findDates("Monday's games", today)).toEqual(["20261026"]);
    expect(findDates("games on 10/26", today)).toEqual(["20261026"]);
    expect(findDates("Oct 26th", today)).toEqual(["20261026"]);
    expect(findDates("he went 7/15 from three", today)).toEqual([]);
    expect(findDates("who plays tonight", today)).toEqual([today]);
    expect(findDates("next friday", today)).toEqual(["20261030"]);
    expect(shiftDay("20261101", -1)).toBe("20261031");
  });
});

// ── data fixtures for cards and the chat ─────────────────────────────────────

const statsRows = (u: string) => {
  const team = new URL(u).searchParams.get("TeamID");
  const rows = LEAGUE.filter((r) => !team || String(r.team_id) === team);
  return resultSet(
    rows.map((r) => ({ PLAYER_ID: r.pid, PLAYER_NAME: r.name, TEAM_ID: r.team_id, TEAM_ABBREVIATION: r.team_abbr, GP: r.gp, PTS: r.PTS, REB: 5, AST: 4, MIN: 32, FG_PCT: 0.47, FG3_PCT: 0.37 })),
  );
};
const roster = (u: string) => {
  const team = Number(new URL(u).searchParams.get("TeamID"));
  return resultSet(LEAGUE.filter((r) => r.team_id === team).map((r) => ({ PLAYER_ID: r.pid, PLAYER: r.name, POSITION: "F", HOW_ACQUIRED: "" })));
};
function nba() {
  return serve([
    ["leaguedashplayerstats", statsRows],
    ["commonteamroster", roster],
    ["leaguestandingsv3", resultSet([{ TeamID: BOS, Conference: "East", PlayoffRank: 2, WINS: 3, LOSSES: 1, L10: "3-1", strCurrentStreak: "W 2" }])],
    ["injuries", { injuries: [{ id: "2", injuries: [{ athlete: { displayName: "Jayson Tatum" }, status: "Out", details: { type: "Achilles" } }] }] }],
    ["scoreboard", { events: [] }],
  ]);
}

describe("fact cards", () => {
  beforeEach(() => nba());

  it("puts the followed team's current roster and the named players in front of the model", async () => {
    const g = await ground("thoughts on Paul George as a Celtic", { followed: BOS, cache: new Cache({ persist: false }), budget: 7000, index: idx });
    expect(g.cards.map((c) => c.label)).toEqual(["Paul George", "Celtics"]);
    expect(g.block).toContain("Paul George — plays for Boston Celtics (BOS)");
    expect(g.block).toContain("ROSTER (complete current roster; anyone not listed is NOT on this team)");
    expect(g.block).toContain("Jayson Tatum F 27.1 ppg (out)");
    expect(g.block).not.toContain("Marcus Smart");
  });

  it("keeps whole cards within the budget, and always the followed team's", async () => {
    const g = await ground("Harden vs Brunson vs Porter Jr.", { followed: BOS, cache: new Cache({ persist: false }), budget: 600, index: idx });
    expect(g.cards.at(-1)!.label).toBe("Celtics");
    expect(g.cards.length).toBeLessThan(4);
  });

  it("follows up on the previous question's subject", async () => {
    const g = await ground("and what about his defense?", { followed: null, cache: new Cache({ persist: false }), budget: 7000, previous: "how is Michael Porter Jr. playing", index: idx });
    expect(g.cards.map((c) => c.label)).toEqual(["Michael Porter Jr."]);
  });
});

describe("fact-check", () => {
  const data = "Paul George — plays for Boston Celtics (BOS)\nJayson Tatum F 27.1 ppg\nMichael Porter Jr. 31 pts\nJames Harden — plays for Los Angeles Clippers";

  it("passes an answer whose players are all in the data", () => {
    const r = checkAnswer("George gives the Celtics a second star next to Jayson Tatum.", data, idx);
    expect(r.named.map((p) => p.name)).toEqual(["Paul George", "Jayson Tatum"]);
    expect(r.problems).toEqual([]);
  });

  it("flags a player who isn't in the data", () => {
    const r = checkAnswer("With Marcus Smart, the Celtics' point guard, running things, George gets easy looks.", data, idx);
    expect(r.problems.map((p) => [p.player.name, p.reason])).toEqual([["Marcus Smart", "not in the data this answer was built from"]]);
    const sheet = correctionSheet(r.problems);
    expect(sheet).toContain("Marcus Smart — plays for the Washington Wizards (WAS)");
    expect(sheet).toContain("Rewrite your full answer");
  });

  it("flags a player tied to a team he doesn't play for, not one he played against", () => {
    const r = checkAnswer("James Harden nearly sealed it for the Nets. Porter Jr. dropped 31 against the Celtics.", data, idx);
    expect(r.problems.map((p) => [p.player.name, p.reason])).toEqual([["James Harden", "tied to the Brooklyn Nets in 2026-27"]]);
  });
});

describe("fact-check: past seasons and teammates", () => {
  const SAC = 1610612758;
  const DET = 1610612765;
  const CARTER = 1642269;
  const DUREN = 1631105;
  const FOX = 1628368;
  const people = new PlayerIndex([
    row(CARTER, "Devin Carter", BOS, "BOS", 9.1),
    row(DUREN, "Jalen Duren", DET, "DET", 14.0),
    row(FOX, "De'Aaron Fox", 1610612759, "SAS", 22.0),
    row(1628401, "Derrick White", BOS, "BOS", 15.2),
  ]);
  const stints = new Map([
    [CARTER, { "2024-25": ["SAC"], "2025-26": ["SAC"], "2026-27": ["BOS"] }],
    [DUREN, { "2022-23": ["DET"], "2023-24": ["DET"], "2024-25": ["DET"], "2025-26": ["DET"], "2026-27": ["DET"] }],
    [FOX, { "2023-24": ["SAC"], "2024-25": ["SAC", "SAS"], "2025-26": ["SAS"] }],
  ]);
  const data = "Devin Carter Jalen Duren De'Aaron Fox Derrick White";
  const check = (answer: string, seasons: string[] = []) => checkAnswer(answer, data, people, { seasons, stints });

  it("finds the seasons a question is about", () => {
    expect(findSeasons("was he a starter for the Kings last year", "2026-27")).toEqual(["2025-26"]);
    expect(findSeasons("the 2023-24 Celtics vs the 2022-2023 Nuggets", "2026-27")).toEqual(["2023-24", "2022-23"]);
    expect(findSeasons("who won in the 2025 playoffs", "2026-27")).toEqual(["2024-25"]);
    expect(findSeasons("two seasons ago", "2026-27")).toEqual(["2024-25"]);
    expect(findSeasons("the 2024 draft", "2026-27")).toEqual([]);
    expect(findSeasons("how are they doing this season", "2026-27")).toEqual([]);
  });

  it("catches a teammate he never had (the Carter-Duren slip)", () => {
    const r = check("Last season Devin Carter came off the bench for the Kings, playing alongside Jalen Duren.", ["2025-26"]);
    expect(r.problems.map((p) => p.player.name)).toEqual(["Jalen Duren"]);
    expect(r.problems[0].reason).toContain("Kings teammate");
    expect(correctionSheet(r.problems)).toContain("His teams by season: 2022-23 DET");
    // no team named: the two still never shared one
    expect(check("Carter played with Jalen Duren.", ["2025-26"]).problems.map((p) => p.player.name)).toEqual(["Jalen Duren"]);
  });

  it("accepts a past team and a real past teammate", () => {
    expect(check("Devin Carter started 20 games for the Kings in 2025-26.").problems).toEqual([]);
    expect(check("Devin Carter was a Kings guard in 2024-25, playing alongside De'Aaron Fox.").problems).toEqual([]);
    expect(check("Carter came off the bench for the Kings next to Fox.", ["2024-25"]).problems).toEqual([]);
    // Fox was traded to San Antonio in 2024-25, so "last year" (2025-26) he wasn't a King
    expect(check("Devin Carter was a Kings guard last year, playing alongside De'Aaron Fox.").problems.map((p) => p.player.name)).toEqual(["De'Aaron Fox"]);
  });

  it("still holds this season to this season's team", () => {
    const r = check("Devin Carter is currently the Kings' backup point guard.", ["2025-26"]);
    expect(r.problems.map((p) => [p.player.name, p.reason])).toEqual([["Devin Carter", "tied to the Sacramento Kings in 2026-27"]]);
    expect(check("Carter now plays alongside Derrick White.").problems).toEqual([]);
  });

  it("grounds a question about last season in that season's data", async () => {
    const COLS = ["SEASON_ID", "TEAM_ABBREVIATION", "PLAYER_AGE", "GP", "GS", "MIN", "PTS", "REB", "AST"];
    const career = { resultSets: [{ name: "SeasonTotalsRegularSeason", headers: COLS, rowSet: [["2024-25", "SAC", 22, 36, 2, 13.1, 4.0, 2.1, 1.1], ["2025-26", "SAC", 23, 70, 31, 24.5, 9.8, 3.4, 3.2]] }] };
    const calls = serve([
      ["playercareerstats", career],
      ["playerawards", { resultSets: [] }],
      ["commonplayerinfo", resultSet([{ DISPLAY_FIRST_LAST: "Devin Carter" }])],
      ["leaguedashplayerstats", (u: string) => {
        const team = new URL(u).searchParams.get("TeamID");
        const s = new URL(u).searchParams.get("Season");
        const rows = s === "2025-26" && team === String(SAC)
          ? [{ PLAYER_ID: CARTER, PLAYER_NAME: "Devin Carter", TEAM_ID: SAC, TEAM_ABBREVIATION: "SAC", GP: 70, MIN: 24.5, PTS: 9.8 }, { PLAYER_ID: 5, PLAYER_NAME: "Keegan Murray", TEAM_ID: SAC, TEAM_ABBREVIATION: "SAC", GP: 74, MIN: 33, PTS: 15.5 }]
          : [];
        return resultSet(rows, ["PLAYER_ID", "PLAYER_NAME", "TEAM_ID", "TEAM_ABBREVIATION", "GP", "MIN", "PTS"]);
      }],
      ["commonteamroster", resultSet([], ["PLAYER_ID", "PLAYER", "POSITION", "HOW_ACQUIRED"])],
      ["leaguestandingsv3", resultSet([{ TeamID: SAC, Conference: "West", PlayoffRank: 11, WINS: 38, LOSSES: 44 }])],
      ["injuries", { injuries: [] }],
      ["scoreboard", { events: [] }],
    ]);
    const g = await ground("was Devin Carter a starter for the Kings last year?", { followed: null, cache: new Cache({ persist: false }), budget: 7000, index: people });
    expect(g.cards.map((c) => c.label).slice(0, 2)).toEqual(["Devin Carter 2025-26", "Kings 2025-26"]);
    expect(g.block).toContain("PLAYER Devin Carter in 2025-26 — regular season 2025-26 SAC age 23: 70 GP (31 started)");
    expect(g.block).toContain("ROSTER 2025-26 (everyone who played for the Kings that season");
    expect(g.block).toContain("Keegan Murray 74 GP 33.0 min 15.5 ppg");
    expect(calls.some((u) => u.includes("Season=2025-26"))).toBe(true);
  });
});

// ── the whole chat turn ──────────────────────────────────────────────────────

describe("a chat turn", () => {
  const sent: any[] = [];
  let replies: string[] = [];
  beforeEach(async () => {
    nba();
    sent.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)));
        const text = replies[sent.length - 1] ?? "ok";
        return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
      }),
    );
    await settings.update("ai", { custom_base_url: "http://mock.local/v1", provider: "custom", model: "m", fallbacks: [], no_tools: [], factcheck: true });
  });
  afterEach(() => vi.unstubAllGlobals());

  const turn = async (req: router.ChatRequest) => {
    const events: any[] = [];
    for await (const e of router.chatEvents({ mode: "chat", team_id: BOS, ...req }, new Cache({ persist: false }))) events.push(e);
    return events;
  };

  it("grounds the question, then fixes a player put on the wrong team", async () => {
    replies = ["Marcus Smart, the Celtics' point guard, makes George's life easy.", "Derrick White runs the point, which makes George's life easy."];
    const events = await turn({ messages: [{ role: "user", content: "thoughts on Paul George as a Celtic" }] });
    // the model's first request carried the facts
    const first = sent[0].messages.at(-1).content as string;
    expect(first).toContain("DATA FOR THIS QUESTION");
    expect(first).toContain("Paul George — plays for Boston Celtics");
    expect(events.find((e) => e.event === "grounding").data.labels).toEqual(["Paul George", "Celtics"]);
    // one revision with the correction sheet, streamed in place of the draft
    expect(sent).toHaveLength(2);
    expect(sent[1].messages.at(-1).content).toContain("Marcus Smart — plays for the Washington Wizards");
    expect(sent[1].tools).toBeUndefined();
    const kinds = events.map((e) => e.event);
    expect(kinds.indexOf("revision")).toBeGreaterThan(kinds.indexOf("token"));
    expect(events.find((e) => e.event === "factcheck").data).toMatchObject({ fixed: 1, names: ["Marcus Smart"] });
    expect(events.find((e) => e.event === "digest").data.text).toContain("Paul George — plays for Boston Celtics");
  });

  it("makes no second call when the answer checks out", async () => {
    replies = ["George and Tatum make a strong pair."];
    const events = await turn({ messages: [{ role: "user", content: "thoughts on Paul George as a Celtic" }] });
    expect(sent).toHaveLength(1);
    expect(events.find((e) => e.event === "factcheck").data).toMatchObject({ checked: 2, fixed: 0 });
  });

  it("can be turned off", async () => {
    await settings.update("ai", { factcheck: false });
    replies = ["Marcus Smart, the Celtics' point guard."];
    const events = await turn({ messages: [{ role: "user", content: "Paul George?" }] });
    expect(sent).toHaveLength(1);
    expect(events.some((e) => e.event === "factcheck")).toBe(false);
  });

  it("carries earlier data into follow-ups, but not into a recheck", async () => {
    const messages = [
      { role: "user", content: "how is the bench" },
      { role: "assistant", content: "Fine." },
      { role: "user", content: "and the starters?" },
    ];
    await turn({ messages, data_digests: ["TEAM Boston Celtics 2026-27 · earlier facts"] });
    expect(sent[0].messages.at(-1).content).toContain("DATA FROM EARLIER IN THIS CHAT");
    sent.length = 0;
    await turn({ messages: [...messages.slice(0, 2), { role: "user", content: "recheck the roster" }], data_digests: ["TEAM Boston Celtics 2026-27 · earlier facts"] });
    expect(sent[0].messages.at(-1).content).not.toContain("DATA FROM EARLIER IN THIS CHAT");
    expect(sent[0].messages.at(-1).content).toContain("ROSTER (complete current roster");
  });

  it("states yesterday's date for the model", async () => {
    const sys = await router.buildSystem({ mode: "chat" }, new Cache({ persist: false }), true);
    expect(sys).toMatch(/yesterday \w+day \d{4}-\d{2}-\d{2}/);
    expect(sys).toContain("Your training knowledge of rosters, trades, injuries and results is out of date");
  });
});

describe("fact-check: scores and stats", () => {
  const data = [
    "GAMES ON 2026-10-27:",
    "- FINAL: BKN 110 @ DEN 112 (close) · BKN: Michael Porter Jr. 31 pts, Nic Claxton 12 reb",
    "TEAM Boston Celtics 2026-27 · record 3-1 · East #2",
    "ROSTER: Jayson Tatum F 27.1 ppg, Paul George F 18.4 ppg",
    "PLAYER Paul George — plays for Boston Celtics (BOS) in 2026-27 · 5 GP · 18.4 pts, 5.0 reb, 4.0 ast, 32.0 min, FG 47.0%, 3P 37.0%",
    '[get_game_details] {"home":{"abbr":"BOS","score":125},"away":{"abbr":"LAL","score":124},"fg_pct":0.471}',
  ].join("\n");
  const check = (answer: string) => checkAnswer(answer, data, idx);

  it("passes numbers the data backs, at the answer's own precision", () => {
    const r = check(
      "Denver edged Brooklyn 112-110 as Porter Jr. scored 31 points. The Celtics are 3-1, George is averaging 18 points on 47% shooting, " +
        "and Boston beat the Lakers 125-124 shooting 47.1%.",
    );
    expect(r.claims).toEqual([]);
    expect(r.problems).toEqual([]);
    expect(r.numbers).toBeGreaterThanOrEqual(6);
  });

  it("flags a score no game in the data has, with the real line as a hint", () => {
    const r = check("Denver won 118-110 over the Nets.");
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0]).toMatchObject({ kind: "score", text: "118-110" });
    expect(r.claims[0].hint).toContain("BKN 110 @ DEN 112");
  });

  it("checks a stat against the right player, not any number in the data", () => {
    // 27 is in the data, but it's Tatum's, not George's
    const r = check("Paul George is averaging 27 points a night.");
    expect(r.claims.map((c) => c.text)).toEqual(["Paul George: 27 points"]);
    expect(r.claims[0].hint).toContain("18.4 pts");
    expect(check("Porter Jr. scored 38 points.").claims.map((c) => c.text)).toEqual(["Michael Porter Jr.: 38 points"]);
  });

  it("flags made-up ratings, percentages and records, not seasons, dates or times", () => {
    expect(check("Boston's net rating is +9.2 and they're 4-0.").claims.map((c) => [c.kind, c.text])).toEqual([
      ["pair", "4-0"],
      ["number", "+9.2"],
    ]);
    expect(check("In 2026-27, on 10/27 at 7:30, they tipped off.").claims).toEqual([]);
  });

  it("lists number problems on the correction sheet", () => {
    const r = check("Denver won 118-110.");
    expect(correctionSheet(r.problems, r.claims)).toContain('"118-110" (score) isn\'t in the data. The data says:');
  });
});

describe("fact-check beyond the chat", () => {
  const sent: any[] = [];
  let replies: string[] = [];
  beforeEach(async () => {
    nba();
    sent.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)));
        return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: replies[sent.length - 1] ?? "ok" } }] })}\n\ndata: [DONE]\n\n`, {
          headers: { "content-type": "text/event-stream" },
        });
      }),
    );
    await settings.update("ai", { custom_base_url: "http://mock.local/v1", provider: "custom", model: "m", fallbacks: [], no_tools: [], factcheck: true });
  });
  afterEach(() => vi.unstubAllGlobals());

  const run = async (req: router.ChatRequest) => {
    const events: any[] = [];
    for await (const e of router.chatEvents(req, new Cache({ persist: false }))) events.push(e);
    return events;
  };

  it("checks Catch me up against its game data", async () => {
    replies = ["Boston holds on, 118 to 100! Tatum's got 31!", "Boston holds on, 110 to 100!"];
    const events = await run({ mode: "recap", context: "GAME: BKN at BOS\nSCORE: BKN 100 – BOS 110\nLEADERS: BOS points: Jayson Tatum 31" });
    // "118 to 100" isn't checked as a pair (only dashes are), but Tatum's 31 is backed; nothing to fix
    expect(events.find((e) => e.event === "factcheck").data.fixed).toBe(0);
    replies = ["Boston won it 118-100 behind Tatum."];
    sent.length = 0;
    const ev2 = await run({ mode: "recap", context: "GAME: BKN at BOS\nSCORE: BKN 100 – BOS 110\nLEADERS: BOS points: Jayson Tatum 31" });
    expect(sent).toHaveLength(2);
    expect(sent[1].messages.at(-1).content).toContain('"118-100" (score)');
    expect(ev2.find((e) => e.event === "factcheck").data).toMatchObject({ fixed: 1 });
  });

  it("doesn't second-guess a news brief's team moves", async () => {
    replies = ["**Marcus Smart** signs with the Celtics."];
    const events = await run({ mode: "brief", context: "HEADLINES:\n- Celtics sign Marcus Smart to a one-year deal" });
    expect(sent).toHaveLength(1);
    expect(events.find((e) => e.event === "factcheck").data.fixed).toBe(0);
  });
});
