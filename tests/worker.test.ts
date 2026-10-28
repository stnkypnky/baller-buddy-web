/** The Worker's routing, proxy allowlist and push endpoints (offline). */

import { describe, expect, it } from "vitest";
import { route } from "../worker/index";

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
const post = (path: string, body: unknown) => req(path, { method: "POST", body: JSON.stringify(body) });

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

  it("validates, stores, updates and removes subscriptions", async () => {
    const env = mkEnv();
    const sub = { endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "a" } };
    expect((await route(post("/api/push/subscribe", { subscription: { endpoint: "http://x", keys: {} } }), env)).status).toBe(400);

    const prefs = { followed: [2, "13", -1, "x"], quiet_start: "23:00", quiet_end: "bogus", close: false };
    expect((await route(post("/api/push/subscribe", { subscription: sub, prefs, tz: "America/New_York" }), env)).status).toBe(200);
    const subs = JSON.parse(env.PUSH.data.get("subs"));
    const [stored] = Object.values(subs) as any[];
    expect(stored.prefs).toMatchObject({ followed: [2, 13], quiet_start: "23:00", quiet_end: "", close: false, tipoff: true });
    expect(stored.tz).toBe("America/New_York");

    // same payload again: no rewrite
    const before = env.PUSH.data.get("subs");
    await route(post("/api/push/subscribe", { subscription: sub, prefs, tz: "America/New_York" }), env);
    expect(env.PUSH.data.get("subs")).toBe(before);

    expect((await route(post("/api/push/test", { endpoint: "https://push.example/other" }), env)).status).toBe(404);
    expect((await route(post("/api/push/unsubscribe", { endpoint: sub.endpoint }), env)).status).toBe(200);
    expect(Object.keys(JSON.parse(env.PUSH.data.get("subs")))).toEqual([]);
  });
});
