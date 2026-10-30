/** What this app has spent per provider and model since the user last reset
 *  the count, priced from each response's token usage. An estimate: neither
 *  Anthropic nor OpenAI reports balance or billing to ordinary API keys.
 *  Models without a known price still count their tokens (cost unknown). */

import { idbGet, idbSet } from "../idb";

export interface ModelUsage {
  requests: number;
  input: number; // uncached input tokens
  cached: number; // input tokens read from the prompt cache
  cache_write: number; // input tokens written to the cache (Claude)
  output: number; // includes reasoning
  reasoning: number; // OpenAI reports it; Claude bills it inside output
  searches: number;
  cost: number;
  /** Requests whose model had no known price (their cost isn't in `cost`). */
  unpriced: number;
}
export interface ProviderUsage {
  since: string;
  models: Record<string, ModelUsage>;
}
export type UsageStore = Record<string, ProviderUsage>;

/** Providers the app tracks spend for. */
export const TRACKED = ["anthropic", "openai"];

// ── prices ($ per million tokens), first match wins ──────────────────────────

// Claude: [input, output]; cache writes 1.25x input, reads 0.1x.
const CLAUDE: [RegExp, number, number][] = [
  [/^claude-(fable|mythos)/, 10, 50],
  [/^claude-opus-5-5/, 4, 20],
  [/^claude-opus-(5|4-[5-9])/, 5, 25],
  [/^claude-opus/, 15, 75],
  [/^claude-sonnet-5/, 2, 10],
  [/^claude-sonnet/, 3, 15],
  [/^claude-haiku-5/, 0.1, 0.5],
  [/^claude-haiku-4/, 1, 5],
  [/^claude-haiku/, 0.8, 4],
];
/** Haiku 5.5 prompts over 100K tokens bill at 5x. */
const HAIKU_LONG = 100_000;
const WEB_SEARCH_COST = 0.01;

// OpenAI: [input, cached input, output]. Only models with settled published
// prices; newer ones count tokens with the cost left unknown.
const OPENAI: [RegExp, number, number, number][] = [
  [/^gpt-5-nano\b/, 0.05, 0.005, 0.4],
  [/^gpt-5-mini\b/, 0.25, 0.025, 2],
  [/^gpt-5-pro\b/, 15, 15, 120],
  [/^gpt-5(?:-chat-latest|-\d{4}-\d\d-\d\d)?$/, 1.25, 0.125, 10],
  [/^gpt-4\.1-nano\b/, 0.1, 0.025, 0.4],
  [/^gpt-4\.1-mini\b/, 0.4, 0.1, 1.6],
  [/^gpt-4\.1\b/, 2, 0.5, 8],
  [/^gpt-4o-mini\b/, 0.15, 0.075, 0.6],
  [/^gpt-4o\b/, 2.5, 1.25, 10],
  [/^o4-mini\b/, 1.1, 0.275, 4.4],
  [/^o3-mini\b/, 1.1, 0.55, 4.4],
  [/^o3\b/, 2, 0.5, 8],
  [/^o1\b/, 15, 7.5, 60],
];

export interface ClaudeUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

export interface OpenAIUsage {
  prompt_tokens?: number | null; // includes cached
  completion_tokens?: number | null; // includes reasoning
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
}

const blank = (): ModelUsage => ({ requests: 0, input: 0, cached: 0, cache_write: 0, output: 0, reasoning: 0, searches: 0, cost: 0, unpriced: 0 });

/** One Claude response as a usage row; cost null for an unknown model. */
export function claudeRow(model: string, u: ClaudeUsage): ModelUsage & { cost: number; priced: boolean } {
  const fresh = u.input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  const out = u.output_tokens ?? 0;
  const searches = u.server_tool_use?.web_search_requests ?? 0;
  const row = { ...blank(), requests: 1, input: fresh, cached: read, cache_write: write, output: out, searches };
  const p = CLAUDE.find(([re]) => re.test(model));
  if (!p) return { ...row, unpriced: 1, priced: false };
  let [, inp, outp] = p;
  if (/^claude-haiku-5/.test(model) && fresh + write + read > HAIKU_LONG) {
    inp *= 5;
    outp *= 5;
  }
  const cost = (fresh * inp + write * inp * 1.25 + read * inp * 0.1 + out * outp) / 1e6 + searches * WEB_SEARCH_COST;
  return { ...row, cost, priced: true };
}

/** One OpenAI response as a usage row. */
export function openaiRow(model: string, u: OpenAIUsage): ModelUsage & { priced: boolean } {
  const prompt = u.prompt_tokens ?? 0;
  const cached = Math.min(prompt, u.prompt_tokens_details?.cached_tokens ?? 0);
  const out = u.completion_tokens ?? 0;
  const row = { ...blank(), requests: 1, input: prompt - cached, cached, output: out, reasoning: u.completion_tokens_details?.reasoning_tokens ?? 0 };
  // "openai/gpt-5" style ids (routers) and dated snapshots price like the base model
  const id = model.replace(/^openai\//, "");
  const p = OPENAI.find(([re]) => re.test(id));
  if (!p) return { ...row, unpriced: 1, priced: false };
  const [, inp, cin, outp] = p;
  return { ...row, cost: ((prompt - cached) * inp + cached * cin + out * outp) / 1e6, priced: true };
}

/** Dollars one Claude response cost (0 for an unknown model). */
export const costOf = (model: string, u: ClaudeUsage) => claudeRow(model, u).cost;

// ── storage (its own record: settings merge rather than replace) ─────────────

const KEY = "usage";
let queue: Promise<unknown> = Promise.resolve();

export async function getUsage(): Promise<UsageStore> {
  await queue;
  return ((await idbGet<UsageStore>("settings", KEY).catch(() => undefined)) ?? {}) as UsageStore;
}

function write(fn: (s: UsageStore) => void) {
  queue = queue
    .then(async () => {
      const s = ((await idbGet<UsageStore>("settings", KEY).catch(() => undefined)) ?? {}) as UsageStore;
      fn(s);
      await idbSet("settings", KEY, s);
    })
    .catch((e) => console.warn("usage tracking failed:", e));
  return queue;
}

function add(pid: string, model: string, row: ModelUsage) {
  return write((s) => {
    const p = (s[pid] ??= { since: new Date().toISOString(), models: {} });
    const m = (p.models[model] ??= blank());
    for (const k of Object.keys(m) as (keyof ModelUsage)[]) m[k] += row[k] ?? 0;
  });
}

export const recordClaude = (model: string, u: ClaudeUsage) => add("anthropic", model, claudeRow(model, u));
export const recordOpenAI = (model: string, u: OpenAIUsage) => add("openai", model, openaiRow(model, u));

/** Start a provider's count over at $0.00. */
export const resetUsage = (pid: string) => write((s) => void (s[pid] = { since: new Date().toISOString(), models: {} }));

/** A provider's totals across its models. */
export function totals(p?: ProviderUsage): ModelUsage {
  const t = blank();
  for (const m of Object.values(p?.models ?? {})) for (const k of Object.keys(t) as (keyof ModelUsage)[]) t[k] += m[k];
  return t;
}
