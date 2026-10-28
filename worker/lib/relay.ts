/** Pass-through for AI providers' OpenAI-compatible APIs, so the browser can
 *  call the ones that don't send CORS headers. The caller's Authorization
 *  header goes to the provider and nowhere else; nothing is logged or stored.
 *  Only the hosts below are reachable. */

export const AI_HOSTS = new Set([
  "api.openai.com",
  "generativelanguage.googleapis.com",
  "api.groq.com",
  "openrouter.ai",
  "api.x.ai",
  "api.mistral.ai",
  "api.deepseek.com",
  "api.together.xyz",
]);

const FORWARD = ["authorization", "content-type", "accept", "http-referer", "x-title"];

/** Handles `/api/ai-relay?url=<encoded target>` (GET or POST, streamed both ways). */
export async function handleRelay(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") return new Response("method not allowed", { status: 405 });
  let target: URL;
  try {
    target = new URL(new URL(request.url).searchParams.get("url") ?? "");
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (target.protocol !== "https:" || !AI_HOSTS.has(target.hostname)) return new Response("host not allowed", { status: 403 });
  const headers = new Headers();
  for (const h of FORWARD) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: request.method === "POST" ? await request.arrayBuffer() : undefined,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: `can't connect: ${(e as Error).message}` } }), { status: 502 });
  }
  const out = new Headers({ "Cache-Control": "no-store" });
  const ct = upstream.headers.get("content-type");
  if (ct) out.set("content-type", ct);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
