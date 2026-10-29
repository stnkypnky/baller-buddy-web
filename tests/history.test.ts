/** Basketball history on demand: careers, primes, awards, past seasons'
 *  leaders, Wikipedia background, and how grounding and the fact-check use
 *  them for legends and hypotheticals. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache } from "../web/src/backend/cache";
import { checkAnswer } from "../web/src/backend/llm/factcheck";
import { ground, PlayerIndex } from "../web/src/backend/llm/grounding";
import * as router from "../web/src/backend/llm/router";
import * as tools from "../web/src/backend/llm/tools";
import type { LeaguePlayerRow } from "../web/src/backend/nba/data";
import * as history from "../web/src/backend/nba/history";
import * as settings from "../web/src/backend/settings";
import { resultSet, serve } from "./fake";

const COLS = ["SEASON_ID", "TEAM_ABBREVIATION", "PLAYER_AGE", "GP", "MIN", "FGM", "FGA", "FG_PCT", "FG3M", "FG3A", "FG3_PCT", "FTM", "FTA", "FT_PCT", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TOV", "PF", "PTS"];
const season = (id: string, team: string, age: number, gp: number, pts: number, reb = 10, ast = 6) =>
  [id, team, age, gp, 38, pts * 0.4, pts * 0.8, 0.5, 1, 2.5, 0.4, pts * 0.15, pts * 0.17, 0.89, 2, reb - 2, reb, ast, 1.8, 0.8, 3, 2.5, pts];
const set = (name: string, rows: unknown[][]) => ({ name, headers: COLS, rowSet: rows });

const BIRD = 1449;
const LEBRON = 2544;
const TRADED = 99;

const careers: Record<number, unknown> = {
  [BIRD]: {
    resultSets: [
      set("SeasonTotalsRegularSeason", [
        season("1981-82", "BOS", 25, 77, 19.9),
        season("1982-83", "BOS", 26, 79, 23.6),
        season("1983-84", "BOS", 27, 79, 24.2),
        season("1984-85", "BOS", 28, 80, 28.7),
        season("1985-86", "BOS", 29, 82, 25.8),
        season("1986-87", "BOS", 30, 74, 28.1),
        season("1987-88", "BOS", 31, 76, 29.9),
        season("1988-89", "BOS", 32, 6, 19.3),
      ]),
      set("CareerTotalsRegularSeason", [season("", "", 0, 897, 24.3)]),
      set("SeasonTotalsPostSeason", [season("1985-86", "BOS", 29, 18, 25.9)]),
      set("CareerTotalsPostSeason", [season("", "", 0, 164, 23.8)]),
    ],
  },
  [LEBRON]: {
    resultSets: [
      set("SeasonTotalsRegularSeason", [
        season("2008-09", "CLE", 24, 81, 28.4, 7.6, 7.2),
        season("2009-10", "CLE", 25, 76, 29.7, 7.3, 8.6),
        season("2010-11", "MIA", 26, 79, 26.7, 7.5, 7.0),
        season("2011-12", "MIA", 27, 62, 27.1, 7.9, 6.2),
        season("2012-13", "MIA", 28, 76, 26.8, 8.0, 7.3),
      ]),
      set("CareerTotalsRegularSeason", [season("", "", 0, 1500, 27.0, 7.5, 7.4)]),
      set("SeasonTotalsPostSeason", []),
      set("CareerTotalsPostSeason", []),
    ],
  },
  [TRADED]: {
    resultSets: [
      set("SeasonTotalsRegularSeason", [season("2000-01", "SAC", 24, 30, 10), season("2000-01", "BOS", 24, 40, 14), season("2000-01", "TOT", 24, 70, 12.3)]),
      set("CareerTotalsRegularSeason", [season("", "", 0, 70, 12.3)]),
    ],
  },
};
const awards = (u: string) => {
  const pid = Number(new URL(u).searchParams.get("PlayerID"));
  const rows = pid === BIRD
    ? [
        ["NBA Most Valuable Player", "1983-84", "", "Award"], ["NBA Most Valuable Player", "1984-85", "", "Award"], ["NBA Most Valuable Player", "1985-86", "", "Award"],
        ["NBA Champion", "1980-81", "", "Award"], ["NBA Champion", "1983-84", "", "Award"], ["NBA Champion", "1985-86", "", "Award"],
        ["All-NBA", "1984-85", "1", "Award"], ["NBA Player of the Week", "1985-86", "", "Weekly"],
      ]
    : [];
  return { resultSets: [{ name: "PlayerAwards", headers: ["DESCRIPTION", "SEASON", "ALL_NBA_TEAM_NUMBER", "TYPE"], rowSet: rows }] };
};
const bio = (u: string) => {
  const pid = Number(new URL(u).searchParams.get("PlayerID"));
  const name = pid === BIRD ? "Larry Bird" : pid === LEBRON ? "LeBron James" : "Trade Guy";
  return resultSet([{ DISPLAY_FIRST_LAST: name, HEIGHT: "6-9", POSITION: "Forward", DRAFT_YEAR: "1978", DRAFT_ROUND: "1", DRAFT_NUMBER: "6" }]);
};
const leagueLog = (u: string) => {
  const s = new URL(u).searchParams.get("Season");
  const pts = s === "1985-86" ? 110.2 : 99.0;
  return resultSet([{ WL: "W", PTS: pts + 2, FG_PCT: 0.49, FG3A: s === "1985-86" ? 3.3 : 18 }, { WL: "L", PTS: pts - 2, FG_PCT: 0.47, FG3A: s === "1985-86" ? 3.1 : 18 }]);
};

function nba() {
  return serve([
    ["playercareerstats", (u: string) => careers[Number(new URL(u).searchParams.get("PlayerID"))] ?? { resultSets: [] }],
    ["playerawards", awards],
    ["commonplayerinfo", bio],
    ["leaguegamelog", leagueLog],
    ["leagueleaders", { resultSet: { headers: ["PLAYER_ID", "RANK", "PLAYER", "TEAM", "GP", "PTS"], rowSet: [[2, 1, "Dominique Wilkins", "ATL", 78, 30.3], [BIRD, 4, "Larry Bird", "BOS", 82, 25.8]] } }],
    ["list=search", { query: { search: [{ title: "Larry Bird" }] } }],
    ["prop=extracts", { query: { pages: [{ title: "Larry Bird", extract: "Larry Joe Bird is an American former professional basketball player… three-time NBA champion and three-time MVP." }] } }],
    ["leaguedashplayerstats", resultSet([{ PLAYER_ID: LEBRON, PLAYER_NAME: "LeBron James", TEAM_ID: 1610612747, TEAM_ABBREVIATION: "LAL", GP: 5, PTS: 24.1, REB: 7, AST: 8, MIN: 33, FG_PCT: 0.5, FG3_PCT: 0.36 }])],
    ["injuries", { injuries: [] }],
    ["scoreboard", { events: [] }],
  ]);
}

describe("a career", () => {
  beforeEach(() => nba());

  it("reads every season, playoffs, awards and the best stretch", async () => {
    const c = (await history.fetchCareer(BIRD, "Larry Bird", false, new Cache({ persist: false })))!;
    expect(c.regular).toHaveLength(8);
    expect(c.career?.ppg).toBe(24.3);
    expect(c.awards.MVP).toEqual(["1983-84", "1984-85", "1985-86"]);
    expect(c.awards["All-NBA 1st"]).toEqual(["1984-85"]);
    expect(Object.keys(c.awards)).not.toContain("Player of the Week");
    // his best five straight seasons (40+ games), weighted by games
    expect(c.peak5?.seasons).toBe("1983-84 to 1987-88");
    const text = history.careerSummary(c);
    expect(text).toContain("CAREER Larry Bird (retired) · 1981-82 to 1988-89 · BOS");
    expect(text).toContain("honors: Champion 1980-81, 1983-84, 1985-86; MVP 1983-84, 1984-85, 1985-86");
  });

  it("counts a traded season once, with both teams", async () => {
    const c = (await history.fetchCareer(TRADED, "Trade Guy", false, new Cache({ persist: false })))!;
    expect(c.regular).toHaveLength(1);
    expect(c.regular[0]).toMatchObject({ team: "SAC/BOS", gp: 70, ppg: 12.3 });
  });
});

describe("history tools", () => {
  beforeEach(() => nba());
  const run = (name: string, args: Record<string, unknown>) => tools.execute(name, args, new Cache({ persist: false }), 4000);

  it("pulls a legend's career", async () => {
    const [text, summary, ok] = await run("get_player_career", { name: "Larry Bird" });
    expect(ok).toBe(true);
    expect(summary).toBe("Pulled Larry Bird's career");
    expect(text).toContain("1987-88 BOS age 31: 76 GP");
    expect(text).toContain("playoffs:");
  });

  it("compares two players across eras, with each league's scoring level", async () => {
    const [text, , ok] = await run("compare_players", { player_a: "Larry Bird", player_b: "LeBron James" });
    expect(ok).toBe(true);
    expect(text).toContain("COMPARE Larry Bird vs LeBron James");
    expect(text).toContain("best 5 straight seasons 1983-84 to 1987-88");
    expect(text).toContain("league in 1985-86: 110.2 pts per team game");
  });

  it("answers for a season before nba.com's dashboards", async () => {
    const [text] = await run("get_player", { name: "Larry Bird", season: "1985-86" });
    const out = JSON.parse(text);
    expect(out.regular_season).toContain("1985-86 BOS age 29: 82 GP");
    expect(out.honors_that_season).toContain("MVP");
    const [lead, summary] = await run("get_player_leaders", { category: "points", season: "1985-86", player: "bird" });
    expect(summary).toBe("Ranked 1985-86 players by Points");
    expect(JSON.parse(lead).player_rank).toMatchObject({ rank: 4, player: "Larry Bird", value: "25.8" });
  });

  it("reads a season however the model writes it, and refuses a bad one instead of using this season", async () => {
    const now = tools.season({});
    const start = Number(now.slice(0, 4));
    expect(tools.season({ season: "2023-24" })).toBe("2023-24");
    expect(tools.season({ season: "2023-2024" })).toBe("2023-24");
    expect(tools.season({ season: "2024" })).toBe("2023-24");
    expect(tools.season({ season: "last season" })).toBe(`${start - 1}-${String(start % 100).padStart(2, "0")}`);
    expect(() => tools.season({ season: "the good years" })).toThrow("isn't a season");
    const [text, , ok] = await run("get_standings", { season: "2099-00" });
    expect(ok).toBe(false);
    expect(text).toContain("No NBA season 2099-00");
  });

  it("reads background from Wikipedia", async () => {
    const [text] = await run("get_background", { topic: "Larry Bird" });
    expect(text).toContain("Larry Bird (Wikipedia, https://en.wikipedia.org/wiki/Larry_Bird)");
    expect(text).toContain("three-time MVP");
  });
});

describe("grounding and fact-checking history", () => {
  const LAL = 1610612747;
  const idx = new PlayerIndex(
    [{ pid: LEBRON, name: "LeBron James", team_id: LAL, team_abbr: "LAL", gp: 5, PTS: 24.1 } as LeaguePlayerRow],
    [[BIRD, "Larry Bird", 0], [LEBRON, "LeBron James", 1]],
  );
  beforeEach(() => nba());

  it("brings careers to a hypothetical", async () => {
    const g = await ground("prime Larry Bird vs prime LeBron James, who wins?", { followed: null, cache: new Cache({ persist: false }), budget: 7000, index: idx });
    expect(g.cards.map((c) => c.label)).toEqual(["Larry Bird (career)", "LeBron James", "LeBron James (career)"]);
    expect(g.block).toContain("best 5 straight seasons 1983-84 to 1987-88");
  });

  it("checks a legend's numbers against his career, and leaves predictions alone", async () => {
    const c = (await history.fetchCareer(BIRD, "Larry Bird", false, new Cache({ persist: false })))!;
    const data = history.careerSummary(c);
    expect(checkAnswer("Larry Bird averaged 24.3 points for his career and won 3 MVPs.", data, idx).claims).toEqual([]);
    const wrong = checkAnswer("Larry Bird averaged 31.2 points for his career.", data, idx);
    expect(wrong.claims.map((x) => x.text)).toEqual(["Larry Bird: 31.2 points"]);
    expect(wrong.claims[0].hint).toContain("CAREER Larry Bird");
    // speculation isn't a claim of fact
    expect(checkAnswer("Bird's Celtics would take the series 4-2, and he'd average 30 points.", data, idx).claims).toEqual([]);
  });

  describe("in a chat", () => {
    const sent: any[] = [];
    let replies: string[] = [];
    beforeEach(async () => {
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

    it("looks up a legend the answer brings up on its own before checking it", async () => {
      replies = ["Think Larry Bird: 24.3 points a night for his career."];
      const events: any[] = [];
      for await (const e of router.chatEvents({ mode: "chat", messages: [{ role: "user", content: "who's the best passing forward ever?" }] }, new Cache({ persist: false }))) events.push(e);
      expect(sent).toHaveLength(1); // no rewrite: his career backs the number
      expect(events.find((e) => e.event === "factcheck").data).toMatchObject({ fixed: 0 });
    });
  });
});
