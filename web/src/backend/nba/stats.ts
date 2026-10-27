/** stats.nba.com, the way nba_api calls it: every parameter present and one
 *  request at a time, spaced 0.65 s apart (nba.com throttles clients that
 *  burst). The proxy adds nba_api's browser-like headers. */

import { getJson, type Params } from "../http";

export const STATS_BASE = "https://stats.nba.com/stats";
let SPACING_MS = 650;

/** Tests turn the spacing off. */
export function setStatsSpacing(ms: number) {
  SPACING_MS = ms;
}

let chain: Promise<unknown> = Promise.resolve();
let last = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One stats.nba.com call, serialized and spaced across the whole app. */
export function statsGet<T = any>(endpoint: string, params: Params, timeout = 30): Promise<T> {
  const run = async () => {
    const wait = SPACING_MS - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    try {
      return await getJson<T>(`${STATS_BASE}/${endpoint}`, { params, timeout });
    } finally {
      last = Date.now();
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

export type Row = Record<string, any>;

/** Rows of result set `index` ("resultSets" list, or the single "resultSet"),
 *  as objects keyed by column name. */
export function resultSet(j: any, index = 0): Row[] {
  const set = Array.isArray(j?.resultSets) ? j.resultSets[index] : j?.resultSet;
  if (!set) return [];
  const headers: string[] = set.headers ?? [];
  return (set.rowSet ?? []).map((r: unknown[]) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

export function columns(j: any, index = 0): string[] {
  const set = Array.isArray(j?.resultSets) ? j.resultSets[index] : j?.resultSet;
  return set?.headers ?? [];
}

/** float(x) with Python-ish tolerance: null/NaN/garbage -> fallback. */
export function num(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

export const int = (v: unknown, fallback = 0) => Math.trunc(num(v, fallback));

/** float(v) or null when it isn't a number. */
export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Python's round(x, n) (round-half-even on the decimal value). */
export function round(x: number, n = 0): number {
  const f = 10 ** n;
  const y = x * f;
  const r = Math.round(y);
  // exact .5 ties go to even, like Python
  const out = Math.abs(y % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
  return out / f + 0; // + 0 turns -0 into 0
}

// nba_api's default parameter set for the league dash endpoints.
export function dashParams(season: string, measure: string, extra: Params = {}): Params {
  return {
    LastNGames: "0", MeasureType: measure, Month: "0", OpponentTeamID: 0, PaceAdjust: "N",
    PerMode: "PerGame", Period: "0", PlusMinus: "N", Rank: "N", Season: season,
    SeasonType: "Regular Season", Conference: "", DateFrom: "", DateTo: "", Division: "",
    GameScope: "", GameSegment: "", LeagueID: "00", Location: "", Outcome: "",
    PORound: "", PlayerExperience: "", PlayerPosition: "", SeasonSegment: "",
    ShotClockRange: "", StarterBench: "", TwoWay: "", VsConference: "", VsDivision: "",
    ...extra,
  };
}
