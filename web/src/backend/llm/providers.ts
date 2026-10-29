/** Provider registry (port of backend/llm/providers.py): local servers + cloud
 *  APIs. Every provider except Anthropic speaks the OpenAI chat-completions
 *  dialect, so one adapter covers them by swapping the base URL. */

import * as settings from "../settings";
import { getKey, keyStatus } from "./keys";

export interface Provider {
  name: string;
  kind: "openai" | "anthropic";
  local: boolean;
  needs_key: boolean;
  base_url: string;
  blurb: string;
  key_url: string;
  suggested?: string[];
  headers?: Record<string, string>;
}

export const PROVIDERS: Record<string, Provider> = {
  lmstudio: {
    name: "LM Studio", kind: "openai", local: true, needs_key: false,
    base_url: "http://localhost:1234/v1",
    blurb: "Models running on this PC through LM Studio's local server.",
    key_url: "https://lmstudio.ai",
  },
  ollama: {
    name: "Ollama", kind: "openai", local: true, needs_key: false,
    base_url: "http://localhost:11434/v1",
    blurb: "Local models served by Ollama.",
    key_url: "https://ollama.com",
  },
  anthropic: {
    name: "Claude (Anthropic)", kind: "anthropic", local: false, needs_key: true,
    base_url: "https://api.anthropic.com",
    blurb: "Claude Opus, Sonnet and Haiku.",
    key_url: "https://console.anthropic.com/settings/keys",
    suggested: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  },
  openai: {
    name: "OpenAI", kind: "openai", local: false, needs_key: true,
    base_url: "https://api.openai.com/v1",
    blurb: "GPT models from OpenAI.",
    key_url: "https://platform.openai.com/api-keys",
  },
  gemini: {
    name: "Google Gemini", kind: "openai", local: false, needs_key: true,
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai/",
    blurb: "Gemini models via Google AI Studio (generous free tier).",
    key_url: "https://aistudio.google.com/apikey",
  },
  groq: {
    name: "Groq", kind: "openai", local: false, needs_key: true,
    base_url: "https://api.groq.com/openai/v1",
    blurb: "Very fast open-weight models (free tier available).",
    key_url: "https://console.groq.com/keys",
  },
  openrouter: {
    name: "OpenRouter", kind: "openai", local: false, needs_key: true,
    base_url: "https://openrouter.ai/api/v1",
    blurb: "One key for hundreds of models from every major lab.",
    key_url: "https://openrouter.ai/keys",
    headers: { "HTTP-Referer": "https://github.com/stnkypnky/baller-buddy-web", "X-Title": "Baller Buddy" },
  },
  xai: {
    name: "xAI Grok", kind: "openai", local: false, needs_key: true,
    base_url: "https://api.x.ai/v1",
    blurb: "Grok models from xAI.",
    key_url: "https://console.x.ai",
  },
  mistral: {
    name: "Mistral", kind: "openai", local: false, needs_key: true,
    base_url: "https://api.mistral.ai/v1",
    blurb: "Mistral's hosted models.",
    key_url: "https://console.mistral.ai/api-keys",
  },
  deepseek: {
    name: "DeepSeek", kind: "openai", local: false, needs_key: true,
    base_url: "https://api.deepseek.com/v1",
    blurb: "DeepSeek chat and reasoning models.",
    key_url: "https://platform.deepseek.com/api_keys",
  },
  together: {
    name: "Together AI", kind: "openai", local: false, needs_key: true,
    base_url: "https://api.together.xyz/v1",
    blurb: "Open-weight models hosted by Together.",
    key_url: "https://api.together.ai/settings/api-keys",
  },
  custom: {
    name: "Custom (OpenAI-compatible)", kind: "openai", local: false, needs_key: false,
    base_url: "",
    blurb: "Any OpenAI-compatible endpoint (vLLM, LocalAI, a proxy…). It must allow browser (CORS) requests.",
    key_url: "",
  },
};

// Model ids that aren't chat models (embeddings, audio, images, moderation…)
const NON_CHAT = ["embed", "tts", "whisper", "dall-e", "image", "audio", "realtime", "moderation", "transcribe",
  "guard", "rerank", "davinci", "babbage", "imagen", "veo", "aqa", "learnlm", "-search-", "computer-use", "sora"];

// Small models: under ~35B parameters by name, or a light tier ("mini", "flash-lite").
const SMALL_NAME = /(mini|nano|haiku|flash-lite|lite|small|tiny|phi|gemma|smol)/i;
const PARAMS = /(?:^|[^\d.])(\d{1,3}(?:\.\d)?)b(?:$|[^a-z])/i;

/** "small" or "large": how much the chat leans on the app versus the model.
 *  `setting` is Settings' choice; "auto" goes by the provider and model name. */
export function sizeOf(pid: string, model: string, setting: string = "auto"): "small" | "large" {
  if (setting === "small" || setting === "large") return setting;
  const n = PARAMS.exec(model);
  if (n) return Number(n[1]) < 35 ? "small" : "large";
  if (SMALL_NAME.test(model)) return "small";
  // a local server's model is unnamed or unknown: assume what fits a home machine
  return PROVIDERS[pid]?.local ? "small" : "large";
}

export function get(pid: string): Provider {
  const p = PROVIDERS[pid];
  if (!p) throw new Error(`unknown provider '${pid}'`);
  return p;
}

