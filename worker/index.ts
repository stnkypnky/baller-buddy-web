/** The Cloudflare Worker behind the app: serves the built PWA (static assets),
 *  the /api routes the browser can't do itself (data proxy, AI relay, Web Push
 *  subscriptions), and a 1-minute cron that sends live-game alerts. */

import { runOnce } from "./alerts";
import { handleProxy } from "./lib/proxy";
import { type PushEnv } from "./lib/push";
import { pushKey, pushSubscribe, pushTest, pushUnsubscribe } from "./lib/pushRoutes";
import { handleRelay } from "./lib/relay";

interface Env extends PushEnv {
  ASSETS: Fetcher;
}

const notFound = () => new Response(JSON.stringify({ detail: "Not Found" }), { status: 404, headers: { "content-type": "application/json" } });
const wrongMethod = () => new Response("method not allowed", { status: 405 });

export async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const post = request.method === "POST";
  switch (pathname) {
    case "/api/proxy":
      return handleProxy(request, typeof caches !== "undefined" ? (caches as any).default : undefined);
    case "/api/ai-relay":
      return handleRelay(request);
    case "/api/push/key":
      return request.method === "GET" ? pushKey(env) : wrongMethod();
    case "/api/push/subscribe":
      return post ? pushSubscribe(request, env) : wrongMethod();
    case "/api/push/unsubscribe":
      return post ? pushUnsubscribe(request, env) : wrongMethod();
    case "/api/push/test":
      return post ? pushTest(request, env) : wrongMethod();
  }
  if (pathname.startsWith("/api/")) return notFound();
  return env.ASSETS.fetch(request);
}

export default {
  fetch: route,

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runOnce(env).then((r) => r.alerts && console.log("alerts", r), (e) => console.warn("alert run failed:", e)));
  },
} satisfies ExportedHandler<Env>;
