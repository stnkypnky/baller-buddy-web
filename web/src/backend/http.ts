/** HTTP for the in-browser data layer. Sources without CORS go through the
 *  site's own /api/proxy (a Cloudflare Pages Function, or the Vite dev
 *  middleware), which adds the headers they expect. */

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Params = Record<string, string | number | boolean | null | undefined>;

export function withParams(url: string, params?: Params): string {
  if (!params) return url;
  const u = new URL(url);
  // nba.com wants every parameter present, even empty ones; null means "leave out".
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) u.searchParams.append(k, String(v));
  return u.toString();
}

/** The proxied URL for `url` (also usable as an <img> src). */
export const proxied = (url: string) => `/api/proxy?url=${encodeURIComponent(url)}`;

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

// Tests swap this for canned responses.
let fetcher: Fetcher = (url, init) => fetch(proxied(url), init);

export function setFetcher(f: Fetcher) {
  fetcher = f;
}

export async function httpGet(url: string, opts: { params?: Params; timeout?: number; signal?: AbortSignal } = {}) {
  const full = withParams(url, opts.params);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`timed out after ${opts.timeout ?? 20}s`)), (opts.timeout ?? 20) * 1000);
  opts.signal?.addEventListener("abort", () => ctrl.abort(opts.signal!.reason));
  try {
    const r = await fetcher(full, { signal: ctrl.signal });
    if (!r.ok) {
      const body = (await r.text().catch(() => "")).slice(0, 200);
      throw new HttpError(r.status, `HTTP ${r.status} from ${new URL(full).host}: ${body}`);
    }
    return r;
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson<T = any>(url: string, opts: Parameters<typeof httpGet>[1] = {}): Promise<T> {
  return (await httpGet(url, opts)).json() as Promise<T>;
}

export async function getText(url: string, opts: Parameters<typeof httpGet>[1] = {}): Promise<string> {
  return (await httpGet(url, opts)).text();
}
