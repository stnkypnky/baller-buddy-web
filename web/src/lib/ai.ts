import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { sse } from "./api";

export interface ToolChip {
  id: string;
  name: string;
  args: Record<string, unknown>;
  summary?: string;
  ok?: boolean;
  done: boolean;
}

export interface AiMeta {
  provider: string;
  provider_name: string;
  model: string;
  tools: boolean;
}

export interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  tools?: ToolChip[];
  status?: string[];
  meta?: AiMeta;
  error?: string;
  streaming?: boolean;
  startedAt?: number;
  finishedAt?: number;
  stopped?: boolean;
  /** The latest event kind, so the indicator can say what's happening now. */
  last?: string;
  /** What the app looked up before the model answered ("Paul George", "Celtics"). */
  grounding?: string[];
  /** The fact-check: how many named players were checked, and which were fixed. */
  factcheck?: { checked: number; fixed: number; names: string[]; unresolved?: boolean };
  /** This turn's data, sent with later questions so follow-ups keep it. */
  digest?: string;
}

const CLOSE_TAGS = ["</think>", "</thought>", "</thinking>", "</reasoning>"];

/** Some model templates (Qwen3 on a few servers) open the reasoning in the
 *  prompt, so the reply carries only the closing tag. Tags that properly open
 *  are split off in the backend; anything before an orphan closing tag is
 *  reasoning, not answer. */
function splitOrphanReasoning(content: string, reasoning: string): [string, string] {
  for (const tag of CLOSE_TAGS) {
    const i = content.indexOf(tag);
    if (i >= 0) {
      reasoning += content.slice(0, i);
      content = content.slice(i + tag.length).trimStart();
    }
  }
  return [content, reasoning];
}

export interface ChatRequest {
  mode?: "chat" | "matchup" | "brief" | "recap";
  /** Which News tab a brief is for. */
  focus?: "team" | "league" | "rumors" | "video" | "injuries";
  team_id?: number;
  season?: string;
  page?: string;
  context?: string;
  web?: boolean;
  provider?: string;
  model?: string;
  event_id?: string;
  data_digests?: string[];
}

const uid = () => Math.random().toString(36).slice(2, 10);

/** Applies one SSE event to an assistant turn (immutable update). */
export function applyEvent(t: Turn, event: string, data: any): Turn {
  const now = Date.now();
  switch (event) {
    case "meta":
      return { ...t, meta: data, last: event };
    case "token": {
      const [content, reasoning] = splitOrphanReasoning(t.content + (data.text ?? ""), t.reasoning ?? "");
      return { ...t, content, reasoning, last: event };
    }
    case "reasoning":
      return { ...t, reasoning: (t.reasoning ?? "") + (data.text ?? ""), last: event };
    case "tool_call":
      return { ...t, tools: [...(t.tools ?? []), { id: data.id, name: data.name, args: data.args ?? {}, done: false }], last: event };
    case "tool_result":
      return {
        ...t,
        tools: (t.tools ?? []).map((c) => (c.id === data.id ? { ...c, summary: data.summary, ok: data.ok, done: true } : c)),
        last: event,
      };
    case "status":
      return { ...t, status: [...(t.status ?? []), data.text], last: event };
    case "grounding":
      return { ...t, grounding: data.labels ?? [], last: event };
    case "revision":
      // the fact-checked rewrite replaces the draft as it streams in
      return { ...t, content: "", status: [...(t.status ?? []), `Correcting ${(data.names ?? []).join(", ")}…`], last: event };
    case "revision_restore":
      return { ...t, content: data.text ?? t.content, last: event };
    case "factcheck":
      return { ...t, factcheck: data, last: event };
    case "digest":
      return { ...t, digest: data.text ?? "" };
    case "error":
      return { ...t, error: data.message, streaming: false, finishedAt: t.finishedAt ?? now };
    case "done":
      return { ...t, streaming: false, finishedAt: t.finishedAt ?? now };
    default:
      return t;
  }
}

/** Marks a turn finished; `stopped` when the user pressed Stop. */
function finish(t: Turn, stopped = false): Turn {
  return { ...t, streaming: false, stopped: t.stopped || stopped, finishedAt: t.finishedAt ?? Date.now() };
}

/* ── Conversation store (survives page navigation) ───────────────────────── */

