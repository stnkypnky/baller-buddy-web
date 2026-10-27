/** Streaming chat + manual tool loop for Claude via the Anthropic SDK (port of
 *  backend/llm/anthropic_adapter.py). Runs in the browser: Anthropic's API
 *  allows direct browser calls, and the key is the user's own. */

import Anthropic from "@anthropic-ai/sdk";
import { getKey } from "./keys";
import type { AdapterEvent, ChatMessage, RunTool } from "./openaiAdapter";
import { validateArgs, type ToolSpec } from "./tools";

// Models that accept server-side refusal fallbacks (beta). The "default" form
// routes by refusal category, so no fallback model list to maintain.
const FALLBACK_PREFIXES = ["claude-opus-5-5", "claude-fable-5-1", "claude-opus-5", "claude-sonnet-5-5"];
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Adaptive thinking: Opus/Sonnet 4.6+, all 5.x, Fable, Mythos. Haiku and older
 *  models take no thinking param here. */
export function supportsAdaptive(model: string): boolean {
  const m = /^claude-(opus|sonnet|fable|mythos)-(\d+)(?:-(\d+))?/.exec(model);
  if (!m) return false;
  const major = parseInt(m[2], 10);
  const minor = parseInt(m[3] ?? "0", 10);
  if (m[1] === "fable" || m[1] === "mythos") return true;
  // minor < 100 rejects date-suffixed ids like claude-opus-4-20250514 (Opus 4.0)
  return major >= 5 || (major === 4 && minor >= 6 && minor < 100);
}

export const usesFallbacks = (model: string) => FALLBACK_PREFIXES.some((p) => model.startsWith(p));

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
): AsyncGenerator<AdapterEvent> {
  const client = new Anthropic({ apiKey: await getKey(pid), maxRetries: 2, timeout: 300_000, dangerouslyAllowBrowser: true });
  const messages: any[] = [...history];
  const aTools = (tools ?? []).map((s) => ({
    name: s.name,
    description: s.description,
    input_schema: { ...s.parameters, type: "object" as const },
    eager_input_streaming: true,
  }));

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

    if (final.stop_reason === "refusal") {
      yield { type: "error", message: "Claude declined this request." };
      return;
    }
    if (final.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: final.content });
      continue;
    }

    const toolUses = final.content.filter((b: any) => b.type === "tool_use");
    if (!toolUses.length) return;
    if (final.stop_reason === "max_tokens") {
      yield { type: "error", message: "Response hit the token limit mid tool call." };
      return;
    }

    messages.push({ role: "assistant", content: final.content });
    const results: any[] = [];
    for (const b of toolUses) {
      const args = b.input && typeof b.input === "object" && !Array.isArray(b.input) ? b.input : {};
      yield { type: "tool_call", id: b.id, name: b.name, args };
      let text: string, summary: string, ok: boolean;
      try {
        validateArgs(b.name, args);
        [text, summary, ok] = await runTool(b.name, args);
      } catch {
        // tolerant parsing can hand back a truncated object: don't run it
        [text, summary, ok] = [JSON.stringify({ INVALID_JSON: JSON.stringify(b.input) }), "Bad tool arguments", false];
      }
      yield { type: "tool_result", id: b.id, name: b.name, summary, ok };
      results.push({ type: "tool_result", tool_use_id: b.id, content: text, is_error: !ok });
    }
    // all results for one assistant turn go back in a single user message
    messages.push({ role: "user", content: results });
    rnd++;
  }
}
