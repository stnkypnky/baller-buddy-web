/** Streaming chat + manual tool loop for Claude via the Anthropic SDK (port of
 *  backend/llm/anthropic_adapter.py). Runs in the browser: Anthropic's API
 *  allows direct browser calls, and the key is the user's own. */

import Anthropic from "@anthropic-ai/sdk";
import { recordSpend } from "./usage";
import { getKey } from "./keys";
import type { AdapterEvent, ChatMessage, RunTool } from "./openaiAdapter";
import { validateArgs, type ToolSpec } from "./tools";

// Models that accept server-side refusal fallbacks (beta). The "default" form
// routes by refusal category, so no fallback model list to maintain.
const FALLBACK_PREFIXES = ["claude-opus-5-5", "claude-fable-5-1", "claude-opus-5", "claude-sonnet-5-5"];
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Adaptive thinking: Opus/Sonnet 4.6+, all 5.x (Haiku 5.5 too), Fable, Mythos.
 *  Haiku 4.5 and older models take no thinking param here. */
export function supportsAdaptive(model: string): boolean {
  const m = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/.exec(model);
  if (!m) return false;
  const major = parseInt(m[2], 10);
  const minor = parseInt(m[3] ?? "0", 10);
  if (m[1] === "fable" || m[1] === "mythos") return true;
  if (m[1] === "haiku") return major >= 5 && minor < 100;
  // minor < 100 rejects date-suffixed ids like claude-opus-4-20250514 (Opus 4.0)
  return major >= 5 || (major === 4 && minor >= 6 && minor < 100);
}

export const usesFallbacks = (model: string) => FALLBACK_PREFIXES.some((p) => model.startsWith(p));

/** Searches Claude may run per answer (each costs $0.01). */
const WEB_MAX_USES = 5;
const MAX_SOURCES = 5;

/** Anthropic's hosted web search. Opus/Sonnet 4.6+ take the version that
 *  filters results with code first; other models take the basic one. */
export function webSearchTool(model: string) {
  const filtering = /^claude-(opus|sonnet)-/.test(model) && supportsAdaptive(model);
  return { type: filtering ? "web_search_20260209" : "web_search_20250305", name: "web_search", max_uses: WEB_MAX_USES };
}

/** Chip events for a response's web searches, the text they gave (for the
 *  fact-check), and the pages the answer cited. */
function webBlocks(content: any[]) {
  const events: AdapterEvent[] = [];
  const found: string[] = [];
  const cited = new Map<string, string>();
  const queries = new Map<string, string>();
  for (const b of content) {
    if (b.type === "server_tool_use" && b.name === "web_search") {
      const query = String(b.input?.query ?? "");
      queries.set(b.id, query);
      events.push({ type: "tool_call", id: b.id, name: "web_search", args: { query } });
    } else if (b.type === "web_search_tool_result") {
      const q = queries.get(b.tool_use_id) ?? "";
      // a list on success, one error object on failure (the request itself still succeeds)
      if (Array.isArray(b.content)) {
        for (const r of b.content) found.push(`- ${r.title} (${r.url})${r.page_age ? ` · ${r.page_age}` : ""}`);
        events.push({ type: "tool_result", id: b.tool_use_id, name: "web_search", summary: `Searched the web: “${q.slice(0, 60)}” · ${b.content.length} results`, ok: true });
      } else {
        const code = b.content?.error_code ?? "error";
        events.push({ type: "tool_result", id: b.tool_use_id, name: "web_search", summary: `Web search failed (${code})`, ok: false });
      }
    } else if (b.type === "text") {
      for (const c of b.citations ?? []) {
        if (c.type !== "web_search_result_location") continue;
        found.push(`> ${c.cited_text}`);
        if (c.url && !cited.has(c.url)) cited.set(c.url, c.title || new URL(c.url).hostname);
      }
    }
  }
  return { events, found, cited };
}

/** The SDK couldn't parse an eagerly-streamed tool input at all. */
const isJsonError = (e: unknown) => !(e instanceof Anthropic.APIError) && (e instanceof SyntaxError || /JSON/i.test(String((e as Error)?.message)));

