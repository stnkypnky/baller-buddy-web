/** Claude credit, estimated: the balance the user entered in Settings minus
 *  what this app has spent since, priced from each response's token usage.
 *  Anthropic's API has no balance endpoint for ordinary API keys, so spend
 *  from other apps or the Console isn't seen. */

import * as settings from "../settings";

// $ per million tokens [input, output], first match wins. Cache writes cost
// 1.25x input, cache reads 0.1x.
const PRICES: [RegExp, number, number][] = [
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

export interface Usage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

/** Dollars one response cost. Unknown models cost 0 (not guessed). */
export function costOf(model: string, u: Usage): number {
  const p = PRICES.find(([re]) => re.test(model));
  if (!p) return 0;
  let [, inp, out] = p;
  const fresh = u.input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  if (/^claude-haiku-5/.test(model) && fresh + write + read > HAIKU_LONG) {
    inp *= 5;
    out *= 5;
  }
  const tokens = (fresh * inp + write * inp * 1.25 + read * inp * 0.1 + (u.output_tokens ?? 0) * out) / 1e6;
  return tokens + (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_COST;
}

let queue: Promise<unknown> = Promise.resolve();

/** Add a response's cost to the running spend (only once a balance is set). */
export function recordSpend(model: string, usage: Usage) {
  const cost = costOf(model, usage);
  if (!cost) return queue;
  queue = queue
    .then(async () => {
      const c = (await settings.get("ai")).claude_credit;
      if (c.balance === null) return;
      await settings.update("ai", { claude_credit: { ...c, spent: c.spent + cost } });
    })
    .catch((e) => console.warn("credit tracking failed:", e));
  return queue;
}