export async function baseUrl(pid: string): Promise<string> {
  const ai = await settings.get("ai");
  if (pid === "custom") return (ai.custom_base_url ?? "").replace(/\/+$/, "");
  // Local servers default to this machine; Settings can point them elsewhere.
  if (pid === "lmstudio" && ai.lmstudio_url) return ai.lmstudio_url.replace(/\/+$/, "");
  if (pid === "ollama" && ai.ollama_url) return ai.ollama_url.replace(/\/+$/, "");
  return get(pid).base_url;
}

/** [base_url, api_key, extra_headers] for building a request. */
export async function credentials(pid: string): Promise<[string, string, Record<string, string>]> {
  const p = get(pid);
  let key = await getKey(pid);
  if (p.local && !key) key = "local"; // local servers ignore the key
  if (pid === "custom" && !key) key = "none";
  return [await baseUrl(pid), key, p.headers ?? {}];
}

/** Can this provider be used right now (key present / URL set)? */
export async function available(pid: string): Promise<boolean> {
  const p = get(pid);
  if (pid === "custom") return !!(await baseUrl(pid));
  return p.local || !!(await getKey(pid));
}

/** fetch() for a provider URL: cloud hosts without CORS go through the site's
 *  relay; local servers and custom endpoints are called directly. */
export function providerFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const host = new URL(url).hostname;
  const relayed = RELAYED.has(host);
  return fetch(relayed ? `/api/ai-relay?url=${encodeURIComponent(url)}` : url, init);
}

const RELAYED = new Set([
  "api.openai.com", "generativelanguage.googleapis.com", "api.groq.com", "openrouter.ai",
  "api.x.ai", "api.mistral.ai", "api.deepseek.com", "api.together.xyz",
]);

export class HttpStatusError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ── Model listing (cached briefly) ───────────────────────────────────────────

const modelCache = new Map<string, [number, { id: string; name: string }[]]>();
const MODEL_TTL = 600_000;

async function openaiModels(pid: string) {
  const [url, key, headers] = await credentials(pid);
  const r = await providerFetch(`${url.replace(/\/+$/, "")}/models`, {
    headers: { Authorization: `Bearer ${key}`, ...headers },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new HttpStatusError(r.status, `HTTP ${r.status}`);
  const j = await r.json();
  const items = Array.isArray(j) ? j : (j.data ?? j);
  const out: { id: string; name: string }[] = [];
  for (const m of items ?? []) {
    let mid = typeof m === "object" ? String(m.id ?? "") : String(m);
    if (pid === "gemini") {
      mid = mid.replace(/^models\//, "");
      if (!mid.includes("gemini") && !mid.includes("gemma")) continue;
    }
    if (!mid || NON_CHAT.some((s) => mid.toLowerCase().includes(s))) continue;
    out.push({ id: mid, name: (typeof m === "object" && m.name) || mid });
  }
  return out;
}

async function anthropicModels(pid: string) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: await getKey(pid), maxRetries: 1, timeout: 10_000, dangerouslyAllowBrowser: true });
  const out: { id: string; name: string }[] = [];
  for await (const m of client.models.list()) out.push({ id: m.id, name: m.display_name || m.id });
  return out;
}

export async function listModels(pid: string, refresh = false) {
  const hit = modelCache.get(pid);
  if (hit && !refresh && Date.now() - hit[0] < MODEL_TTL) return hit[1];
  const p = get(pid);
  const models = p.kind === "anthropic" ? await anthropicModels(pid) : await openaiModels(pid);
  if (pid !== "openrouter") models.sort((a, b) => a.id.localeCompare(b.id));
  modelCache.set(pid, [Date.now(), models]);
  return models;
}

/** Check the key/endpoint works. Returns {ok, models, latency_ms, error}. */
export async function validate(pid: string) {
  const t = Date.now();
  try {
    if (pid === "openrouter") {
      // /models is public; /key actually checks auth
      const [, key] = await credentials(pid);
      const r = await providerFetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      });
      if (r.status !== 200) throw new Error(`OpenRouter rejected the key (HTTP ${r.status})`);
    }
    const models = await listModels(pid, true);
    return { ok: true, models, latency_ms: Date.now() - t };
  } catch (e: any) {
    const status = e?.status as number | undefined;
    if (status) {
      const msg = ({ 401: "Invalid API key", 403: "Key not allowed", 404: "Endpoint not found" } as Record<number, string>)[status] ?? `HTTP ${status}`;
      return { ok: false, error: msg, models: [] };
    }
    if (e instanceof TypeError || e?.name === "APIConnectionError") {
      const local = get(pid).local;
      const hint = local ? " — is the server running, with CORS enabled?" : "";
      return { ok: false, error: `Can't reach ${(await baseUrl(pid)) || "endpoint"}${hint}`, models: [] };
    }
    return { ok: false, error: String(e?.message ?? e).slice(0, 300), models: [] };
  }
}

/** Fast reachability probe for local servers (used on the settings page). */
export async function localStatus(pid: string): Promise<boolean> {
  try {
    const r = await fetch(`${await baseUrl(pid)}/models`, { signal: AbortSignal.timeout(1500) });
    return r.status === 200;
  } catch {
    return false;
  }
}

export async function describe() {
  const ai = await settings.get("ai");
  return Promise.all(
    Object.entries(PROVIDERS).map(async ([pid, p]) => {
      const status = await keyStatus(pid);
      return {
        id: pid,
        name: p.name,
        kind: p.kind,
        local: p.local,
        needs_key: p.needs_key,
        blurb: p.blurb,
        key_url: p.key_url,
        base_url: await baseUrl(pid),
        suggested: p.suggested ?? [],
        configured: status.configured,
        last4: status.last4,
        available: await available(pid),
        model: ai.models[pid] ?? "",
      };
    }),
  );
}
