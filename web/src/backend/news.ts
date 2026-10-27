/** News & Links hub (port of backend/news.py): ESPN news (with images/video),
 *  RSS from major outlets, trade-rumor wires, ESPN injury report, and curated
 *  team links. */

import type { Cache } from "./cache";
import { currentSeason, ESPN_NEWS_URL, seasonStartYear } from "./config";
import { getJson, getText } from "./http";
import { ESPN_ABBR, ESPN_ID_TO_NAME, ESPN_IDS, getTeamName } from "./nba/teams";

const FEED_TTL = 15 * 60;
const ESPN_INJURIES_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries";

export const FEEDS: Record<string, [string, "story" | "rumor"]> = {
  ESPN: ["https://www.espn.com/espn/rss/nba/news", "story"],
  "CBS Sports": ["https://www.cbssports.com/rss/headlines/nba/", "story"],
  "Yahoo Sports": ["https://sports.yahoo.com/nba/rss.xml", "story"],
  "Hoops Rumors": ["https://www.hoopsrumors.com/feed", "rumor"],
  RealGM: ["https://basketball.realgm.com/rss/wiretap/0/0.xml", "rumor"],
};

const BBREF: Record<string, string> = {
  "Atlanta Hawks": "ATL", "Boston Celtics": "BOS", "Brooklyn Nets": "BRK",
  "Charlotte Hornets": "CHO", "Chicago Bulls": "CHI", "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL", "Denver Nuggets": "DEN", "Detroit Pistons": "DET",
  "Golden State Warriors": "GSW", "Houston Rockets": "HOU", "Indiana Pacers": "IND",
  "Los Angeles Clippers": "LAC", "Los Angeles Lakers": "LAL", "Memphis Grizzlies": "MEM",
  "Miami Heat": "MIA", "Milwaukee Bucks": "MIL", "Minnesota Timberwolves": "MIN",
  "New Orleans Pelicans": "NOP", "New York Knicks": "NYK", "Oklahoma City Thunder": "OKC",
  "Orlando Magic": "ORL", "Philadelphia 76ers": "PHI", "Phoenix Suns": "PHO",
  "Portland Trail Blazers": "POR", "Sacramento Kings": "SAC", "San Antonio Spurs": "SAS",
  "Toronto Raptors": "TOR", "Utah Jazz": "UTA", "Washington Wizards": "WAS",
};

const SUBREDDITS: Record<string, string> = {
  "Atlanta Hawks": "AtlantaHawks", "Boston Celtics": "bostonceltics", "Brooklyn Nets": "GoNets",
  "Charlotte Hornets": "CharlotteHornets", "Chicago Bulls": "chicagobulls",
  "Cleveland Cavaliers": "clevelandcavs", "Dallas Mavericks": "Mavericks",
  "Denver Nuggets": "denvernuggets", "Detroit Pistons": "DetroitPistons",
  "Golden State Warriors": "warriors", "Houston Rockets": "rockets", "Indiana Pacers": "pacers",
  "Los Angeles Clippers": "LAClippers", "Los Angeles Lakers": "lakers",
  "Memphis Grizzlies": "memphisgrizzlies", "Miami Heat": "heat", "Milwaukee Bucks": "MkeBucks",
  "Minnesota Timberwolves": "timberwolves", "New Orleans Pelicans": "NOLAPelicans",
  "New York Knicks": "NYKnicks", "Oklahoma City Thunder": "Thunder", "Orlando Magic": "OrlandoMagic",
  "Philadelphia 76ers": "sixers", "Phoenix Suns": "suns", "Portland Trail Blazers": "ripcity",
  "Sacramento Kings": "kings", "San Antonio Spurs": "NBASpurs", "Toronto Raptors": "torontoraptors",
  "Utah Jazz": "UtahJazz", "Washington Wizards": "washingtonwizards",
};

// nba.com team slugs differ from nicknames for a few teams
const NBA_SLUG_OVERRIDES: Record<string, string> = { "Philadelphia 76ers": "sixers", "Portland Trail Blazers": "blazers" };

// extra words that identify a team in headlines
const ALIASES: Record<string, string[]> = {
  "Philadelphia 76ers": ["Sixers"], "Portland Trail Blazers": ["Blazers"],
  "Minnesota Timberwolves": ["Wolves"], "Los Angeles Clippers": ["Clips"],
  "Golden State Warriors": ["Dubs"], "Oklahoma City Thunder": ["OKC"],
};

