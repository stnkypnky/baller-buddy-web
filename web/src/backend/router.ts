/** The in-browser stand-in for the desktop's FastAPI sidecar (backend/app.py +
 *  backend/llm/api.py): the same /api paths and JSON shapes, served by
 *  function calls instead of HTTP, so the pages didn't have to change. */

import * as alerts from "./alerts";
import { cache } from "./cache";
import * as config from "./config";
import * as keys from "./llm/keys";
import * as providers from "./llm/providers";
import * as chatRouter from "./llm/router";
import * as usage from "./llm/usage";
import * as music from "./music";
import * as news from "./news";
import * as data from "./nba/data";
import * as services from "./nba/services";
import { getTeamName, teamMeta } from "./nba/teams";
import * as pulse from "./pulse";
import * as settings from "./settings";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// ── Startup prewarm (drives the splash screen) ───────────────────────────────

const warm = { ready: false, step: "Starting…", done: 0, total: 4 };
let prewarmed = false;

export function prewarm() {
  if (prewarmed) return;
  prewarmed = true;
  (async () => {
    const step = async (label: string, fn: () => Promise<unknown>) => {
      warm.step = label;
      try {
        await fn();
      } catch (e) {
        console.warn(`prewarm ${label}:`, e);
      }
      warm.done++;
    };
    await cache.prune();
    await step("Checking today's games…", async () => {
      const sb = await data.fetchScoreboard();
      if (sb.season_year) config.setEspnSeasonYear(sb.season_year);
    });
    const season = config.currentSeason();
    await step("Loading standings…", () => data.fetchAllStandings(season, cache));
    await step("Loading league stats…", () => services.leagueLeaders(season, cache));
    await step("Loading schedule…", () => data.fetchUpcomingGames(cache));
    warm.step = "Ready";
    warm.ready = true;
  })();
  // A slow or unreachable stats.nba.com shouldn't hold the splash for long;
  // the pages show their own loading states.
  setTimeout(() => (warm.ready = true), 15_000);
  alerts.engine.start();
}

// ── helpers ──────────────────────────────────────────────────────────────────

const SEASON_RE = /^\d{4}-\d{2}$/;

function seasonQ(q: URLSearchParams): string {
  const s = q.get("season");
  if (s === null || s === "") return config.currentSeason();
  if (!SEASON_RE.test(s)) throw new ApiError(422, "season must look like 2025-26");
  return s;
}

function team(id: string | number | null): number {
  const n = Number(id);
  if (!Number.isInteger(n) || !getTeamName(n)) throw new ApiError(404, `unknown team id ${id}`);
  return n;
}

function intQ(q: URLSearchParams, k: string): number {
  const v = q.get(k);
  if (v === null || !/^-?\d+$/.test(v)) throw new ApiError(422, `${k} must be an integer`);
  return parseInt(v, 10);
}

const pick = <T extends Record<string, unknown>>(body: unknown, allowed: string[]) =>
  Object.fromEntries(Object.entries((body ?? {}) as T).filter(([k, v]) => allowed.includes(k) && v !== null && v !== undefined));

type Handler = (m: RegExpMatchArray, q: URLSearchParams, body: any) => Promise<unknown> | unknown;
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, pattern: string, h: Handler) =>
  routes.push([method, new RegExp("^" + pattern.replace(/\{(\w+)\}/g, "(?<$1>[^/]+)") + "$"), h]);

// ── Meta ─────────────────────────────────────────────────────────────────────

route("GET", "/health", () => ({ ok: true, ...warm, season: config.currentSeason() }));

route("GET", "/meta", () => ({
  season: config.currentSeason(),
  seasons: config.allSeasons(),
  season_types: Object.entries(config.SEASON_TYPE_SLUGS).map(([slug, label]) => ({ slug, label })),
  default_team: config.DEFAULT_TEAM,
  teams: teamMeta(),
}));

// ── Team ─────────────────────────────────────────────────────────────────────

route("GET", "/team/{id}/overview", (m, q) => services.teamOverview(team(m.groups!.id), seasonQ(q), cache));
route("GET", "/team/{id}/roster", (m, q) => services.teamRoster(team(m.groups!.id), seasonQ(q), cache));
route("GET", "/team/{id}/absences", (m, q) => services.absenceNotes(team(m.groups!.id), seasonQ(q), cache));
route("GET", "/team/{id}/history", (m) => data.fetchHistory(team(m.groups!.id), cache));
route("GET", "/team/{id}/context", async (m, q) => ({ context: await services.teamContext(team(m.groups!.id), seasonQ(q), cache) }));
route("POST", "/team/{id}/refresh", async (m, q) => {
  await services.forceRefresh(cache, seasonQ(q), team(m.groups!.id));
  return { ok: true };
});
route("GET", "/player/{pid}/profile", (m, q) =>
  services.playerProfile(Number(m.groups!.pid), team(intQ(q, "team_id")), seasonQ(q), cache),
);

// ── League ───────────────────────────────────────────────────────────────────

