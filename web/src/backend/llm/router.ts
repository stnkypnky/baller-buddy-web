/** Chat orchestration (port of backend/llm/router.py): picks the
 *  provider/model, builds the system prompt, runs the adapter with tools, and
 *  falls back down the configured chain (or to the no-tools data-snapshot
 *  mode) when something fails. Yields the same SSE events the desktop
 *  backend streamed. */

import type { Cache } from "../cache";
import { currentSeason } from "../config";
import * as news from "../news";
import * as data from "../nba/data";
import * as services from "../nba/services";
import { getTeamName } from "../nba/teams";
import * as pulse from "../pulse";
import * as settings from "../settings";
import * as anthropicAdapter from "./anthropicAdapter";
import * as openaiAdapter from "./openaiAdapter";
import { ToolsUnsupported, type ChatMessage } from "./openaiAdapter";
import * as providers from "./providers";
import * as tools from "./tools";

const MAX_HISTORY = 24;
const MAX_MSG_CHARS = 12000;

const BASE_PERSONA =
  "You are the AI analyst inside Baller Buddy, an NBA app — sharp, specific, " +
  "and fun to read, like a great beat writer who also knows the numbers. Today is {today}.";

const CHAT_RULES =
  "Ground every claim in data. Use your tools to fetch real stats (standings, team reports, " +
  "rosters, players, team and player leaderboards, game logs, box scores, schedules, news, " +
  "web search) instead of guessing, " +
  "and call several tools when a question needs it. Never invent numbers. " +
  "If one tool's data doesn't cover part of the question (a player's line, say), call the tool " +
  "that does; never tell the user to look it up or name a tool to them. " +
  "Format answers in Markdown: a one-line takeaway first, then short sections or bullets; " +
  "use a compact table when comparing several numbers. Keep it tight unless asked for depth.";

const MODE_PROMPTS: Record<string, string> = {
  matchup:
    "You are an expert NBA analyst. Given two teams' season stats and their head-to-head " +
    "results, break down the matchup: each team's biggest edge, the key statistical factors, " +
    "and which team you'd favor and why. Be concise, specific, and use the numbers provided. " +
    "Use Markdown with short headed sections.",
  brief:
    "You are an NBA news editor. Turn the headlines below into a crisp briefing: exactly five " +
    "bullets, most important first, each one sentence with the key fact bolded. Then one line " +
    "starting with **Watch:** naming the storyline to follow. No preamble.",
  recap:
    "You are a lively TV play-by-play broadcaster doing a 30-second 'catch me up' for a fan " +
    "who just tuned in. Using ONLY the game data below, tell the story of the game so far: the " +
    "score and situation now, the key runs and momentum swings, who's carrying each team, and " +
    "what to watch next. 4-6 short sentences, energetic but accurate, no lists, no headings, no " +
    "markdown. If the game is final, recap how it was won.",
};

// Appended to the brief prompt for the News tab the user is on.
const BRIEF_FOCUS: Record<string, string> = {
  team:
    "This briefing is for the {team} page: cover only the {team} — recent results and " +
    "storylines, injuries and what they mean for the rotation, front-office moves.",
  league: "This briefing is for the league-wide news feed: cover the biggest storylines across the NBA, not any single team.",
  rumors:
    "This briefing is for the Trades & Rumors page: lead with the most significant " +
    "reports, say who reported each one, and separate firm reports (agreed deals, " +
    "signings) from speculation and 'interest'. Do not present rumors as fact.",
  video: "This briefing is for the Video page: say what's worth watching and why, naming the players and moments in the clips.",
  injuries:
    "This briefing is for the league injury report: lead with the most impactful " +
    "absences (stars, long-term, status changes), name the team and the expected " +
    "return when given, and flag what it means for those teams. If the user's team " +
    "is listed, give it a bullet.",
};

