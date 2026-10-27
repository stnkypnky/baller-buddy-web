/** App-wide constants and season helpers (port of backend/config.py). */

export const CACHE_TTL = 6 * 3600; // current-season data
export const PAST_SEASON_TTL = 30 * 24 * 3600; // finished seasons never change
export const EMPTY_TTL = 30 * 60; // retry empty results (e.g. no playoffs yet)

export const WEB_SEARCH_RESULTS = 5;
export const DEFAULT_TEAM = "Boston Celtics";
export const SEASON_COUNT = 6;

// Season-type views. NBA treats the Finals as part of "Playoffs" (no separate
// Finals split), so "Playoffs" covers the full postseason run including Finals.
export const SEASON_TYPE_REGULAR = "Regular Season";
export const SEASON_TYPE_PLAYOFFS = "Playoffs";
export const SEASON_TYPE_FULL = "Full Year"; // combined reg + playoffs (computed)
export type SeasonType = typeof SEASON_TYPE_REGULAR | typeof SEASON_TYPE_PLAYOFFS | typeof SEASON_TYPE_FULL;
export const SEASON_TYPE_VIEWS: SeasonType[] = [SEASON_TYPE_REGULAR, SEASON_TYPE_PLAYOFFS, SEASON_TYPE_FULL];
// URL-friendly aliases used by the API (?type=regular|playoffs|full)
export const SEASON_TYPE_SLUGS: Record<string, SeasonType> = {
  regular: SEASON_TYPE_REGULAR,
  playoffs: SEASON_TYPE_PLAYOFFS,
  full: SEASON_TYPE_FULL,
};

export const UPCOMING_DAYS = 14; // how far ahead the Scores page looks for scheduled games

export const ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
export const ESPN_SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary";
export const ESPN_NEWS_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news";

export const seasonStr = (startYear: number) => `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
export const seasonStartYear = (season: string) => parseInt(season.split("-")[0], 10);

/** NBA seasons tip off mid/late October; before Oct 15 the previous season is
 *  still the most recent one with data. */
export function dateSeasonStart(today = new Date()): number {
  const m = today.getMonth() + 1;
  const d = today.getDate();
  return m > 10 || (m === 10 && d >= 15) ? today.getFullYear() : today.getFullYear() - 1;
}

// ESPN reports the live season year (e.g. 2027 for 2026-27). When it's newer
// than the date rule, it wins (set by the startup prewarm).
let espnStartYear: number | null = null;

export function setEspnSeasonYear(endYear: unknown) {
  const n = parseInt(String(endYear), 10);
  if (Number.isFinite(n)) espnStartYear = n - 1;
}

export function currentSeason(): string {
  let start = dateSeasonStart();
  if (espnStartYear && espnStartYear > start) start = espnStartYear;
  return seasonStr(start);
}

export function allSeasons(): string[] {
  const start = seasonStartYear(currentSeason());
  return Array.from({ length: SEASON_COUNT }, (_, i) => seasonStr(start - i));
}

/** Cache TTL for data belonging to `season`. */
export const seasonTtl = (season: string) => (season === currentSeason() ? CACHE_TTL : PAST_SEASON_TTL);

/** False while the current season is still before April, when no playoff (or
 *  play-in) game can exist yet, so playoff fetches can be skipped. */
export function playoffsPossible(season: string, today = new Date()): boolean {
  if (season !== currentSeason()) return true;
  return today >= new Date(seasonStartYear(season) + 1, 3, 1);
}

/** Accepts a slug ('regular') or the full label; defaults to regular. */
export function parseSeasonType(value: string | null | undefined): SeasonType {
  if (value && (SEASON_TYPE_VIEWS as string[]).includes(value)) return value as SeasonType;
  return SEASON_TYPE_SLUGS[(value ?? "").toLowerCase()] ?? SEASON_TYPE_REGULAR;
}
