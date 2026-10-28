// @vitest-environment node
// (happy-dom drops "forbidden" request headers like Origin; the Worker sees them.)
/** The Worker's routing, proxy allowlist and push endpoints (offline). */

import { afterEach, describe, expect, it, vi } from "vitest";
import { route } from "../worker/index";
import { brokenJson, edgeTtl, handleProxy, proxyRule } from "../worker/lib/proxy";

class FakeKV {
  data = new Map<string, string>();
  async get(k: string, type?: string) {
    const v = this.data.get(k);
    return v === undefined ? null : type === "json" ? JSON.parse(v) : v;
  }
  async put(k: string, v: string) {
    this.data.set(k, v);
  }
}

const assets = { fetch: async () => new Response("<html>app</html>", { headers: { "content-type": "text/html" } }) };
const mkEnv = (extra: object = {}) => ({ ASSETS: assets, PUSH: new FakeKV(), VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", ...extra }) as any;
const req = (path: string, init?: RequestInit) => new Request(`https://app.test${path}`, init);
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => req(path, { method: "POST", body: JSON.stringify(body), headers });
const PASS = { "X-Push-Passcode": "letmein" };

describe("worker routes", () => {
  it("serves the app for everything but /api", async () => {
    for (const p of ["/", "/index.html", "/some/deep/link"]) expect(await (await route(req(p), mkEnv())).text()).toContain("app");
  });

  it("answers unknown /api paths with JSON 404, not the app", async () => {
    const r = await route(req("/api/nope"), mkEnv());
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ detail: "Not Found" });
  });

  it("only proxies allowlisted https hosts", async () => {
    const url = (u: string) => `/api/proxy?url=${encodeURIComponent(u)}`;
    expect((await route(req(url("https://example.com/")), mkEnv())).status).toBe(403);
    expect((await route(req(url("http://stats.nba.com/stats/x")), mkEnv())).status).toBe(403); // not https
    expect((await route(req("/api/proxy?url=nonsense"), mkEnv())).status).toBe(400);
    expect((await route(req(url("https://stats.nba.com/x"), { method: "POST" }), mkEnv())).status).toBe(405);
    expect((await route(req(`/api/ai-relay?url=${encodeURIComponent("https://evil.test/v1")}`, { method: "POST", body: "{}" }), mkEnv())).status).toBe(403);
  });

  it("reports push as unconfigured until keys exist", async () => {
    expect((await route(req("/api/push/key"), mkEnv())).status).toBe(503);
    const r = await route(req("/api/push/key"), mkEnv({ VAPID_PUBLIC_KEY: "BPUB" }));
    expect(await r.json()).toEqual({ key: "BPUB" });
    expect((await route(req("/api/push/subscribe"), mkEnv())).status).toBe(405); // GET
  });

  it("refuses calls from other websites", async () => {
    const proxy = `/api/proxy?url=${encodeURIComponent("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news")}`;
    expect((await route(req(proxy, { headers: { Origin: "https://evil.example" } }), mkEnv())).status).toBe(403);
    expect((await route(req(proxy, { headers: { "Sec-Fetch-Site": "cross-site" } }), mkEnv())).status).toBe(403);
    expect((await route(post("/api/push/subscribe", {}, { Origin: "https://evil.example" }), mkEnv({ PUSH_PASSCODE: "letmein" }))).status).toBe(403);
    // the app itself (same origin) gets through to the route
    expect((await route(req("/api/push/key", { headers: { Origin: "https://app.test", "Sec-Fetch-Site": "same-origin" } }), mkEnv({ VAPID_PUBLIC_KEY: "B" }))).status).toBe(200);
    // the app's pages themselves are never blocked
    expect((await route(req("/", { headers: { "Sec-Fetch-Site": "cross-site" } }), mkEnv())).status).toBe(200);
  });

  it("asks for the passcode before accepting a device", async () => {
    const sub = { subscription: { endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "a" } } };
    expect((await route(post("/api/push/subscribe", sub, PASS), mkEnv())).status).toBe(503); // not configured
    const env = mkEnv({ PUSH_PASSCODE: "letmein" });
    expect((await route(post("/api/push/subscribe", sub), env)).status).toBe(401);
    expect((await route(post("/api/push/subscribe", sub, { "X-Push-Passcode": "guess" }), env)).status).toBe(401);
    expect((await route(post("/api/push/test", { endpoint: "https://push.example/abc" }), env)).status).toBe(401);
    expect(env.PUSH.data.size).toBe(0); // nothing stored
    expect((await route(post("/api/push/subscribe", sub, PASS), env)).status).toBe(200);
  });

  it("validates, stores, updates and removes subscriptions", async () => {
    const env = mkEnv({ PUSH_PASSCODE: "letmein" });
    const sub = { endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "a" } };
    expect((await route(post("/api/push/subscribe", { subscription: { endpoint: "http://x", keys: {} } }, PASS), env)).status).toBe(400);

    const prefs = { followed: [2, "13", -1, "x"], quiet_start: "23:00", quiet_end: "bogus", close: false };
    expect((await route(post("/api/push/subscribe", { subscription: sub, prefs, tz: "America/New_York" }, PASS), env)).status).toBe(200);
    const subs = JSON.parse(env.PUSH.data.get("subs"));
    const [stored] = Object.values(subs) as any[];
    expect(stored.prefs).toMatchObject({ followed: [2, 13], quiet_start: "23:00", quiet_end: "", close: false, tipoff: true });
    expect(stored.tz).toBe("America/New_York");

    // same payload again: no rewrite
    const before = env.PUSH.data.get("subs");
    await route(post("/api/push/subscribe", { subscription: sub, prefs, tz: "America/New_York" }, PASS), env);
    expect(env.PUSH.data.get("subs")).toBe(before);

    expect((await route(post("/api/push/test", { endpoint: "https://push.example/other" }, PASS), env)).status).toBe(404);
    expect((await route(post("/api/push/unsubscribe", { endpoint: sub.endpoint }), env)).status).toBe(200);
    expect(Object.keys(JSON.parse(env.PUSH.data.get("subs")))).toEqual([]);
  });
});

