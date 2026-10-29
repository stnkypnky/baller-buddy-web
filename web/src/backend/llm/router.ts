/** Chat orchestration (port of backend/llm/router.py): picks the
 *  provider/model, builds the system prompt, runs the adapter with tools, and
 *  falls back down the configured chain (or to the no-tools data-snapshot
 *  mode) when something fails. Yields the same SSE events the desktop
 *  backend streamed. */

import type { Cache } from "../cache";
import { currentSeason, seasonStartYear, seasonStr } from "../config";
import * as news from "../news";
import * as data from "../nba/data";
import * as services from "../nba/services";
import { findTeam, getTeamName } from "../nba/teams";
import * as pulse from "../pulse";
import * as settings from "../settings";
import * as anthropicAdapter from "./anthropicAdapter";
import * as nbaHistory from "../nba/history";
import { checkAnswer, correctionSheet, issueCount, tiedPlayers, type CheckOptions, type Stints } from "./factcheck";
import { findSeasons, fold, ground, namedPlayerData, playerIndex, shiftDay, type PlayerIndex } from "./grounding";
import * as openaiAdapter from "./openaiAdapter";
import { ToolsUnsupported, type ChatMessage } from "./openaiAdapter";
import * as providers from "./providers";
import * as tools from "./tools";

const MAX_HISTORY = 24;
const MAX_MSG_CHARS = 12000;
/** Tool results for local models: small context windows. */
const LOCAL_RESULT_CHARS = 4000;
const TODAY_LINES = 15;
/** Fact cards per question, and data carried from earlier turns (characters). */
const GROUND_BUDGET = { local: 3000, cloud: 7000 };
const EARLIER_BUDGET = { local: 3000, cloud: 6000 };
const DIGEST_CHARS = 2500;
const GROUND_TIMEOUT_MS = 20_000;
/** Fetching players' past teams for the fact-check. */
const STINTS_TIMEOUT_MS = 10_000;
/** Rewrites the fact-check asks for before it gives up and flags what's left. */
const MAX_REVISIONS = 2;
/** The user doubts an answer: fetch fresh and don't lean on earlier data. */
const RECHECK = /\b(re-?check|double[- ]check|are you sure|that'?s (wrong|not right|incorrect)|not (on|with) the|isn'?t on|no longer|wrong team)\b/i;

export const OFF_TOPIC_REPLY = "I'm Baller Buddy's NBA analyst — ask me anything about the NBA.";

const SCOPE_RULE =
  "SCOPE: you only answer questions about the NBA — its teams, players, games, stats, standings, " +
  "history, draft, trades, injuries, contracts, fantasy and betting angles on NBA games, and this app. " +
  "Short follow-ups (\"and him?\", \"why?\") belong to the NBA conversation they continue. " +
  "For anything else (other sports or leagues such as the WNBA, college or EuroLeague, coding, " +
  "general knowledge, chit-chat, homework, writing tasks), call no tools and reply with exactly: " +
  `"${OFF_TOPIC_REPLY}"`;

/** Appended to the model's copy of the user's latest message (never shown). */
const SCOPE_REMINDER = `\n\n(Reminder: answer only if this is about the NBA; otherwise reply exactly "${OFF_TOPIC_REPLY}")`;

const BASE_PERSONA =
  "You are the AI analyst inside Baller Buddy, an NBA app, and an expert on the game's whole history, from the 1940s to tonight — " +
  "sharp, specific and fun to read, like a great beat writer who also knows the numbers. Today is {today}.";

