/** Streaming chat + tool loop for every OpenAI-compatible provider (OpenAI,
 *  Groq, Gemini, OpenRouter, xAI, Mistral, DeepSeek, Together, LM Studio,
 *  Ollama, custom endpoints). Port of backend/llm/openai_adapter.py, speaking
 *  the chat-completions SSE format over fetch. */

import { credentials, HttpStatusError, providerFetch } from "./providers";
import type { ToolSpec } from "./tools";

export class ToolsUnsupported extends Error {}

const TOOL_ERR_HINTS = ["tool", "function", "does not support"];
const looksLikeToolError = (msg: string) => TOOL_ERR_HINTS.some((h) => msg.toLowerCase().includes(h));

export type AdapterEvent =
  | { type: "token" | "reasoning"; text: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; summary: string; ok: boolean }
  | { type: "error"; message: string }
  /** What a hosted web search found, for the fact-check (not shown). */
  | { type: "web_text"; text: string };

export type RunTool = (name: string, args: Record<string, unknown>) => Promise<[string, string, boolean]>;
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Routes inline reasoning to the reasoning channel. Models mark it different
 *  ways: <think> (Qwen, DeepSeek-R1), <thought> (Gemma via Gemini),
 *  <thinking>, <reasoning>. Handles tags split across stream chunks. */
export class ThinkSplitter {
  static TAGS: [string, string][] = [
    ["<think>", "</think>"], ["<thought>", "</thought>"],
    ["<thinking>", "</thinking>"], ["<reasoning>", "</reasoning>"],
  ];
  buf = "";
  close: string | null = null; // the tag that ends the reasoning we're inside

  get thinking() {
    return this.close !== null;
  }

  /** How many trailing characters could be the start of one of `tags`. */
  private holdBack(tags: string[]) {
    let keep = 0;
    for (const tag of tags) for (let k = 1; k < tag.length; k++) if (k > keep && this.buf.endsWith(tag.slice(0, k))) keep = k;
    return keep;
  }

  private emitAllBut(keep: number, kind: "token" | "reasoning", out: [string, string][]) {
    const emit = keep ? this.buf.slice(0, this.buf.length - keep) : this.buf;
    if (emit) out.push([kind, emit]);
    this.buf = this.buf.slice(emit.length);
  }

  feed(text: string): [string, string][] {
    this.buf += text;
    const out: [string, string][] = [];
    for (;;) {
      if (this.close) {
        const i = this.buf.indexOf(this.close);
        if (i >= 0) {
          if (i) out.push(["reasoning", this.buf.slice(0, i)]);
          this.buf = this.buf.slice(i + this.close.length);
          this.close = null;
          continue;
        }
        this.emitAllBut(this.holdBack([this.close]), "reasoning", out);
        return out;
      }
      const hits = ThinkSplitter.TAGS.map(([o, c]) => [this.buf.indexOf(o), o, c] as const).filter(([i]) => i >= 0);
      if (hits.length) {
        const [i, o, c] = hits.reduce((a, b) => (b[0] < a[0] || (b[0] === a[0] && b[1] < a[1]) ? b : a));
        if (i) out.push(["token", this.buf.slice(0, i)]);
        this.buf = this.buf.slice(i + o.length);
        this.close = c;
        continue;
      }
      this.emitAllBut(this.holdBack(ThinkSplitter.TAGS.map(([o]) => o)), "token", out);
      return out;
    }
  }

  flush(): [string, string][] {
    const rest = this.buf;
    this.buf = "";
    return rest ? [[this.thinking ? "reasoning" : "token", rest]] : [];
  }
}

/** Folds chat-completion stream chunks into events + final tool calls. */
export class Accumulator {
  text = "";
  calls = new Map<number, { id: string; name: string; args: string }>();
  split = new ThinkSplitter();

  private *emit(pieces: [string, string][]): Generator<AdapterEvent> {
    for (const [kind, t] of pieces) {
      if (kind === "token") this.text += t;
      yield { type: kind as "token" | "reasoning", text: t };
    }
  }

