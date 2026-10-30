/** Verified fact tables, the best-to-watch ranking, and taking out what the
 *  fact-check couldn't confirm. */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache } from "../web/src/backend/cache";
import { checkAnswer, trimUnconfirmed } from "../web/src/backend/llm/factcheck";
import { factsFor, factsText } from "../web/src/backend/llm/facts";
import { playerIndex } from "../web/src/backend/llm/grounding";
import { sizeOf } from "../web/src/backend/llm/providers";
import * as router from "../web/src/backend/llm/router";
import { watchRank } from "../web/src/backend/llm/tools";
import * as data from "../web/src/backend/nba/data";
import * as settings from "../web/src/backend/settings";
import { serveWorld, YESTERDAY } from "./evals/world";

const BOS = 1610612738;

describe("fact tables", () => {
  beforeEach(() => serveWorld());
  const facts = async (q: string) => {
    const cache = new Cache({ persist: false });
    return factsFor(q, { followed: BOS, cache, index: await playerIndex(cache) });
  };

  it("lists every game of the day asked about, with the best one to watch", async () => {
    const [t] = await facts("How did the games turn out yesterdat");
    expect(t.rows.map((r) => r[0])).toEqual(["Knicks @ Bulls", "Lakers @ Suns", "Nuggets @ Warriors"]);
    expect(t.rows[2]).toEqual(["Nuggets @ Warriors", "125–121 F/OT", "Jokic 31 · Curry 34"]);
    expect(t.note).toBe("Best watch: Nuggets @ Warriors — overtime, a 4-point game, 246 total points");
  });

  it("says when the team asked about didn't play", async () => {
    const [t] = await facts("How did the Celtics do last night?");
    expect(t.rows).toEqual([]);
    expect(t.note).toContain("The Celtics didn't play that day.");
  });

  it("shows tonight's game with its line", async () => {
    const [t] = await facts("Who wins tonight, Celtics or Hawks?");
    expect(t.rows).toEqual([["Hawks @ Celtics", "7:30 PM ET · BOS -6.5", ""]]);
  });

  it("shows the standings and a player's numbers", async () => {
    const [st] = await facts("Where do we stand in the East?");
    expect(st.rows[0]).toEqual(["1", "▸ Boston Celtics", "4-1", "—", "4-1", "W 1"]);
    const [p] = await facts("How is Paul George playing?");
    expect(p.rows[0].slice(0, 4)).toEqual(["Paul George", "BOS", "5", "18.4"]);
  });

  it("makes no table for opinions or the past", async () => {
    expect(await facts("Who's the greatest Celtic ever?")).toEqual([]);
    expect(await facts("How did the Celtics do last season?")).toEqual([]);
  });

  it("gives the model the table as text", async () => {
    const text = factsText(await facts("yesterday's scores"));
    expect(text).toContain("(ESPN; complete)");
    expect(text).toContain("- Knicks @ Bulls · Result 101–99 F · Top scorers Brunson 33 · White 27");
  });
});

describe("best to watch", () => {
  beforeEach(() => serveWorld());

  it("ranks overtime and close finishes first, with reasons", async () => {
    const sb = await data.fetchScoreboard(YESTERDAY);
    const ranked = watchRank(sb.games);
    expect(ranked.map((w) => w.game.home.abbr)).toEqual(["GS", "CHI", "PHX"]);
    expect(ranked[1].why).toEqual(["decided by 2"]);
  });
});

describe("taking out what couldn't be confirmed", () => {
  const data =
    "GAMES ON 2026-10-28 — every NBA game that day (1):\n- FINAL: NY 101 @ CHI 99 · NY: Jalen Brunson 33 pts";

  it("drops the invented table row and keeps the rest", async () => {
    const idx = await playerIndex(new Cache({ persist: false }));
    const answer =
      "Yesterday's action:\n\n| Game | Final |\n|---|---|\n| Knicks @ Bulls | 101-99 |\n| Celtics @ Hawks | 125-124 |\n\nThe Knicks hung on late. The Celtics won 125-124 in Atlanta.";
    const res = checkAnswer(answer, data, idx);
    const { text, removed } = trimUnconfirmed(answer, res);
    expect(removed).toBe(2);
    expect(text).toContain("| Knicks @ Bulls | 101-99 |");
    expect(text).not.toContain("Celtics");
    expect(text).toContain("The Knicks hung on late.");
  });
});

describe("reported answers", () => {
  beforeEach(() => serveWorld());

  // "What to watch today" on gpt-oss-20b: CLE read as the Celtics, SAC/NO as
  // the Suns/Nuggets, MEM/POR as the Mavericks/Pacers, records with U+2011 hyphens.
  it("2026-10-29 what to watch: games between the wrong teams are caught and taken out", async () => {
    const [r] = JSON.parse(readFileSync("tests/evals/reports/2026-10-29-what-to-watch.json", "utf8"));
    const idx = await playerIndex(new Cache({ persist: false }));
    const res = checkAnswer(r.answer, r.digest, idx);
    expect(res.claims.filter((c) => c.kind === "game").map((c) => c.text)).toEqual(["Celtics–Hawks game", "Suns–Nuggets game", "Mavericks–Pacers game"]);
    expect(res.claims[0].hint).toContain("CLE @ ATL");
    const { text } = trimUnconfirmed(r.answer, res);
    // nothing more about teams that don't play today; the rest stays
    expect(text).not.toMatch(/Celtics|Suns|Nuggets|Mavericks|Pacers/);
    expect(text).toContain("three games are all about early-season momentum");
  });
});