const CHAT_RULES =
  "Your training knowledge of rosters, trades, injuries and results is out of date. Only the DATA blocks, " +
  "TODAY'S NBA GAMES and tool results are true. Never name a player as on a team, in a game, or doing something " +
  "unless that data shows it, and never invent a number, score, record or play. If the data doesn't cover the " +
  "question, call a tool; if no tool can get it, say you don't have it. Call several tools when a question needs it; " +
  "never tell the user to look something up or name a tool to them.\n" +
  "Which tool to use:\n" +
  "- tonight's / a date's games, matchups, previews, predictions, who's favored → get_game_previews (one call covers every game)\n" +
  "- how a game went or is going → get_game_details with team=…\n" +
  "- a day's scores → get_scoreboard; a season's results, blowouts, head-to-head → get_season_games. " +
  "Report a day's games exactly as the data lists them: never add a game, change a score, or name a player the data doesn't show in that game\n" +
  "- a player's stats, bio, recent games → get_player; best players at a stat → get_player_leaders (rookies=true for rookies)\n" +
  "- team record, form, averages → get_team_report; roster and minutes → get_roster; game log → get_team_games\n" +
  "- where teams rank (offense, defense, pace…) → get_league_leaders (team=… for one team's rank); standings → get_standings\n" +
  "- seasons past, best seasons, trends → get_team_history; two teams side by side → compare_teams\n" +
  "- injuries → get_injuries; news → get_news (kind=rumors for trades); schedule → get_upcoming_games\n" +
  "- a past player, a player's prime or career, any past season of his → get_player_career; leaders of any past season → get_player_leaders(season=…)\n" +
  "- any past season (\"last year\", \"2023-24\", \"two seasons ago\") → the same tools with season=… (get_roster, get_player, get_team_report, " +
  "get_standings, get_team_games, get_season_games); never answer about a past season from this season's roster. " +
  "Two players were teammates only if the same team's roster that season lists both. A player's starts are in get_player_career (\"started\").\n" +
  "- two players from any eras, hypotheticals, all-time debates → compare_players; a team's past seasons → get_team_history\n" +
  "- history, accolades, playing style, rivalries, eras, rule changes → get_background; anything else → web_search\n" +
  "For hypotheticals and all-time debates: ground each player in his own numbers (his prime is his best 5-season stretch), " +
  "account for era (league scoring, pace, the 3-point line from 1979-80, hand-checking until 2004-05), then give a clear verdict and say it's your opinion.\n" +
  "For predictions: give the betting line first, then the app's estimate, form and injuries, and call them estimates.\n" +
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
    "You are a classic 1980s-90s network TV play-by-play announcer doing a 30-second 'catch me up' " +
    "for a fan who just tuned in. It will be read aloud, so write it to be heard: short punchy " +
    "sentences, the score said plainly, team nicknames and player last names, and era calls like " +
    "\"from downtown!\", \"with authority!\", \"puts this one on ice!\" where the data earns them. Using " +
    "ONLY the game data below, tell the story of the game so far: the score and situation now, " +
    "the key runs and momentum swings, who's carrying each team, and what to watch next. Build " +
    "to the biggest moment and end each big moment with an exclamation point; keep the rest calm. " +
    "6-8 sentences, accurate, no invented plays, no lists, no headings, no markdown, no emoji, " +
    "no abbreviations a voice would stumble on. If the game is final, call how it was won.",
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
  /** Data digests from earlier assistant turns of this chat, oldest first. */
  data_digests?: string[] | null;
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

async function viewLine(teamId: number | null | undefined, season: string, cache: Cache) {
  if (!teamId) return "";
  const name = getTeamName(teamId);
  const st: any = await data.fetchStandings(teamId, season, cache);
  const rec = st.wins !== undefined ? ` — ${st.wins}-${st.losses}, #${st.conf_rank} in the ${st.conference}` : "";
  const viewing = season === currentSeason() ? "" : ` The app is showing the ${season} season, but questions about any other season are fine: pass season=… to the tools.`;
  return (
    `\n\nThe user follows the ${name} (${season})${rec}.${viewing} When a question needs a team and names none ` +
    `("the game", "last night", "their next game", "our best player"), it means the ${name}: for their game call get_game_details with team="${name}". ` +
    `Questions about tonight's games, the league, other teams or players are not limited to the ${name}.`
  );
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
  let sys = `${persona}\n\n${SCOPE_RULE}\n\n${CHAT_RULES}${await viewLine(req.team_id, season, cache)}${await todayBlock(req.team_id)}`;
  if (!withTools) {
    const snapshot = [
      req.team_id ? await services.teamContext(req.team_id, season, cache).catch(() => "") : "",
      await tools.slatePreview(cache).catch(() => ""),
    ].filter(Boolean);
    if (snapshot.length) sys += "\n\nYou have no live tools for this model; answer from this data snapshot:\n\n" + snapshot.join("\n\n");
  }
  return sys;
}