interface ChatState {
  turns: Turn[];
  streaming: boolean;
  setTurns: (fn: (t: Turn[]) => Turn[]) => void;
  setStreaming: (s: boolean) => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>()((set) => ({
  turns: [],
  streaming: false,
  setTurns: (fn) => set((s) => ({ turns: fn(s.turns) })),
  setStreaming: (streaming) => set({ streaming }),
  clear: () => set({ turns: [] }),
}));

let chatAbort: AbortController | null = null;

export async function sendChat(text: string, req: ChatRequest) {
  const store = useChatStore.getState();
  if (store.streaming || !text.trim()) return;
  const history = store.turns
    .filter((t) => t.content.trim() && !t.error)
    .map((t) => ({ role: t.role, content: t.content }));
  const digests = store.turns.filter((t) => t.role === "assistant" && t.digest).map((t) => t.digest!);
  const user: Turn = { id: uid(), role: "user", content: text.trim() };
  const bot: Turn = { id: uid(), role: "assistant", content: "", streaming: true, startedAt: Date.now() };
  store.setTurns((ts) => [...ts, user, bot]);
  store.setStreaming(true);
  chatAbort = new AbortController();
  const update = (fn: (t: Turn) => Turn) =>
    useChatStore.getState().setTurns((ts) => ts.map((t) => (t.id === bot.id ? fn(t) : t)));
  let aborted = false;
  try {
    for await (const ev of sse("/ai/chat", { ...req, mode: "chat", messages: [...history, { role: "user", content: user.content }], data_digests: digests }, chatAbort.signal)) {
      update((t) => applyEvent(t, ev.event, ev.data));
    }
  } catch (e) {
    aborted = (e as Error).name === "AbortError";
    if (!aborted) update((t) => ({ ...t, error: (e as Error).message }));
  } finally {
    update((t) => finish(t, aborted));
    useChatStore.getState().setStreaming(false);
    chatAbort = null;
  }
}

export function stopChat() {
  chatAbort?.abort();
}

/* ── One-shot streams (matchup take, news brief, game recap) ─────────────── */

export function useAiOneShot(resetKey?: string) {
  const [turn, setTurn] = useState<Turn | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    abort.current?.abort();
    setTurn(null);
  }, [resetKey]);
  useEffect(() => () => abort.current?.abort(), []);

  const run = useCallback(async (req: ChatRequest) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    let t: Turn = { id: uid(), role: "assistant", content: "", streaming: true, startedAt: Date.now() };
    setTurn(t);
    try {
      for await (const ev of sse("/ai/chat", { ...req, messages: [] }, ctrl.signal)) {
        t = applyEvent(t, ev.event, ev.data);
        setTurn(t);
      }
    } catch (e) {
      // Stop already marked the turn; a different run may own the card now.
      if ((e as Error).name !== "AbortError") setTurn(finish({ ...t, error: (e as Error).message }));
      return;
    }
    setTurn(finish(t));
  }, []);

  const stop = useCallback(() => {
    abort.current?.abort();
    setTurn((t) => (t && t.streaming ? finish(t, true) : t));
  }, []);

  return { turn, run, stop };
}

/* ── Provider metadata ────────────────────────────────────────────────────── */

export interface ProviderInfo {
  id: string;
  name: string;
  kind: "openai" | "anthropic";
  local: boolean;
  needs_key: boolean;
  blurb: string;
  key_url: string;
  base_url: string;
  suggested: string[];
  configured: boolean;
  last4: string;
  available: boolean;
  model: string;
}

export interface AiSettings {
  provider: string;
  model: string;
  models: Record<string, string>;
  fallbacks: string[];
  custom_base_url: string;
  no_tools: string[];
  web_default: boolean;
  factcheck: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
}

export const TOOL_LABELS: Record<string, string> = {
  get_standings: "Standings",
  get_team_report: "Team report",
  get_team_games: "Game log",
  get_roster: "Roster",
  get_player: "Player",
  get_game_details: "Game",
  get_scoreboard: "Scoreboard",
  get_upcoming_games: "Schedule",
  compare_teams: "Compare",
  get_league_leaders: "Team leaders",
  get_player_leaders: "Player leaders",
  get_news: "News",
  get_injuries: "Injuries",
  get_game_previews: "Previews",
  get_team_history: "History",
  get_season_games: "Results",
  web_search: "Web search",
};
