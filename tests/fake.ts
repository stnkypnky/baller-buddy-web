/** A canned-response fetcher for the data layer: routes by URL substring. */
import { setFetcher } from "../web/src/backend/http";

export type Route = [match: string | RegExp, reply: unknown | ((url: string) => unknown)];

export function serve(routes: Route[]) {
  const calls: string[] = [];
  setFetcher(async (url) => {
    calls.push(url);
    for (const [m, reply] of routes) {
      if (typeof m === "string" ? url.includes(m) : m.test(url)) {
        const body = typeof reply === "function" ? (reply as (u: string) => unknown)(url) : reply;
        if (body instanceof Response) return body;
        return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
      }
    }
    return new Response("no route", { status: 404 });
  });
  return calls;
}

/** An nba.com result set from row objects. */
export function resultSet(rows: Record<string, unknown>[], headers = Object.keys(rows[0] ?? {})) {
  return { resultSets: [{ headers, rowSet: rows.map((r) => headers.map((h) => r[h] ?? null)) }] };
}