/** Today's slate, one line per game, so "the game tonight" needs no lookup. */
async function todayBlock(teamId?: number | null) {
  const today = data.nbaToday();
  const named = (d: string) =>
    `${new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })} ${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  const season = currentSeason();
  const last = seasonStr(seasonStartYear(season) - 1);
  const dates =
    `\n\nDATES (NBA, Eastern): today ${named(today)}; yesterday ${named(shiftDay(today, -1))}; tomorrow ${named(shiftDay(today, 1))}. Tools take date=YYYY-MM-DD.` +
    `\nSEASONS: this season is ${season}; last season ("last year") was ${last}. Tools take season='YYYY-YY' and cover any season back to the 1940s.`;
  const sb = await data.fetchScoreboard().catch(() => null);
  if (!sb?.games.length) return dates;
  const mine = teamId ? findTeam(getTeamName(teamId))?.espn_id : undefined;
  const line = (g: data.LiveGame) => {
    const rec = (e: data.EspnSide) => (e.record ? ` (${e.record})` : "");
    const score =
      g.state === "pre"
        ? `${g.away.abbr}${rec(g.away)} @ ${g.home.abbr}${rec(g.home)}`
        : `${g.away.abbr} ${g.away.score} @ ${g.home.abbr} ${g.home.score}`;
    const state = g.state === "post" ? "Final" : g.state === "in" ? `LIVE ${g.status_text}` : g.status_text;
    const tag = mine && (g.home.espn_id === mine || g.away.espn_id === mine) ? " ← the user's team" : "";
    return `- ${score} · ${state} · game_id espn_${g.id}${tag}`;
  };
  const lines = sb.games.slice(0, TODAY_LINES).map(line);
  return (
    dates +
    `\n\nTODAY'S NBA GAMES (Eastern date ${sb.date.slice(0, 10) || data.nbaToday()}; scores as of this message. ` +
    `For previews and predictions call get_game_previews, for how a game went get_game_details):\n${lines.join("\n")}`
  );
}

/** Earlier turns' data, newest first, whole digests within `budget`. */
function earlierData(digests: string[] | null | undefined, budget: number) {
  const out: string[] = [];
  let used = 0;
  for (const d of [...(digests ?? [])].reverse()) {
    if (!d || used + d.length > budget) continue;
    out.unshift(d);
    used += d.length;
  }
  return out.join("\n\n");
}

/** What this turn knew, for the next turns: its fact cards and the start of each tool result. */
function digest(cards: string, toolTexts: string[]) {
  const body = [cards.replace(/^DATA FOR THIS QUESTION[^\n]*\n/, ""), ...toolTexts.map((t) => t.slice(0, 600))].filter(Boolean).join("\n");
  return body.length > DIGEST_CHARS ? body.slice(0, DIGEST_CHARS).replace(/\n[^\n]*$/, "") : body;
}