route("GET", "/league/standings", (_m, q) => data.fetchAllStandings(seasonQ(q), cache));
route("GET", "/league/leaders", (_m, q) => services.leagueLeaders(seasonQ(q), cache));
route("GET", "/league/player-leaders", (_m, q) => services.playerLeaders(seasonQ(q), cache, ["true", "1"].includes(q.get("rookies") ?? "")));
route("GET", "/scores", (_m, q) => services.scores(seasonQ(q), cache));
route("GET", "/game/{gid}/story", (m) => {
  if (!/^\d{10}$/.test(m.groups!.gid)) throw new ApiError(422, "bad game id");
  return data.fetchGameBreakdown(m.groups!.gid, cache);
});
route("GET", "/game/{gid}/box", async (m) => {
  if (!/^\d{10}$/.test(m.groups!.gid)) throw new ApiError(422, "bad game id");
  try {
    return await data.fetchNbaBox(m.groups!.gid);
  } catch (e) {
    throw new ApiError(502, `nba.com box score unavailable: ${(e as Error).message}`);
  }
});
route("GET", "/compare", (_m, q) => {
  const a = intQ(q, "a");
  const b = intQ(q, "b");
  if (a === b) throw new ApiError(400, "pick two different teams");
  return services.compare(team(a), team(b), seasonQ(q), config.parseSeasonType(q.get("type") ?? "regular"), cache);
});

// ── Live (ESPN) ──────────────────────────────────────────────────────────────

route("GET", "/live", async (_m, q) => {
  const date = q.get("date");
  if (date && !/^\d{8}$/.test(date)) throw new ApiError(422, "date must be YYYYMMDD");
  try {
    return await data.fetchScoreboard(date);
  } catch (e) {
    throw new ApiError(502, `ESPN scoreboard unavailable: ${(e as Error).message}`);
  }
});
route("GET", "/live/{eid}/box", async (m) => {
  try {
    return await data.fetchEspnBox(m.groups!.eid);
  } catch (e) {
    throw new ApiError(502, `ESPN summary unavailable: ${(e as Error).message}`);
  }
});
route("GET", "/news", (_m, q) => data.fetchNews(q.get("team_id") ? getTeamName(q.get("team_id")) : "", cache));
route("GET", "/news/hub", (_m, q) => news.hub(q.get("team_id") ? team(q.get("team_id")) : null, cache));

// ── Music ────────────────────────────────────────────────────────────────────

route("GET", "/music/library", async () => {
  const s = await music.loadSettings();
  return { tracks: music.publicTracks(await music.getLibrary()), folders: s.folders, folder: s.folders[0] ?? "" };
});
route("POST", "/music/rescan", async () => ({ tracks: music.publicTracks(await music.scan(true)) }));
route("GET", "/music/settings", () => music.loadSettings());
route("PUT", "/music/settings", async (_m, _q, body) => {
  const patch = pick(body, Object.keys(music.DEFAULTS));
  if (Array.isArray(patch.folders)) {
    const out = await music.setFolders(patch.folders as string[]);
    delete patch.folders;
    await music.scan();
    if (!Object.keys(patch).length) return out;
  }
  return music.saveSettings(patch);
});

// ── Game Pulse ───────────────────────────────────────────────────────────────

route("GET", "/pulse/{eid}", async (m) => {
  if (!/^\d{1,12}$/.test(m.groups!.eid)) throw new ApiError(422, "bad event id");
  try {
    return await pulse.build(m.groups!.eid, cache);
  } catch (e) {
    if (e instanceof TypeError) throw new ApiError(404, `no game data for event ${m.groups!.eid}: ${e.message}`);
    throw new ApiError(502, `ESPN summary unavailable: ${(e as Error).message}`);
  }
});

// ── Alerts ───────────────────────────────────────────────────────────────────

route("GET", "/alerts/recent", () => alerts.engine.recent);
route("GET", "/alerts/settings", () => settings.get("alerts"));
route("PUT", "/alerts/settings", async (_m, _q, body) => {
  const patch: any = pick(body, Object.keys(settings.DEFAULTS.alerts));
  if (Array.isArray(patch.followed)) patch.followed = [...new Set<number>(patch.followed)].filter((t) => getTeamName(t));
  const out = await settings.update("alerts", patch);
  alerts.syncPush().catch(() => {});
  return out;
});
route("POST", "/alerts/simulate", (_m, q) => {
  const kind = (q.get("kind") ?? "close") as "tipoff" | "close" | "final" | "upset";
  if (!["tipoff", "close", "final", "upset"].includes(kind)) throw new ApiError(422, "bad kind");
  return alerts.engine.simulate(kind);
});
route("GET", "/alerts/push", () => alerts.pushStatus());
route("POST", "/alerts/push", async (_m, _q, body) => {
  if (body?.enabled === false) {
    await alerts.unsubscribePush();
    return alerts.pushStatus();
  }
  const r = await alerts.syncPush({ create: true, passcode: typeof body?.passcode === "string" ? body.passcode : undefined });
  if (r.reason === "passcode") throw new ApiError(401, body?.passcode ? "Wrong passcode" : "Enter the alerts passcode");
  if (r.reason === "server") throw new ApiError(503, "Background alerts aren't set up on the server yet (PUSH_PASSCODE)");
  if (!r.push) throw new ApiError(400, "Notifications weren't allowed, or this browser can't receive them");
  return alerts.pushStatus();
});
route("POST", "/alerts/push/test", async (_m, q) => ({ ok: await alerts.testPush((q.get("kind") as any) ?? "close") }));
route("PUT", "/ui", async (_m, _q, body) => {
  if (body?.team_id !== null && body?.team_id !== undefined && !getTeamName(body.team_id)) throw new ApiError(404, "unknown team");
  const prev = await settings.get("ui");
  const out = await settings.update("ui", { team_id: body?.team_id ?? null });
  if (prev.team_id !== out.team_id) alerts.syncPush().catch(() => {});
  return out;
});