describe("ESPN scoreboard through the proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  class FakeEdge {
    store = new Map<string, Response>();
    async match(r: Request) {
      return this.store.get(r.url)?.clone();
    }
    async put(r: Request, res: Response) {
      this.store.set(r.url, res);
    }
  }
  const BOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
  const ask = (dates: string, edge?: FakeEdge) =>
    handleProxy(new Request(`https://app.test/api/proxy?url=${encodeURIComponent(`${BOARD}?dates=${dates}`)}`), edge as any);
  const upstream = (body: string) => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (calls.push(u), new Response(body, { headers: { "content-type": "application/json" } }))));
    return calls;
  };

  it("keeps a long-finished day at the edge for a day, and a current one for seconds", () => {
    const now = new Date("2026-10-28T23:00:00Z"); // 7 PM Eastern
    const rule = proxyRule(new URL(BOARD))!;
    expect(edgeTtl(new URL(`${BOARD}?dates=20261026`), rule, now)).toBe(86400);
    expect(edgeTtl(new URL(`${BOARD}?dates=20261027`), rule, now)).toBe(86400);
    expect(edgeTtl(new URL(`${BOARD}?dates=20261028`), rule, now)).toBe(15);
    // just after midnight, last night's late games may still be on
    expect(edgeTtl(new URL(`${BOARD}?dates=20261027`), rule, new Date("2026-10-28T04:30:00Z"))).toBe(15);
    expect(edgeTtl(new URL("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news"), proxyRule(new URL(BOARD))!)).toBe(0);
  });

  it("serves every device one request per finished day", async () => {
    const calls = upstream('{"events":[]}');
    const edge = new FakeEdge();
    for (let i = 0; i < 3; i++) {
      const r = await ask("20261020", edge);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ events: [] });
    }
    expect(calls).toHaveLength(1);
  });

  it("turns an empty or cut-off answer into a clear 502 and never caches it", async () => {
    expect(brokenJson("")).toBe(true);
    expect(brokenJson('{"events":[{"id":1,"name":"Bos')).toBe(true);
    expect(brokenJson('{"events":[]}\n')).toBe(false);
    const edge = new FakeEdge();
    const calls = upstream("");
    const r = await ask("20261020", edge);
    expect(r.status).toBe(502);
    expect(await r.text()).toBe("empty response from site.api.espn.com (HTTP 200)");
    expect(r.headers.get("X-Upstream-Length")).toBe("0");
    upstream('{"events":[{"id":1,"name":"Bos');
    expect(await (await ask("20261020", edge)).text()).toContain("incomplete response");
    expect(edge.store.size).toBe(0);
    expect(calls).toHaveLength(1);
  });
});