/** Check the players an answer names; on a problem, have the model rewrite it once. */
async function* factCheck(
  draft: string,
  dataText: string,
  idx: PlayerIndex,
  run: (history: ChatMessage[]) => AsyncGenerator<{ type: string; text?: string }>,
  history: ChatMessage[],
  opts: CheckOptions = {},
  /** Data fetched just for the check (players the answer named on its own). */
  extra = "",
): AsyncGenerator<SseEvent> {
  yield sse("status", { text: "Checking facts…" });
  let res = checkAnswer(draft, dataText, idx, opts);
  const checked = res.named.length + res.numbers;
  const issues = (r: typeof res) => [...r.problems.map((p) => p.player.name), ...r.claims.map((c) => c.text)];
  const names = new Set<string>();
  let fixed = 0;
  let current = draft;
  let convo = history;
  // Each rewrite is checked again: a model can repeat the mistake it was told about.
  for (let round = 0; round < MAX_REVISIONS && issueCount(res); round++) {
    const found = issues(res);
    for (const n of found) names.add(n);
    const sheet = correctionSheet(res.problems, res.claims) + (extra ? `\n\nDATA for players your answer named:\n${extra}` : "");
    convo = [...convo, { role: "assistant", content: current }, { role: "user", content: sheet }];
    let started = false;
    let text = "";
    try {
      for await (const ev of run(convo)) {
        if (ev.type !== "token" || !ev.text) continue;
        if (!started) {
          started = true;
          yield sse("revision", { names: found });
        }
        text += ev.text;
        yield sse("token", ev);
      }
    } catch (e) {
      console.warn("fact-check revision failed:", e);
    }
    if (!started || !text.trim()) {
      // No usable rewrite: keep the last answer, say what couldn't be confirmed.
      if (started) yield sse("revision_restore", { text: current });
      yield sse("factcheck", { checked, fixed, names: found, unresolved: true });
      return;
    }
    fixed += issueCount(res);
    current = text;
    res = checkAnswer(current, dataText, idx, opts);
  }
  if (issueCount(res)) yield sse("factcheck", { checked, fixed, names: issues(res), unresolved: true });
  else yield sse("factcheck", { checked, fixed, names: [...names] });
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

  // Grounding: the app finds what the question is about and puts current
  // facts in front of the model, so nothing depends on it choosing to look.
  let idx: PlayerIndex | null = null;
  let dataText = "";
  let cardText = "";
  /** Past seasons the question (or the one it follows up) is about. */
  let askedSeasons: string[] = [];
  if (mode === "chat") {
    const users = history.filter((m) => m.role === "user");
    const question = req.messages?.filter((m) => m.role === "user").at(-1)?.content ?? users.at(-1)!.content;
    const previous = users.at(-2)?.content ?? "";
    askedSeasons = findSeasons(question).length ? findSeasons(question) : findSeasons(previous);
    const local = !!providers.PROVIDERS[(await chain(req))[0][0]]?.local;
    const recheck = RECHECK.test(question);
    if (recheck) await cache.popWhere((k) => k.startsWith("roster_v5_") || k === "hub_injuries");
    yield sse("status", { text: "Looking up current data…" });
    try {
      idx = await playerIndex(cache);
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), GROUND_TIMEOUT_MS));
      const g = await Promise.race([
        ground(question, { followed: req.team_id, cache, budget: local ? GROUND_BUDGET.local : GROUND_BUDGET.cloud, previous, index: idx }),
        timeout,
      ]);
      const earlier = recheck ? "" : earlierData(req.data_digests, local ? EARLIER_BUDGET.local : EARLIER_BUDGET.cloud);
      cardText = g?.block ?? "";
      const block = [earlier && `DATA FROM EARLIER IN THIS CHAT (may be older than the data below):\n${earlier}`, cardText].filter(Boolean).join("\n\n");
      if (block) {
        const last = history.at(-1)!;
        history[history.length - 1] = { ...last, content: `${last.content}\n\n${block}` };
        dataText = block;
      }
      if (g?.cards.length) yield sse("grounding", { labels: g.cards.map((c) => c.label) });
    } catch (e) {
      console.warn("grounding failed:", e);
    }
  }

  // Small models drift off topic more easily: remind them on the turn itself.
  if (mode === "chat") {
    const last = history.at(-1)!;
    history[history.length - 1] = { ...last, content: last.content + SCOPE_REMINDER };
  }

  // Game ids the model has actually seen: the user's words, today's slate,
  // tool results. Small models otherwise make up plausible nba.com ids and
  // answer about whatever game that turns out to be.
  const seen = new Set<string>();
  const noteIds = (text: string) => {
    for (const m of text.matchAll(/\b(?:espn_)?(\d{9,10})\b/g)) seen.add(m[1]);
  };
  for (const m of history) noteIds(m.content);
  const viewTeam = req.team_id ? getTeamName(req.team_id) : "";
  const toolTexts: string[] = [];

  const toolRunner = (pid: string) => {
    const limit = providers.get(pid).local ? LOCAL_RESULT_CHARS : tools.MAX_RESULT_CHARS;
    return async (name: string, args: Record<string, unknown>): Promise<[string, string, boolean]> => {
      if (name === "get_game_details") {
        const id = String(args.game_id ?? "").trim().replace(/^espn[_:-]?/i, "");
        if (id && !seen.has(id)) {
          if (args.team) args = { team: args.team };
          else {
            const instead = viewTeam ? ` Pass team instead, e.g. team="${viewTeam}".` : " Pass the team instead.";
            return [JSON.stringify({ error: `game_id '${args.game_id}' isn't from any data in this conversation, so it's a guess.${instead}` }), "Skipped a guessed game id", false];
          }
        }
        // "the game" on a team page is that team's game
        if (!id && !args.team && viewTeam) args = { ...args, team: viewTeam };
      }
      const out = await tools.execute(name, args, cache, limit);
      noteIds(out[0]);
      toolTexts.push(`[${name}] ${out[0]}`);
      return out;
    };
  };

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
        noteIds(system);
        const specs = attemptTools ? tools.SPECS : null;
        let draft = "";
        for await (const ev of adapter(pid)(pid, model, system, history, specs, toolRunner(pid), signal)) {
          if (ev.type === "token" || ev.type === "reasoning" || ev.type === "tool_call") emitted = true;
          if (ev.type === "token") draft += ev.text;
          yield sse(ev.type, ev);
        }
        if (ai.factcheck !== false && draft.trim() && !draft.includes(OFF_TOPIC_REPLY)) {
          // Chat answers are checked against their fact cards and tool results;
          // one-shots (catch me up, matchup, news brief) against their own data.
          // A brief's headlines can be newer than the stats, so its team ties aren't checked.
          const facts = [system, dataText, req.context ?? "", ...toolTexts].join("\n");
          const index = idx ?? (await playerIndex(cache).catch(() => null));
          if (index) {
            // Players the answer brings up that nothing looked up yet: fetch their
            // data first, so they're checked on their numbers, not just flagged.
            const known = fold(facts);
            const missing = index.find(draft, 12).filter((p) => !known.includes(fold(p.name)));
            const extra = missing.length ? await namedPlayerData(missing, cache).catch(() => "") : "";
            // Who was on which team when, for players the answer ties to a team or a teammate.
            const tied = mode === "brief" ? [] : tiedPlayers(draft, index.find(draft, 12)).slice(0, 8);
            const stints = new Map<number, Stints>();
            const timeout = new Promise<void>((r) => setTimeout(r, STINTS_TIMEOUT_MS));
            await Promise.race([Promise.all(tied.map(async (p) => stints.set(p.pid, await nbaHistory.fetchStints(p.pid, cache).catch(() => ({}))))), timeout]);
            const opts: CheckOptions = { teams: mode !== "brief", seasons: askedSeasons, stints };
            yield* factCheck(draft, `${facts}\n${extra}`, index, (h) => adapter(pid)(pid, model, system, h, null, toolRunner(pid), signal), history, opts, extra);
          }
        }
        if (mode === "chat") yield sse("digest", { text: digest(cardText, toolTexts) });
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
