/** Data access. The desktop app talked HTTP to a Python sidecar; here the same
 *  /api paths are served in-process by ../backend/router (which reaches the
 *  outside world through the site's Cloudflare proxy). */

import { artUrl } from "../backend/music";
import { proxied } from "../backend/http";
import { ApiError, handle, prewarm, stream } from "../backend/router";

export { ApiError };

/** What the Electron preload used to expose; kept so pages can feature-check. */
export interface DesktopBridge {
  pickFolder?(): Promise<string | null>;
  notify?(title: string, body: string, route?: string): void;
}

export const desktop: DesktopBridge | undefined = undefined;

prewarm();

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    // Round-trip through JSON like the HTTP API did, so callers can't mutate cached objects.
    const out = await handle(method, path, body);
    return (out === undefined ? out : JSON.parse(JSON.stringify(out))) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(500, (e as Error)?.message ?? String(e));
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: string }): Promise<T> {
  return call<T>(init?.method ?? "GET", path, init?.body ? JSON.parse(init.body) : undefined);
}

export const post = <T>(path: string, body?: unknown) => call<T>("POST", path, body);
export const put = <T>(path: string, body?: unknown) => call<T>("PUT", path, body ?? {});
export const del = <T>(path: string) => call<T>("DELETE", path);

/** URL for media elements (<img>/<audio>). */
export function mediaUrl(path: string): string {
  const art = /^\/music\/art\/([0-9a-f]{12})/.exec(path);
  return art ? artUrl(art[1]) : "";
}

export const logoUrl = (espnAbbr: string) => `/logos/${espnAbbr.toLowerCase()}.png`;

const HEADSHOT_URLS = {
  small: (pid: number) => `https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190/${pid}.png`,
  large: (pid: number) => `https://cdn.nba.com/headshots/nba/latest/1040x760/${pid}.png`,
};
export const headshotUrl = (pid: number, size: "small" | "large" = "small") => proxied(HEADSHOT_URLS[size](Math.trunc(pid)));

export interface SseEvent {
  event: string;
  data: any;
}

/** Streaming endpoints (chat, alert events), same event shapes as the desktop's SSE. */
export async function* sse(path: string, body: unknown, signal?: AbortSignal, _method: "POST" | "GET" = "POST"): AsyncGenerator<SseEvent> {
  yield* stream(path, body === undefined ? undefined : JSON.parse(JSON.stringify(body)), signal);
}

export function openExternal(url: string) {
  window.open(url, "_blank", "noopener");
}
