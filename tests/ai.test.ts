/** AI layer tests (ported from tests/test_ai.py): stream parsing, the tool loop
 *  through the OpenAI-compatible adapter and the real Anthropic SDK (against a
 *  stubbed fetch speaking each wire protocol), router fallbacks, and keys. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as anthropicAdapter from "../web/src/backend/llm/anthropicAdapter";
import * as keys from "../web/src/backend/llm/keys";
import * as openaiAdapter from "../web/src/backend/llm/openaiAdapter";
import * as providers from "../web/src/backend/llm/providers";
import * as router from "../web/src/backend/llm/router";
import * as tools from "../web/src/backend/llm/tools";
import * as news from "../web/src/backend/news";
import { Cache } from "../web/src/backend/cache";
import * as settings from "../web/src/backend/settings";
import { resultSet, serve } from "./fake";

// ── pure parsing ─────────────────────────────────────────────────────────────

function split(pieces: string[]) {
  const s = new openaiAdapter.ThinkSplitter();
  const out: [string, string][] = [];
  for (const p of pieces) out.push(...s.feed(p));
  out.push(...s.flush());
  return [out.filter(([k]) => k === "token").map(([, t]) => t).join(""), out.filter(([k]) => k === "reasoning").map(([, t]) => t).join("")];
}

describe("parsing", () => {
  it("splits think tags across chunks", () => {
    expect(split(["Hello <th", "ink>secret reas", "oning</thi", "nk> world"])).toEqual(["Hello  world", "secret reasoning"]);
  });

  it("handles Gemma's thought tags", () => {
    expect(split(["<thou", "ght>Need the game log.</thought><thought>Lost 113-121.</tho", "ught>The Celtics lost ", "113-121 in Detroit."])).toEqual([
      "The Celtics lost 113-121 in Detroit.",
      "Need the game log.Lost 113-121.",
    ]);
  });

  it("leaves ordinary angle brackets alone", () => {
    expect(split(["Pace < 100 and <b>bold</b> stay text"])).toEqual(["Pace < 100 and <b>bold</b> stay text", ""]);
  });

  it("detects adaptive thinking and fallback models", () => {
    expect(anthropicAdapter.supportsAdaptive("claude-opus-5-5")).toBe(true);
    expect(anthropicAdapter.supportsAdaptive("claude-sonnet-4-6")).toBe(true);
    expect(anthropicAdapter.supportsAdaptive("claude-fable-5-1")).toBe(true);
    expect(anthropicAdapter.supportsAdaptive("claude-haiku-4-5")).toBe(false);
    expect(anthropicAdapter.supportsAdaptive("claude-sonnet-4-5-20250929")).toBe(false);
    expect(anthropicAdapter.supportsAdaptive("claude-opus-4-20250514")).toBe(false);
    expect(anthropicAdapter.usesFallbacks("claude-opus-5-5")).toBe(true);
    expect(anthropicAdapter.usesFallbacks("claude-haiku-4-5")).toBe(false);
  });
});

// ── mock provider servers (a stubbed fetch) ──────────────────────────────────

const MOCK = "http://mock.local/v1";
const calls: { openai: any[]; anthropic: any[] } = { openai: [], anthropic: [] };

const sseResponse = (frames: string[]) =>
  new Response(new ReadableStream({ start(c) { for (const f of frames) c.enqueue(new TextEncoder().encode(f)); c.close(); } }), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });

const oaChunk = (delta: unknown, finish: string | null = null) => ({ id: "x", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] });
const oaStream = (chunks: unknown[]) => sseResponse([...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), "data: [DONE]\n\n"]);
const anStream = (events: any[]) => sseResponse(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
const msgStart = () => ({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-4-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });

async function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const bodyText = init?.body ? String(init.body) : input instanceof Request ? await input.text() : "";
  const body = bodyText ? JSON.parse(bodyText) : null;
  if (url.endsWith("/chat/completions")) {
    calls.openai.push(body);
    if (body.model === "no-tools-model" && "tools" in body) return Response.json({ error: { message: "this model does not support tools" } }, { status: 400 });
    if (body.messages.some((m: any) => m.role === "tool") || !("tools" in body)) {
      return oaStream([oaChunk({ role: "assistant", content: "<think>checking</think>" }), oaChunk({ content: "Celtics are 0-1." }), oaChunk({}, "stop")]);
    }
    return oaStream([
      oaChunk({ role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_standings", arguments: '{"confer' } }] }),
      oaChunk({ tool_calls: [{ index: 0, function: { arguments: 'ence": "East"}' } }] }),
      oaChunk({}, "tool_calls"),
    ]);
  }
  if (url.endsWith("/models")) return Response.json({ object: "list", data: [{ id: "model-a" }, { id: "text-embedding-3" }] });
  if (url.includes("/v1/messages")) {
    calls.anthropic.push(body);
    const hasResult = body.messages.some((m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === "tool_result"));
    if (!hasResult) {
      return anStream([
        msgStart(),
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "get_standings", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"conference":' } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: ' "West"}' } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 20 } },
        { type: "message_stop" },
      ]);
    }
    return anStream([
      msgStart(),
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Thunder lead " } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "the West." } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 8 } },
      { type: "message_stop" },
    ]);
  }
  return new Response("not found", { status: 404 });
}

const runToolStub = async (name: string, args: Record<string, unknown>): Promise<[string, string, boolean]> => [
  JSON.stringify({ tool: name, args }),
  `Pulled ${args.conference} standings`,
  true,
];

const collect = async <T>(gen: AsyncGenerator<T>) => {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
};

describe("providers and router", () => {
  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn(mockFetch));
    calls.openai.length = 0;
    calls.anthropic.length = 0;
    await settings.update("ai", { custom_base_url: MOCK, provider: "lmstudio", model: "", fallbacks: [], no_tools: [] });
    for (const p of ["openai", "anthropic", "custom"]) await keys.deleteKey(p);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("runs the OpenAI-compatible tool loop", async () => {
    const evs = await collect(openaiAdapter.stream("custom", "model-a", "sys", [{ role: "user", content: "standings?" }], [{ name: "get_standings", description: "d", parameters: { type: "object", properties: {} } }], runToolStub));
    expect(evs.slice(0, 2).map((e) => e.type)).toEqual(["tool_call", "tool_result"]);
    expect((evs[0] as any).args).toEqual({ conference: "East" }); // fragments re-assembled
    expect(evs.filter((e) => e.type === "token").map((e: any) => e.text).join("")).toBe("Celtics are 0-1.");
    expect(evs.filter((e) => e.type === "reasoning").map((e: any) => e.text).join("")).toBe("checking");
    const second = calls.openai.at(-1).messages;
    expect(second.at(-1)).toEqual({ role: "tool", tool_call_id: "call_1", content: (await runToolStub("get_standings", { conference: "East" }))[0] });
  });

  it("runs the Anthropic tool loop through the SDK", async () => {
    await keys.setKey("anthropic", "sk-ant-test-key-123456");
    const evs = await collect(anthropicAdapter.stream("anthropic", "claude-haiku-4-5", "sys", [{ role: "user", content: "west?" }], [{ name: "get_standings", description: "d", parameters: { type: "object", properties: { conference: { type: "string" } } } }], runToolStub));
    expect(evs.slice(0, 2).map((e) => e.type)).toEqual(["tool_call", "tool_result"]);
    expect((evs[0] as any).args).toEqual({ conference: "West" });
    expect(evs.filter((e) => e.type === "token").map((e: any) => e.text).join("")).toBe("Thunder lead the West.");
    const [first, second] = calls.anthropic;
    expect(first.tools[0].eager_input_streaming).toBe(true);
    expect("thinking" in first).toBe(false); // haiku: no adaptive thinking
    const results = second.messages.at(-1).content;
    expect(results.length).toBe(1);
    expect(results[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
  });

  it("falls back to a data snapshot when a model rejects tools", async () => {
    // (this mock's canned "0-1" isn't in any data, so leave the fact-check out of it)
    await settings.update("ai", { provider: "custom", model: "no-tools-model", factcheck: false });
    const evs = await collect(router.chatEvents({ messages: [{ role: "user", content: "hi" }], mode: "chat" }, new Cache({ persist: false })));
    const kinds = evs.map((e) => e.event);
    expect(kinds).toContain("status");
    expect(kinds.at(-1)).toBe("done");
    expect((await settings.get("ai")).no_tools).toContain("custom:no-tools-model"); // remembered
    expect(evs.filter((e) => e.event === "token").map((e) => e.data.text).join("")).toBe("Celtics are 0-1.");
  });

  it("skips unconfigured providers and uses the fallback chain", async () => {
    serve([["leaguestandingsv3", resultSet([{ TeamID: 1610612738, Conference: "East", PlayoffRank: 1, WINS: 1, LOSSES: 0 }])]]);
    await settings.update("ai", { provider: "openai", model: "gpt-x", fallbacks: ["custom:model-a"] });
    const evs = await collect(router.chatEvents({ messages: [{ role: "user", content: "standings?" }] }, new Cache({ persist: false })));
    const metas = evs.filter((e) => e.event === "meta").map((e) => e.data);
    expect(metas[0].provider).toBe("custom"); // openai had no key -> skipped
    expect(evs.at(-1)!.event).toBe("done");
    const result = evs.find((e) => e.event === "tool_result")!;
    expect(result.data).toMatchObject({ ok: true, summary: "Pulled East standings" });
  });

  it("says so when no provider can answer", async () => {
    await settings.update("ai", { provider: "openai", fallbacks: [] });
    const evs = await collect(router.chatEvents({ messages: [{ role: "user", content: "x" }] }, new Cache({ persist: false })));
    expect(evs.at(-1)!.event).toBe("error");
    expect(evs.at(-1)!.data.message).toContain("No AI provider");
  });

  it("lists only chat models", async () => {
    expect((await providers.listModels("custom", true)).map((m) => m.id)).toEqual(["model-a"]);
  });
});

describe("keys", () => {
  it("encrypts keys at rest and reports only the last four", async () => {
    await keys.setKey("unit", "sk-test-abcdefgh1234");
    expect(await keys.keyStatus("unit")).toEqual({ configured: true, last4: "1234" });
    const { idbGet } = await import("../web/src/backend/idb");
    const sealed: any = await idbGet("keys", "k_unit");
    expect(JSON.stringify(sealed)).not.toContain("abcdefgh");
    await keys.deleteKey("unit");
    expect((await keys.keyStatus("unit")).configured).toBe(false);
  });
});

describe("tools", () => {
  it("ranks players with aliases, qualifiers and a player lookup", async () => {
    const rows = [["Jayson Tatum", 27, 0.46, 9], ["Big Man", 8, 0.8, 1], ["Derrick White", 15, 0.5, 5]].map(([n, p, f, m], i) => ({
      PLAYER_ID: i, PLAYER_NAME: n, TEAM_ID: 1, TEAM_ABBREVIATION: "BOS", GP: 10, PTS: p, FG_PCT: f, FGM: m,
    }));
    serve([["leaguedashplayerstats", resultSet(rows)]]);
    const cache = new Cache({ persist: false });
    let [text, summary, ok] = await tools.execute("get_player_leaders", { category: "scoring", player: "white", season: "2017-18" }, cache);
    let out = JSON.parse(text);
    expect(ok).toBe(true);
    expect(summary).toBe("Ranked players by Points");
    expect(out.ranking.map((r: any) => r.player)).toEqual(["Jayson Tatum", "Derrick White", "Big Man"]);
    expect(out.player_rank).toEqual({ rank: 2, player: "Derrick White", team: "BOS", gp: 10, value: "15.0" });
    // FG% shows as a percentage and drops the low-volume shooter.
    out = JSON.parse((await tools.execute("get_player_leaders", { category: "fg%", top: 5, season: "2017-18" }, cache))[0]);
    expect(out.ranking.map((r: any) => [r.player, r.value])).toEqual([["Derrick White", "50.0%"], ["Jayson Tatum", "46.0%"]]);
    expect(out.qualifier).toBe("7+ games, 3.7 FGM per game");
    [text, , ok] = await tools.execute("get_player_leaders", { category: "dunks" }, cache);
    expect(ok).toBe(false);
    expect(text).toContain("Unknown category");
  });

  it("validates arguments before running", async () => {
    const [text, , ok] = await tools.execute("get_roster", {}, new Cache({ persist: false }));
    expect(ok).toBe(false);
    expect(text).toContain("Missing required argument 'team'");
  });
});

// ── news brief ───────────────────────────────────────────────────────────────

function hub(): news.Hub {
  const art = (source: string, title: string) => ({ source, title, summary: "sum " + title }) as news.Article;
  const inj = (team: string, player: string) => ({ team, player, status: "Out", injury: "knee", comment: "c" }) as any;
  return {
    team: [art("ESPN", "Celtics win")], league: [art("CBS", "League story")], rumors: [art("Hoops Rumors", "Trade chatter")],
    video: [art("ESPN", "Dunk of the night")],
    injuries: { team: [inj("Boston Celtics", "Tatum")], league: [inj("Boston Celtics", "Tatum"), inj("Miami Heat", "Butler")] },
  } as any;
}

describe("news brief", () => {
  it("follows the News tab", () => {
    const h = hub();
    const team = "Boston Celtics";
    expect(news.headlinesBrief(h, team, "team")).toContain("Celtics win");
    expect(news.headlinesBrief(h, team, "team")).not.toContain("League story");
    expect(news.headlinesBrief(h, team, "league")).not.toContain("Celtics win");
    expect(news.headlinesBrief(h, team, "rumors")).toContain("Trade chatter");
    expect(news.headlinesBrief(h, team, "video")).toContain("Dunk of the night");
    const inj = news.headlinesBrief(h, team, "injuries");
    expect(inj).toContain("Miami Heat: Butler");
    expect(inj).toContain("(the user's team)");
    expect(inj).not.toContain("Celtics win");
    expect(news.headlinesBrief(h, "", "team")).toContain("League story"); // no team: falls back to league
    const combined = news.headlinesBrief(h, team);
    for (const t of ["Celtics win", "League story", "Trade chatter"]) expect(combined).toContain(t);
  });

  it("puts the focus in the brief's system prompt", async () => {
    const cache = new Cache({ persist: false });
    const sys = await router.buildSystem({ mode: "brief", focus: "rumors" }, cache, false);
    expect(sys).toContain("Trades & Rumors");
    expect(sys).toContain("exactly five");
    expect(await router.buildSystem({ mode: "brief" }, cache, false)).not.toContain("Trades & Rumors");
  });
});