export async function* stream(
  pid: string,
  model: string,
  system: string,
  history: ChatMessage[],
  tools: ToolSpec[] | null,
  runTool: RunTool,
  signal?: AbortSignal,
  maxRounds = 6,
  /** Unused: Claude models think adaptively, and thinking takes no temperature. */
  temperature?: number,
  /** Let Claude search the web (Anthropic runs the searches). */
  web = false,
): AsyncGenerator<AdapterEvent> {
  void temperature;
  const client = new Anthropic({ apiKey: await getKey(pid), maxRetries: 2, timeout: 300_000, dangerouslyAllowBrowser: true });
  const messages: any[] = [...history];
  const aTools: any[] = (tools ?? [])
    // the hosted search takes this name
    .filter((s) => !(web && s.name === "web_search"))
    .map((s) => ({
      name: s.name,
      description: s.description,
      input_schema: { ...s.parameters, type: "object" as const },
      eager_input_streaming: true,
    }));
  if (web) aTools.push(webSearchTool(model));
  const sources = new Map<string, string>();

  const base: Record<string, unknown> = { model, max_tokens: 32000, system };
  if (supportsAdaptive(model)) base.thinking = { type: "adaptive", display: "summarized" };
  const beta = usesFallbacks(model);
  if (beta) Object.assign(base, { betas: [FALLBACK_BETA], fallbacks: "default" });

  let rnd = 0;
  let jsonRetries = 0;
  while (rnd <= maxRounds) {
    const req: Record<string, unknown> = { ...base, messages };
    if (aTools.length) {
      req.tools = aTools;
      // tool budget spent — history has tool blocks so tools must stay
      // declared; `none` makes Claude answer with what it has.
      if (rnd === maxRounds) req.tool_choice = { type: "none" };
    }
    let final: any;
    try {
      const s: any = beta
        ? client.beta.messages.stream(req as any, { signal })
        : client.messages.stream(req as any, { signal });
      for await (const event of s) {
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") yield { type: "token", text: event.delta.text };
          else if (event.delta.type === "thinking_delta" && event.delta.thinking) yield { type: "reasoning", text: event.delta.thinking };
        }
      }
      final = await s.finalMessage();
      jsonRetries = 0;
    } catch (e) {
      // eager-streamed tool input the SDK couldn't parse at all; no
      // tool_use_id to answer, so re-issue the turn (bounded)
      if (isJsonError(e) && ++jsonRetries <= 2) continue;
      throw e;
    }
    void recordSpend(final.model ?? model, final.usage ?? {});

    if (web) {
      const w = webBlocks(final.content);
      yield* w.events;
      if (w.found.length) yield { type: "web_text", text: w.found.join("\n") };
      for (const [url, title] of w.cited) if (!sources.has(url)) sources.set(url, title);
    }

    if (final.stop_reason === "refusal") {
      yield { type: "error", message: "Claude declined this request." };
      return;
    }
    if (final.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: final.content });
      continue;
    }

    const toolUses = final.content.filter((b: any) => b.type === "tool_use");
    if (!toolUses.length) {
      if (sources.size) {
        const links = [...sources].slice(0, MAX_SOURCES).map(([url, title]) => `[${title.replace(/[[\]]/g, "")}](${url})`);
        yield { type: "token", text: `\n\n**Sources:** ${links.join(" · ")}` };
      }
      return;
    }
    if (final.stop_reason === "max_tokens") {
      yield { type: "error", message: "Response hit the token limit mid tool call." };
      return;
    }

    messages.push({ role: "assistant", content: final.content });
    const argsOf = (b: any) => (b.input && typeof b.input === "object" && !Array.isArray(b.input) ? b.input : {});
    for (const b of toolUses) yield { type: "tool_call", id: b.id, name: b.name, args: argsOf(b) };
    // Run this turn's calls together; report and return results in call order.
    const outs = await Promise.all(
      toolUses.map(async (b: any): Promise<[string, string, boolean]> => {
        try {
          validateArgs(b.name, argsOf(b));
        } catch {
          // tolerant parsing can hand back a truncated object: don't run it
          return [JSON.stringify({ INVALID_JSON: JSON.stringify(b.input) }), "Bad tool arguments", false];
        }
        return runTool(b.name, argsOf(b));
      }),
    );
    const results: any[] = [];
    for (const [i, b] of toolUses.entries()) {
      const [text, summary, ok] = outs[i];
      yield { type: "tool_result", id: b.id, name: b.name, summary, ok };
      results.push({ type: "tool_result", tool_use_id: b.id, content: text, is_error: !ok });
    }
    // all results for one assistant turn go back in a single user message
    messages.push({ role: "user", content: results });
    rnd++;
  }
}