export interface ChatRequest {
  messages?: { role: string; content: string }[];
  provider?: string | null;
  model?: string | null;
  team_id?: number | null;
  season?: string | null;
  page?: string | null;
  mode?: "chat" | "matchup" | "brief" | "recap";
  focus?: string | null;
  context?: string | null;
  web?: boolean;
  event_id?: string | null;
}

export interface SseEvent {
  event: string;
  data: any;
}

const sse = (event: string, data: unknown): SseEvent => ({ event, data });

function cleanHistory(messages: ChatRequest["messages"]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of (messages ?? []).slice(-MAX_HISTORY)) {
    if ((m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim()) {
      out.push({ role: m.role, content: m.content.slice(0, MAX_MSG_CHARS) });
    }
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

async function viewLine(teamId: number | null | undefined, season: string, page: string | null | undefined, cache: Cache) {
  if (!teamId) return "";
  const name = getTeamName(teamId);
  const st: any = await data.fetchStandings(teamId, season, cache);
  const rec = st.wins !== undefined ? ` — ${st.wins}-${st.losses}, #${st.conf_rank} in the ${st.conference}` : "";
  return `\n\nThe user is looking at the ${name} (${season})${rec} on the ${page || "Overview"} page. Assume questions are about this team unless they say otherwise.`;
}

export async function buildSystem(req: ChatRequest, cache: Cache, withTools: boolean) {
  const season = req.season || currentSeason();
  const persona = BASE_PERSONA.replace("{today}", tools.todayLine());
  const mode = req.mode || "chat";
  if (mode !== "chat") {
    let extra = "";
    if (mode === "brief" && req.focus && news.BRIEF_FOCUSES.includes(req.focus)) {
      const team = req.team_id ? getTeamName(req.team_id) : "";
      const focus = team || req.focus !== "team" ? req.focus : "league";
      extra = " " + BRIEF_FOCUS[focus].replaceAll("{team}", team);
    }
    return `${persona}\n\n${MODE_PROMPTS[mode]}${extra}`;
  }
  let sys = `${persona}\n\n${CHAT_RULES}${await viewLine(req.team_id, season, req.page, cache)}`;
  if (!withTools && req.team_id) {
    sys += "\n\nYou have no live tools for this model; answer from this data snapshot:\n\n" + (await services.teamContext(req.team_id, season, cache));
  }
  return sys;
}

async function chain(req: ChatRequest): Promise<[string, string][]> {
  const ai = await settings.get("ai");
  const firstPid = req.provider || ai.provider;
  const firstModel = req.model || (firstPid === ai.provider ? ai.model : "") || ai.models[firstPid] || "";
  const out: [string, string][] = [[firstPid, firstModel]];
  for (const spec of ai.fallbacks ?? []) {
    const s = String(spec);
    const i = s.indexOf(":");
    const [pid, model] = i >= 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, ""];
    if (pid in providers.PROVIDERS && !out.some(([p, m]) => p === pid && m === model)) out.push([pid, model]);
  }
  return out;
}

async function resolveModel(pid: string, model: string) {
  if (model) return model;
  if (pid === "lmstudio") return "local-model"; // LM Studio routes this to the loaded model
  const p = providers.get(pid);
  if (p.suggested?.length) return p.suggested[0];
  const models = await providers.listModels(pid);
  if (!models.length) throw new Error("no models available");
  return models[0].id;
}

/** Data for one-shot modes that the app gathers itself. */
async function serverContext(req: ChatRequest, cache: Cache) {
  if (req.mode === "brief") {
    const teamId = req.team_id;
    return news.headlinesBrief(await news.hub(teamId, cache), teamId ? getTeamName(teamId) : "", req.focus);
  }
  if (req.mode === "recap" && req.event_id) return pulse.recapContext(req.event_id);
  return "";
}

const adapter = (pid: string) => (providers.get(pid).kind === "anthropic" ? anthropicAdapter.stream : openaiAdapter.stream);

function friendly(e: unknown): string {
  const s = String((e as Error)?.message ?? e);
  const low = s.toLowerCase();
  const status = (e as any)?.status;
  if (status === 401 || s.includes("401") || low.includes("invalid api key") || low.includes("authentication")) return "invalid API key";
  if (status === 429 || s.includes("429") || low.includes("rate limit")) return "rate limited";
  if (e instanceof TypeError || low.includes("connection") || low.includes("connect") || low.includes("failed to fetch")) return "can't connect";
  if ((status === 404 || s.includes("404")) && low.includes("model")) return "model not found";
  return s.slice(0, 160);
}

/** The events of one chat turn. */
export async function* chatEvents(req: ChatRequest, cache: Cache, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const mode = req.mode || "chat";
  let history = cleanHistory(req.messages);
  if (!req.context) {
    try {
      req.context = await serverContext(req, cache);
    } catch (e) {
      yield sse("error", { message: `Couldn't gather data for this request: ${(e as Error)?.message ?? e}` });
      return;
    }
  }
  // one-shot modes (matchup/brief/recap) carry their data as the user turn
  if (req.context) history = [{ role: "user", content: req.context.slice(0, 60000) }];
  if (!history.length) {
    yield sse("error", { message: "Nothing to answer." });
    return;
  }

  // Optional live web context for this turn (the 🌐 toggle), on top of tools.
  if (req.web && mode === "chat") {
    yield sse("status", { text: "Searching the web…" });
    const last = history.at(-1)!;
    const [text, n] = await data.webSearch(last.content.slice(0, 300));
    if (n) {
      history[history.length - 1] = {
        role: "user",
        content: `${last.content}\n\n[Live web results — prefer these for breaking news, injuries and trades; cite sources]\n${text}`,
      };
      yield sse("status", { text: `Added ${n} web result${n > 1 ? "s" : ""}` });
    }
  }

  const runTool = (name: string, args: Record<string, unknown>) => tools.execute(name, args, cache);

  const ai = await settings.get("ai");
  const tried: string[] = [];
  for (let [pid, model] of await chain(req)) {
    const name = providers.PROVIDERS[pid]?.name ?? pid;
    if (!(pid in providers.PROVIDERS) || !(await providers.available(pid))) {
      tried.push(`${name} (not set up)`);
      continue;
    }
    try {
      model = await resolveModel(pid, model);
    } catch (e) {
      tried.push(`${name} (${(e as Error)?.message ?? e})`);
      continue;
    }

    const useTools = mode === "chat" && !(ai.no_tools ?? []).includes(`${pid}:${model}`);
    let emitted = false;
    for (const attemptTools of useTools ? [true, false] : [false]) {
      yield sse("meta", { provider: pid, provider_name: name, model, tools: attemptTools });
      try {
        const system = await buildSystem(req, cache, attemptTools);
        const specs = attemptTools ? tools.SPECS : null;
        for await (const ev of adapter(pid)(pid, model, system, history, specs, runTool, signal)) {
          if (ev.type === "token" || ev.type === "reasoning" || ev.type === "tool_call") emitted = true;
          yield sse(ev.type, ev);
        }
        yield sse("done", { provider: pid, model });
        return;
      } catch (e) {
        if (signal?.aborted) throw e;
        if (e instanceof ToolsUnsupported) {
          const noTools = [...new Set([...(ai.no_tools ?? []), `${pid}:${model}`])].sort();
          await settings.update("ai", { no_tools: noTools });
          yield sse("status", { text: `${model} can't use tools — answering from a data snapshot` });
          continue;
        }
        console.warn(`chat via ${pid}/${model} failed:`, e);
        const msg = friendly(e);
        if (emitted) {
          yield sse("error", { message: `${name} stopped mid-answer: ${msg}` });
          return;
        }
        tried.push(`${name} (${msg})`);
        yield sse("status", { text: `${name} unavailable: ${msg}` });
        break;
      }
    }
  }

  yield sse("error", {
    message:
      "No AI provider could answer. " +
      (tried.length ? `Tried: ${tried.join("; ")}. ` : "") +
      "Add an API key or start LM Studio in Settings → AI Providers.",
  });
}