describe("injury claims", () => {
  beforeEach(() => serveWorld());

  it("needs an injury report that lists the player", async () => {
    const idx = await playerIndex(new Cache({ persist: false }));
    const data = "ROSTER: Kristaps Porzingis C 17.0 ppg (out), Jayson Tatum F 27.1 ppg, Jaylen Brown G 23.4 ppg";
    const reasons = (a: string) => checkAnswer(a, data, idx).problems.map((p) => [p.player.name, p.reason]);
    expect(reasons("Porzingis is out tonight with the ankle.")).toEqual([]);
    expect(reasons("Tatum is out tonight, so Brown carries the load.")).toEqual([["Jayson Tatum", "called injured or out, but no injury report in the data lists him"]]);
    expect(reasons("Tatum is not on the injury report.")).toEqual([]);
  });
});

describe("model size", () => {
  it("goes by the model's name, a local server, or the setting", () => {
    expect(sizeOf("custom", "openai/gpt-oss-20b")).toBe("small");
    expect(sizeOf("groq", "llama-3.1-8b-instant")).toBe("small");
    expect(sizeOf("openrouter", "openai/gpt-oss-120b")).toBe("large");
    expect(sizeOf("openrouter", "qwen/qwen3-235b-a22b")).toBe("large");
    expect(sizeOf("openai", "gpt-4o-mini")).toBe("small");
    expect(sizeOf("anthropic", "claude-opus-5-5")).toBe("large");
    expect(sizeOf("anthropic", "claude-haiku-5-5")).toBe("large");
    expect(sizeOf("anthropic", "claude-haiku-4-5")).toBe("small");
    expect(sizeOf("lmstudio", "local-model")).toBe("small");
    expect(sizeOf("custom", "openai/gpt-oss-20b", "large")).toBe("large");
  });

  it("hands a small model only the tools the question needs", () => {
    const names = (q: string) => router.toolsFor("small", q).map((t) => t.name).sort();
    expect(names("how did the games turn out yesterday")).toEqual(["get_game_details", "get_player", "get_roster", "get_scoreboard", "get_standings"]);
    expect(names("is Porzingis out tonight?")).toContain("get_injuries");
    expect(names("who wins tonight?")).toContain("get_game_previews");
    expect(names("Jordan or LeBron in their prime?")).toEqual(expect.arrayContaining(["compare_players", "get_player_career"]));
    expect(router.toolsFor("small", "anything").length).toBeLessThanOrEqual(9);
    expect(router.toolsFor("large", "anything").length).toBe(19);
  });

  it("tells news questions from stats and opinion questions", () => {
    expect(router.NEWS.test("what do you think about the Jalen Brown and Jason Tatum drama in the news?")).toBe(true);
    expect(router.NEWS.test("any trade rumors around the Knicks?")).toBe(true);
    expect(router.NEWS.test("was Draymond suspended?")).toBe(true);
    expect(router.NEWS.test("thoughts on Paul George as a Celtic")).toBe(false);
    expect(router.NEWS.test("how many points did Tatum score last night?")).toBe(false);
  });

  it("offers web search only when the user turns it on", () => {
    const has = (size: "small" | "large", web: boolean) => router.toolsFor(size, "any trade news?", web).some((t) => t.name === "web_search");
    expect(has("large", false)).toBe(false);
    expect(has("large", true)).toBe(true);
    expect(has("small", false)).toBe(false);
    expect(has("small", true)).toBe(true);
  });
});

describe("a chat turn with a fact table", () => {
  const sent: any[] = [];
  let replies: string[] = [];
  beforeEach(async () => {
    serveWorld();
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

  const turn = async (q: string) => {
    const events: any[] = [];
    for await (const e of router.chatEvents({ mode: "chat", team_id: BOS, messages: [{ role: "user", content: q }] }, new Cache({ persist: false }))) events.push(e);
    return events;
  };

  it("shows the table first and asks the model for its take", async () => {
    replies = ["Denver-Golden State was the one to watch: overtime, and Curry's 34 wasn't enough."];
    const events = await turn("How did the games turn out yesterday");
    const kinds = events.map((e) => e.event);
    expect(kinds.indexOf("facts")).toBeLessThan(kinds.indexOf("token"));
    expect(events.find((e) => e.event === "facts").data.tables[0].rows).toHaveLength(3);
    expect(sent[0].messages.at(-1).content).toContain("SHOWN TO THE USER ABOVE YOUR ANSWER");
    expect(events.find((e) => e.event === "factcheck").data).toMatchObject({ fixed: 0 });
  });

  it("gives a small model a low temperature and a short tool list", async () => {
    await settings.update("ai", { model: "gpt-oss-20b" });
    replies = ["Denver-Golden State, in overtime."];
    await turn("How did the games turn out yesterday");
    expect(sent[0].temperature).toBe(0.2);
    expect(sent[0].tools.length).toBeLessThanOrEqual(9);
    expect(sent[0].messages[0].content).toContain("Opinions are welcome");
  });

  it("removes an invented game the rewrites keep repeating", async () => {
    const bad = "Denver won in overtime. The Celtics beat the Hawks 125-124.";
    replies = [bad, bad, bad];
    const events = await turn("How did the games turn out yesterday");
    expect(sent).toHaveLength(3);
    expect(events.filter((e) => e.event === "revision_restore").at(-1).data.text).toBe("Denver won in overtime.");
    expect(events.find((e) => e.event === "factcheck").data).toMatchObject({ removed: 1 });
  });
});