// ── AI ───────────────────────────────────────────────────────────────────────

function provider(pid: string) {
  if (!(pid in providers.PROVIDERS)) throw new ApiError(404, `unknown provider '${pid}'`);
  return pid;
}

route("GET", "/ai/providers", async () => ({ providers: await providers.describe(), settings: await settings.get("ai") }));
route("GET", "/ai/local", async () => {
  const out: Record<string, boolean> = {};
  for (const [pid, p] of Object.entries(providers.PROVIDERS)) if (p.local) out[pid] = await providers.localStatus(pid);
  return out;
});
route("PUT", "/ai/keys/{pid}", async (m, _q, body) => {
  const pid = provider(m.groups!.pid);
  const key = String(body?.key ?? "");
  if (key.length < 8 || key.length > 400) throw new ApiError(422, "key must be 8-400 characters");
  await keys.setKey(pid, key);
  const test = await providers.validate(pid);
  return { ...(await keys.keyStatus(pid)), test };
});
route("DELETE", "/ai/keys/{pid}", async (m) => {
  const pid = provider(m.groups!.pid);
  await keys.deleteKey(pid);
  return keys.keyStatus(pid);
});
route("POST", "/ai/test/{pid}", (m) => providers.validate(provider(m.groups!.pid)));
route("GET", "/ai/models/{pid}", async (m, q) => {
  const pid = provider(m.groups!.pid);
  if (!(await providers.available(pid))) return { models: [], error: "not configured" };
  try {
    return { models: await providers.listModels(pid, q.get("refresh") === "true") };
  } catch (e) {
    return { models: [], error: String((e as Error).message ?? e).slice(0, 300) };
  }
});
route("PUT", "/ai/settings", async (_m, _q, body) => {
  const patch: any = pick(body, ["provider", "model", "fallbacks", "custom_base_url", "lmstudio_url", "ollama_url", "web_default", "factcheck", "model_size"]);
  if (patch.model_size !== undefined && !["auto", "small", "large"].includes(patch.model_size)) delete patch.model_size;
  if ("provider" in patch) provider(patch.provider);
  for (const k of ["custom_base_url", "lmstudio_url", "ollama_url"]) {
    if (patch[k] && !/^https?:\/\//.test(patch[k])) throw new ApiError(400, "URL must start with http:// or https://");
  }
  const ai = await settings.get("ai");
  if (body?.model !== undefined && body?.model !== null) {
    const pid = body.provider || ai.provider;
    patch.models = { ...ai.models, [pid]: body.model };
  }
  if (body?.reset_no_tools) patch.no_tools = [];
  return settings.update("ai", patch);
});
// estimated spend per provider and model since each provider's last reset
route("GET", "/ai/usage", () => usage.getUsage());
route("POST", "/ai/usage/{pid}/reset", async (m) => {
  const pid = provider(m.groups!.pid);
  await usage.resetUsage(pid);
  return usage.getUsage();
});

// ── dispatch ─────────────────────────────────────────────────────────────────

export async function handle(method: string, path: string, body?: unknown): Promise<unknown> {
  const u = new URL(path, "http://app");
  for (const [m, re, h] of routes) {
    if (m !== method) continue;
    const match = u.pathname.match(re);
    if (match) return h(match, u.searchParams, body);
  }
  throw new ApiError(404, "Not Found");
}

/** Streaming endpoints: /ai/chat and /events. */
export async function* stream(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<{ event: string; data: any }> {
  if (path === "/ai/chat") {
    yield* chatRouter.chatEvents((body ?? {}) as chatRouter.ChatRequest, cache, signal);
    return;
  }
  if (path === "/events") {
    yield { event: "hello", data: {} };
    const queue: alerts.AlertEvent[] = [];
    let wake: (() => void) | null = null;
    const off = alerts.engine.subscribe((ev) => {
      queue.push(ev);
      wake?.();
    });
    const aborted = new Promise<void>((r) => signal?.addEventListener("abort", () => r()));
    try {
      while (!signal?.aborted) {
        while (queue.length) yield { event: "alert", data: queue.shift() };
        await Promise.race([new Promise<void>((r) => (wake = r)), aborted]);
        wake = null;
      }
    } finally {
      off();
    }
    return;
  }
  throw new ApiError(404, "Not Found");
}