// Sportsbook sign-up promos ride along in some feeds; they aren't news.
const PROMO = /\b(promo|bonus) code|bonus bets?\b|new (player|user) offer|sign-?up bonus/i;

export interface Article {
  id: string;
  title: string;
  summary: string;
  url: string;
  image: string;
  source: string;
  byline: string;
  published: string;
  type: string;
  premium: boolean;
  teams: string[];
}

export interface InjuryRow {
  player: string;
  position: string;
  headshot: string;
  status: string;
  injury: string;
  return_date: string;
  comment: string;
  date: string;
}

function unescapeHtml(s: string): string {
  if (typeof DOMParser !== "undefined") {
    return new DOMParser().parseFromString(`<!doctype html><body>${s}`, "text/html").body.textContent ?? "";
  }
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

export function clean(text: string | null | undefined, limit = 320): string {
  // Tags out first, then entities (so an escaped "&lt;b&gt;" stays text).
  let t = unescapeHtml((text ?? "").replace(/<[^>]+>/g, " ").replace(/&(?![a-z#0-9]+;)/gi, "&amp;"));
  t = t.replace(/\s+/g, " ").trim();
  return t.length > limit ? t.slice(0, limit).replace(/\s+\S*$/, "") + "…" : t;
}

/** Python's datetime.isoformat() for a UTC time: 2026-10-27T15:06:08+00:00. */
function isoUtc(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export function teamTerms(teamName: string): string[] {
  const nickname = teamName !== "Portland Trail Blazers" ? teamName.split(" ").at(-1)! : "Trail Blazers";
  return [nickname, ...(ALIASES[teamName] ?? [])];
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function mentions(a: Pick<Article, "title" | "summary">, terms: string[]): boolean {
  const hay = `${a.title} ${a.summary}`.toLowerCase();
  return terms.some((t) => new RegExp(`\\b${escRe(t.toLowerCase())}\\b`).test(hay));
}

// ── sources ──────────────────────────────────────────────────────────────────

const ESPN_TYPES: Record<string, string> = { Media: "video", Recap: "recap", Preview: "preview" };

async function espn(teamName: string): Promise<Article[]> {
  const j = await getJson(ESPN_NEWS_URL, { params: { limit: 40, team: ESPN_IDS[teamName] ?? null }, timeout: 10 });
  return ((j.articles ?? []) as any[]).map((a) => {
    const links = a.links ?? {};
    const imgs = a.images ?? [];
    return {
      id: `espn-${a.id}`,
      title: a.headline ?? "",
      summary: clean(a.description ?? ""),
      url: links.web?.href || links.mobile?.href || "",
      image: imgs.length ? (imgs[0].url ?? "") : "",
      source: "ESPN",
      byline: a.byline ?? "",
      published: a.published ?? "",
      type: ESPN_TYPES[a.type] ?? "story",
      premium: !!a.premium,
      teams: ((a.categories ?? []) as any[]).filter((c) => c.type === "team" && c.description).map((c) => c.description),
    };
  });
}

/** Parse an RSS 2.0 or Atom feed the way feedparser fills the fields used here. */
export function parseFeed(xml: string, source: string, kind: string): Article[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const items = [...doc.getElementsByTagName("item"), ...doc.getElementsByTagName("entry")].slice(0, 40);
  const child = (el: Element, ...names: string[]) => {
    for (const n of names) {
      const hit = [...el.children].find((c) => c.nodeName === n || c.localName === n);
      if (hit) return hit;
    }
    return null;
  };
  const textOf = (el: Element, ...names: string[]) => (child(el, ...names)?.textContent ?? "").trim();
  return items.map((e) => {
    let image = "";
    for (const c of e.children) {
      if (c.nodeName === "media:content" || c.nodeName === "media:thumbnail") {
        image = c.getAttribute("url") ?? "";
        if (image) break;
      }
    }
    if (!image) {
      for (const c of e.children) {
        if (c.localName === "enclosure" && (c.getAttribute("type") ?? "").startsWith("image")) {
          image = c.getAttribute("url") ?? "";
          break;
        }
      }
    }
    const linkEl = child(e, "link");
    const link = (linkEl?.textContent ?? "").trim() || linkEl?.getAttribute("href") || "";
    const date = textOf(e, "pubDate", "published", "updated", "dc:date");
    return {
      id: `${source}-${textOf(e, "guid", "id") || link}`,
      title: clean(textOf(e, "title"), 200),
      summary: clean(textOf(e, "description", "summary", "content:encoded", "content")),
      url: link,
      image,
      source,
      byline: textOf(e, "author", "dc:creator").replace(/^.*\((.*)\)$/, "$1"),
      published: date ? isoUtc(new Date(date)) : "",
      type: kind,
      premium: false,
      teams: [],
    };
  });
}

async function rss(source: string): Promise<Article[]> {
  const [url, kind] = FEEDS[source];
  return parseFeed(await getText(url, { timeout: 10 }), source, kind);
}

export function parseInjuries(j: any): Record<string, InjuryRow[]> {
  const out: Record<string, InjuryRow[]> = {};
  for (const team of j?.injuries ?? []) {
    const rows = ((team.injuries ?? []) as any[]).map((inj) => {
      const a = inj.athlete ?? {};
      const d = inj.details ?? {};
      const side = d.side && d.side !== "Not Specified" ? d.side : "";
      return {
        player: a.displayName ?? "",
        position: a.position?.abbreviation ?? "",
        headshot: a.headshot?.href ?? "",
        status: inj.status ?? "",
        injury: [side, d.type ?? "", d.detail ?? ""].filter(Boolean).join(" ").trim(),
        return_date: d.returnDate ?? "",
        comment: inj.shortComment ?? "",
        date: inj.date ?? "",
      };
    });
    // by ESPN id: ESPN's display names differ from ours ("LA Clippers")
    const name = ESPN_ID_TO_NAME[parseInt(team.id ?? "0", 10)] ?? team.displayName ?? "";
    out[name] = rows;
  }
  return out;
}

/** ESPN's league injury report: {team name: [injury rows]}. */
export function injuries(cache: Cache) {
  return cached(cache, "hub_injuries", async () => parseInjuries(await getJson(ESPN_INJURIES_URL, { timeout: 10 })), {} as Record<string, InjuryRow[]>);
}

export function teamLinks(teamName: string) {
  if (!teamName) return [];
  const nick = teamName.split(" ").at(-1)!;
  const slug = NBA_SLUG_OVERRIDES[teamName] ?? nick.toLowerCase();
  const endYear = seasonStartYear(currentSeason()) + 1;
  const q = teamName.replaceAll(" ", "+");
  const sub = SUBREDDITS[teamName] ?? "nba";
  return [
    { label: "Official site", url: `https://www.nba.com/${slug}`, kind: "home" },
    { label: "Schedule", url: `https://www.nba.com/${slug}/schedule`, kind: "calendar" },
    { label: "Tickets", url: `https://www.nba.com/${slug}/tickets`, kind: "ticket" },
    { label: "ESPN team page", url: `https://www.espn.com/nba/team/_/name/${ESPN_ABBR[teamName] ?? ""}`, kind: "espn" },
    { label: "Basketball-Reference", url: `https://www.basketball-reference.com/teams/${BBREF[teamName] ?? ""}/${endYear}.html`, kind: "stats" },
    { label: `r/${sub}`, url: `https://www.reddit.com/r/${sub}/`, kind: "reddit" },
    { label: "YouTube highlights", url: `https://www.youtube.com/results?search_query=${q}+highlights`, kind: "video" },
  ];
}

// ── hub ──────────────────────────────────────────────────────────────────────

function cached<T>(cache: Cache, key: string, fn: () => Promise<T>, fallback: T) {
  return cache.getOrFetch(key, fn, { ttl: FEED_TTL, fallback });
}

function dedupe(items: Article[]): Article[] {
  const seen = new Set<string>();
  const out: Article[] = [];
  for (const a of items) {
    if (PROMO.test(a.title)) continue;
    const k = a.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
    if (a.title && !seen.has(k)) {
      seen.add(k);
      out.push(a);
    }
  }
  return out;
}

const byDate = (xs: Article[]) => [...xs].sort((a, b) => (b.published || "").localeCompare(a.published || ""));

export async function hub(teamId: number | null | undefined, cache: Cache) {
  const teamName = teamId ? getTeamName(teamId) : "";
  const sources = Object.keys(FEEDS);
  const [espnTeam, espnLeague, inj, ...feeds] = await Promise.all([
    cached(cache, `hub_espn_${teamName}`, () => espn(teamName), [] as Article[]),
    cached(cache, "hub_espn_", () => espn(""), [] as Article[]),
    injuries(cache),
    ...sources.map((s) => cached(cache, `hub_rss_${s}`, () => rss(s), [] as Article[])),
  ]);
  const res = Object.fromEntries(sources.map((s, i) => [s, feeds[i]]));
  const rssStories = sources.filter((s) => FEEDS[s][1] === "story").flatMap((s) => res[s]);
  const rssRumors = sources.filter((s) => FEEDS[s][1] === "rumor").flatMap((s) => res[s]);

  const league = dedupe(byDate([...espnLeague.filter((a) => a.type !== "video"), ...rssStories]));
  const video = dedupe(byDate([...espnTeam, ...espnLeague].filter((a) => a.type === "video")));
  let team: Article[] = [];
  let rumors: Article[];
  if (teamName) {
    const terms = teamTerms(teamName);
    team = dedupe(byDate([...espnTeam.filter((a) => a.type !== "video"), ...rssStories.filter((a) => mentions(a, terms))]));
    const rumorsTeam = rssRumors.filter((a) => mentions(a, terms));
    rumors = [...dedupe(byDate(rumorsTeam)), ...dedupe(byDate(rssRumors)).filter((a) => !rumorsTeam.includes(a))];
  } else {
    rumors = dedupe(byDate(rssRumors));
  }

  return {
    team_name: teamName,
    team: team.slice(0, 40),
    league: league.slice(0, 60),
    rumors: rumors.slice(0, 40),
    video: video.slice(0, 24),
    injuries: {
      team: teamName ? (inj[teamName] ?? []) : [],
      league: Object.entries(inj).flatMap(([t, rows]) => rows.map((r) => ({ team: t, ...r }))),
    },
    links: teamLinks(teamName),
    sources: [...new Set([...league, ...team, ...rumors].map((a) => a.source))].sort(),
  };
}
export type Hub = Awaited<ReturnType<typeof hub>>;

export const BRIEF_FOCUSES = ["team", "league", "rumors", "video", "injuries"];

const articleLines = (items: Article[]) => items.map((a) => `- [${a.source}] ${a.title} — ${a.summary.slice(0, 220)}`);

const injuryLines = (rows: (InjuryRow & { team?: string })[], withTeam = false) =>
  rows.map((r) => `- ${withTeam ? r.team + ": " : ""}${r.player} (${r.status}): ${r.injury} — ${r.comment.slice(0, 160)}`);

/** Plain-text source material for the AI news brief. `focus` is the News tab
 *  the user is on, so the briefing covers what they're looking at. */
export function headlinesBrief(hubData: Hub, teamName: string, focus?: string | null): string {
  if (focus === "team" && !teamName) focus = "league";
  if (focus === "league") return ["NBA league headlines:", ...articleLines(hubData.league.slice(0, 24))].join("\n");
  if (focus === "team") {
    const lines = [`${teamName} headlines:`, ...articleLines(hubData.team.slice(0, 20))];
    const inj = hubData.injuries.team;
    if (inj.length) lines.push(`\n${teamName} injury report:`, ...injuryLines(inj));
    return lines.join("\n");
  }
  if (focus === "rumors") {
    return [`NBA trade and rumor reports${teamName ? ` (focus: ${teamName})` : ""}:`, ...articleLines(hubData.rumors.slice(0, 24))].join("\n");
  }
  if (focus === "video") return ["NBA videos and highlights:", ...articleLines(hubData.video.slice(0, 20))].join("\n");
  if (focus === "injuries") {
    const rows = hubData.injuries.league;
    const mine = rows.filter((r) => r.team === teamName);
    const lines = ["NBA league injury report:"];
    if (mine.length) lines.push(`\n${teamName} (the user's team):`, ...injuryLines(mine));
    lines.push("\nRest of the league:", ...injuryLines(rows.filter((r) => !mine.includes(r)).slice(0, 60), true));
    return lines.join("\n");
  }
  const items = [...(teamName ? hubData.team.slice(0, 12) : []), ...hubData.league.slice(0, 12), ...hubData.rumors.slice(0, 6)];
  const lines = [`NBA headlines${teamName ? ` (focus: ${teamName})` : ""}:`, ...articleLines(items)];
  const inj = hubData.injuries.team;
  if (inj.length) lines.push(`\n${teamName} injury report:`, ...injuryLines(inj));
  return lines.join("\n");
}
