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
  // Basketball history and background for the AI analyst. Wikimedia asks API
  // clients to identify themselves.
  "en.wikipedia.org": {
    headers: { "User-Agent": "BallerBuddy/3.0 (https://baller-buddy-web.sc8r91.workers.dev; NBA fan app)", "Api-User-Agent": "BallerBuddy/3.0" },
    edgeTtl: 86400,
  },
  // ESPN's other API host: the scoreboard fallback when one day's answer from
  // site.api is broken.
  "site.web.api.espn.com": { headers: { "User-Agent": BROWSER_UA }, edgeTtl: 0 },
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

/** YYYYMMDD on the NBA's (Eastern) calendar. */
const easternYmd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d).replaceAll("-", "");

/** Seconds the edge may keep this response. ESPN's scoreboard is the one ESPN
 *  call everything polls (Live, the ticker, tonight's finals, alerts, the AI),
 *  so every device shares one request per date: a few seconds for a day that
 *  may still be playing, a day for one that's long over. */
export function edgeTtl(target: URL, rule: HostRule, now = new Date()): number {
  if (target.hostname.endsWith(".espn.com") && target.pathname.endsWith("/scoreboard")) {
    const day = target.searchParams.get("dates") ?? "";
    // 30 hours back: late West-coast games of "yesterday" are over by then.
    return /^\d{8}$/.test(day) && day <= easternYmd(new Date(now.getTime() - 30 * 3600_000)) ? 86400 : 15;
  }
  return rule.edgeTtl;
}

/** A JSON body that's empty or cut off (doesn't end its outermost value).
 *  Cheaper than parsing: Workers on the free plan get ~10 ms of CPU. */
export function brokenJson(text: string): boolean {
  const t = text.trim();
  return !t || !/[}\]]$/.test(t);
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
  const ttl = edgeTtl(target, rule);

  const cacheKey = new Request(target.toString());
  if (edgeCache && ttl) {
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
  headers.set("X-Upstream-Status", String(upstream.status));

  // JSON is read whole, so an empty or truncated answer turns into a clear
  // error (and is never cached) instead of reaching the app as a broken 200.
  let body: BodyInit | null = upstream.body;
  if (upstream.ok && (upstream.headers.get("content-type") ?? "").includes("json")) {
    const text = await upstream.text();
    headers.set("X-Upstream-Length", String(text.length));
    if (brokenJson(text)) {
      headers.set("Cache-Control", "no-store");
      return new Response(`${text.trim() ? "incomplete" : "empty"} response from ${target.hostname} (HTTP ${upstream.status})`, { status: 502, headers });
    }
    body = text;
  }
  headers.set("Cache-Control", ttl && upstream.ok ? `public, max-age=${ttl}` : "no-store");
  const out = new Response(body, { status: upstream.status, headers });
  if (edgeCache && ttl && upstream.ok) await edgeCache.put(cacheKey, out.clone());
  return out;
}