  *feed(chunk: any): Generator<AdapterEvent> {
    const d = chunk?.choices?.[0]?.delta;
    if (!d) return;
    const reasoning = d.reasoning_content || d.reasoning;
    if (typeof reasoning === "string" && reasoning) yield { type: "reasoning", text: reasoning };
    if (d.content) yield* this.emit(this.split.feed(d.content));
    for (const tc of d.tool_calls ?? []) {
      const idx = tc.index ?? this.calls.size;
      if (!this.calls.has(idx)) this.calls.set(idx, { id: "", name: "", args: "" });
      const slot = this.calls.get(idx)!;
      if (tc.id) slot.id = tc.id;
      if (tc.function) {
        if (tc.function.name) slot.name += tc.function.name;
        if (tc.function.arguments) slot.args += tc.function.arguments;
      }
    }
  }

  *flush(): Generator<AdapterEvent> {
    yield* this.emit(this.split.flush());
  }

  toolCalls() {
    return [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, c]) => c.name)
      .map(([i, c]) => ({ id: c.id || `call_${i}`, name: c.name, args: c.args || "{}" }));
  }
}

function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return null;
  }
}

/** The `data:` payloads of an SSE response body. */
async function* sseData(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>).getReader();
  let buf = "";
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("aborted", "AbortError");
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let idx: number;
      while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, "");
        const data = chunk.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
        if (data) yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function errorText(r: Response) {
  const raw = await r.text().catch(() => "");
  try {
    const j = JSON.parse(raw);
    return String(j?.error?.message ?? j?.message ?? j?.detail ?? raw);
  } catch {
    return raw || r.statusText;
  }
}

export async function* stream(
  pid: string,
  model: string,
  system: string,
  history: ChatMessage[],
  tools: ToolSpec[] | null,
  runTool: RunTool,
  signal?: AbortSignal,
  maxRounds = 6,
  /** Lower for small models (fewer made-up details); omitted when unset. */
  temperature?: number,
): AsyncGenerator<AdapterEvent> {
  const [url, key, headers] = await credentials(pid);
  const messages: any[] = [{ role: "system", content: system }, ...history];
  const fnTools = (tools ?? []).map((s) => ({ type: "function", function: { name: s.name, description: s.description, parameters: s.parameters } }));
  let temp = temperature;

  for (let rnd = 0; rnd <= maxRounds; rnd++) {
    const body: Record<string, unknown> = { model, messages, stream: true };
    if (fnTools.length && rnd < maxRounds) body.tools = fnTools;
    if (temp !== undefined) body.temperature = temp;
    const post = () =>
      providerFetch(`${url.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: `Bearer ${key}`, ...headers },
        body: JSON.stringify(body),
        signal,
      });
    let r = await post();
    if (r.status === 400 && temp !== undefined) {
      // some models (reasoning ones) only take their default temperature
      const msg = await errorText(r.clone());
      if (/temperature/i.test(msg)) {
        temp = undefined;
        delete body.temperature;
        r = await post();
      }
    }
    if (!r.ok || !r.body) {
      const msg = await errorText(r);
      if (r.status === 400 && body.tools && looksLikeToolError(msg)) throw new ToolsUnsupported(msg);
      throw new HttpStatusError(r.status, `Error code: ${r.status} - ${msg}`);
    }
    const acc = new Accumulator();
    for await (const data of sseData(r.body, signal)) {
      if (data === "[DONE]") break;
      let chunk: any;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk?.error) throw new Error(String(chunk.error.message ?? JSON.stringify(chunk.error)));
      yield* acc.feed(chunk);
    }
    yield* acc.flush();

    const calls = acc.toolCalls();
    if (!calls.length) return;
    messages.push({
      role: "assistant",
      content: acc.text || null,
      tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })),
    });
    // Run this turn's calls together; report and return results in call order.
    const parsed = calls.map((c) => ({ ...c, parsed: parseArgs(c.args) }));
    for (const c of parsed) yield { type: "tool_call", id: c.id, name: c.name, args: c.parsed ?? {} };
    const results = await Promise.all(
      parsed.map((c) =>
        c.parsed === null
          ? Promise.resolve<[string, string, boolean]>([JSON.stringify({ error: "INVALID_JSON arguments" }), "Bad tool arguments", false])
          : runTool(c.name, c.parsed),
      ),
    );
    for (const [i, c] of parsed.entries()) {
      const [text, summary, ok] = results[i];
      yield { type: "tool_result", id: c.id, name: c.name, summary, ok };
      messages.push({ role: "tool", tool_call_id: c.id, content: text });
    }
  }
}
