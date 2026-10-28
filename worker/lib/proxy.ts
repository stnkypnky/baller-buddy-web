/** GET forwarder for the data sources the browser can't call itself (no
 *  CORS, or they want browser-like headers). Only the hosts below are
 *  reachable, so the endpoint can't be used as an open proxy. Shared by the
 *  Pages Function (production) and the Vite dev server. */

const STATS_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0 Safari/537.36";

// nba_api's STATS_HEADERS (what the desktop and Android apps send).
const STATS_HEADERS: Record<string, string> = {
  "User-Agent": STATS_UA,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.5",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
  Pragma: "no-cache",
  "Cache-Control": "no-cache",
  "Sec-Ch-Ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Fetch-Dest": "empty",
};

interface HostRule {
  headers: Record<string, string>;
  /** Seconds the edge may keep a 200 (0 = never). */
  edgeTtl: number;
}

const RULES: Record<string, HostRule> = {
  "stats.nba.com": { headers: STATS_HEADERS, edgeTtl: 300 },
  "cdn.nba.com": { headers: { "User-Agent": BROWSER_UA, Referer: "https://www.nba.com/" }, edgeTtl: 86400 },
  "ak-static.cms.nba.com": { headers: { "User-Agent": BROWSER_UA, Referer: "https://www.nba.com/" }, edgeTtl: 86400 },
  "site.api.espn.com": { headers: { "User-Agent": BROWSER_UA }, edgeTtl: 0 },
  "a.espncdn.com": { headers: { "User-Agent": BROWSER_UA }, edgeTtl: 86400 },
  "www.espn.com": { headers: { "User-Agent": BROWSER_UA }, edgeTtl: 600 },
  "www.cbssports.com": { headers: { "User-Agent": BROWSER_UA }, edgeTtl: 600 },
  "sports.yahoo.com": { headers: { "User-Agent": BROWSER_UA }, edgeTtl: 600 },
  "www.hoopsrumors.com": { headers: { "User-Agent": BROWSER_UA }, edgeTtl: 600 },
  "basketball.realgm.com": { headers: { "User-Agent": BROWSER_UA }, edgeTtl: 600 },
  "html.duckduckgo.com": { headers: { "User-Agent": BROWSER_UA }, edgeTtl: 0 },
  // What ddgs sends: without the market cookies Bing drifts off-topic.
  "www.bing.com": {
    headers: {
      "User-Agent": BROWSER_UA,
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: "_EDGE_CD=m=en-us&u=en-us; _EDGE_S=mkt=en-us&ui=en-us",
    },
    edgeTtl: 0,
  },
};

// Not content-length: fetch has already undone any content-encoding.
const PASS_HEADERS = ["content-type", "last-modified", "etag"];

export function proxyRule(target: URL): HostRule | null {
  if (target.protocol !== "https:") return null;
  return RULES[target.hostname] ?? null;
}

/** Handles `GET /api/proxy?url=<encoded target>`. */
export async function handleProxy(request: Request, edgeCache?: Cache): Promise<Response> {
  if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
  const raw = new URL(request.url).searchParams.get("url") ?? "";
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("bad url", { status: 400 });
  }
  const rule = proxyRule(target);
  if (!rule) return new Response("host not allowed", { status: 403 });

  const cacheKey = new Request(target.toString());
  if (edgeCache && rule.edgeTtl) {
    const hit = await edgeCache.match(cacheKey);
    if (hit) return hit;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), { headers: rule.headers, redirect: "follow" });
  } catch (e) {
    return new Response(`upstream unreachable: ${(e as Error).message}`, { status: 502 });
  }
  const headers = new Headers();
  for (const h of PASS_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("Cache-Control", rule.edgeTtl && upstream.ok ? `public, max-age=${rule.edgeTtl}` : "no-store");
  headers.set("X-Upstream-Status", String(upstream.status));
  const out = new Response(upstream.body, { status: upstream.status, headers });
  if (edgeCache && rule.edgeTtl && upstream.ok) await edgeCache.put(cacheKey, out.clone());
  return out;
}
