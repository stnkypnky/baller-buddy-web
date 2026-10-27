/** Alerts, Game Pulse, news and music logic (ported from tests/test_features.py). */

import { beforeEach, describe, expect, it } from "vitest";
import { inQuietHours, processGames, type AlertPrefs, type Game, type GameState } from "../shared/alertsCore";
import { Cache } from "../web/src/backend/cache";
import * as music from "../web/src/backend/music";
import * as news from "../web/src/backend/news";
import * as pulse from "../web/src/backend/pulse";
import { serve } from "./fake";

// ── alerts ───────────────────────────────────────────────────────────────────

function game(state: string, period = 0, clock = "", hs = 0, as = 0, hrec = "20-10", arec = "20-10", gid = "1"): Game {
  return {
    id: gid, state, status_text: `${clock} - ${period}th`, date_utc: "2026-10-22T23:00Z", period, clock,
    home: { espn_id: 2, abbr: "BOS", short: "Celtics", score: String(hs), record: hrec },
    away: { espn_id: 18, abbr: "NY", short: "Knicks", score: String(as), record: arec },
  };
}

const PREFS: AlertPrefs = { enabled: true, followed: [], tipoff: true, close: true, final: true, upset: true, quiet_start: "", quiet_end: "" };

describe("alerts", () => {
  let state: Record<string, GameState>;
  const followed = new Set([2]); // Celtics
  const run = (g: Game, prefs = PREFS, silent = !prefs.enabled) => processGames([g], state, prefs, followed, silent).alerts.map((a) => a.kind);

  beforeEach(() => {
    state = {};
    processGames([game("pre")], state, PREFS, followed, true); // priming pass is silent
  });

  it("fires tip-off, one close-game alert per period, and the final", () => {
    const out = [
      ...run(game("in", 1, "11:40", 2, 0)),
      ...run(game("in", 4, "3:10", 100, 97)),
      ...run(game("in", 4, "2:00", 102, 99)), // same period: no duplicate
      ...run(game("post", 4, "0:00", 108, 104)),
    ];
    expect(out).toEqual(["tipoff", "close", "final"]);
  });

  it("stays quiet when disabled", () => {
    expect(run(game("in", 1, "10:00", 2, 0), { ...PREFS, enabled: false })).toEqual([]);
  });

  it("watches for upsets in any game", () => {
    const g = game("in", 4, "6:00", 80, 95, "30-5", "8-27", "9");
    g.home.espn_id = 25;
    g.away.espn_id = 27; // not followed teams
    expect(run(g)).toEqual(["upset"]);
  });

  it("handles a quiet-hours window across midnight", () => {
    const prefs = { quiet_start: "23:00", quiet_end: "07:00" };
    expect(inQuietHours(prefs, "23:30")).toBe(true);
    expect(inQuietHours(prefs, "03:00")).toBe(true);
    expect(inQuietHours(prefs, "12:00")).toBe(false);
  });

  it("polls faster while a followed team plays", () => {
    expect(processGames([game("in", 2, "5:00", 40, 38)], state, PREFS, followed, false).delay).toBe(15);
    expect(processGames([game("post")], {}, PREFS, followed, false).delay).toBe(300);
  });
});

// ── pulse ────────────────────────────────────────────────────────────────────

describe("pulse", () => {
  it("measures game time and labels periods", () => {
    expect(pulse.elapsed(1, "12:00")).toBe(0);
    expect(pulse.elapsed(2, "6:00")).toBe(720 + 360);
    expect(pulse.elapsed(5, "5:00")).toBe(2880);
    expect(pulse.elapsed(5, "0:00")).toBe(2880 + 300);
    expect(pulse.periodLabel(6)).toBe("2OT");
  });

  it("detects unanswered runs", () => {
    const sp = (t: number, team: number, value: number, home: number, away: number) =>
      ({ id: String(t), t, team_id: team, value, home, away, clock: "", period: 1, text: "", scoring: true });
    const H = 1;
    const A = 2;
    const plays = [sp(10, H, 2, 2, 0), sp(20, A, 3, 2, 3), sp(30, H, 3, 5, 3), sp(40, H, 2, 7, 3), sp(50, H, 3, 10, 3), sp(60, H, 2, 12, 3), sp(70, A, 2, 12, 5)];
    const runs = pulse.detectRuns(plays, H);
    expect(runs.length).toBe(1);
    expect(runs[0]).toMatchObject({ team: "home", points: 10, from: [3, 2], to: [3, 12] });
  });

  it("builds a pulse from an ESPN summary", async () => {
    serve([["summary", {
      header: { competitions: [{
        status: { period: 4, displayClock: "0:00", type: { state: "post", shortDetail: "Final" } },
        competitors: [
          { homeAway: "home", score: "100", team: { id: "2", abbreviation: "BOS", color: "007a33" }, linescores: [{ displayValue: "25" }] },
          { homeAway: "away", score: "90", team: { id: "18", abbreviation: "NY" }, linescores: [{ displayValue: "20" }] },
        ],
      }] },
      plays: [
        { id: "1", period: { number: 1 }, clock: { displayValue: "11:00" }, homeScore: 2, awayScore: 0, scoringPlay: true, scoreValue: 2, team: { id: "2" }, text: "a" },
        { id: "2", period: { number: 1 }, clock: { displayValue: "10:00" }, homeScore: 2, awayScore: 3, scoringPlay: true, scoreValue: 3, team: { id: "18" }, text: "b" },
      ],
      winprobability: [{ playId: "1", homeWinPercentage: 0.6 }, { playId: "2", homeWinPercentage: 0.45 }],
      boxscore: { teams: [] },
    }]]);
    const p = await pulse.build("401", new Cache({ persist: false }));
    expect(p.teams.home.app_name).toBe("Boston Celtics");
    expect(p.timeline.map((x: any) => x.wp)).toEqual([60, 45]);
    expect(p.lead_changes).toBe(1);
    expect(p.swings[0].delta).toBe(-15);
    expect(p.periods.map((x: any) => x.label)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(await pulse.recapContext("401")).toContain("SCORE: NY 90 – BOS 100");
  });
});

// ── news ─────────────────────────────────────────────────────────────────────

describe("news", () => {
  it("matches team mentions and builds links", () => {
    const terms = news.teamTerms("Philadelphia 76ers");
    expect(news.mentions({ title: "Sixers rally late", summary: "" }, terms)).toBe(true);
    expect(news.mentions({ title: "Bucks win", summary: "no mention" }, terms)).toBe(false);
    const links = Object.fromEntries(news.teamLinks("Philadelphia 76ers").map((l) => [l.label, l.url]));
    expect(links["Official site"]).toBe("https://www.nba.com/sixers");
    expect(links["Basketball-Reference"]).toContain("/PHI/");
    expect(news.teamLinks("")).toEqual([]);
  });

  it("assembles the hub from ESPN, RSS and injuries", async () => {
    const rss = (title: string) =>
      `<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item><title>${title}</title>` +
      `<link>https://x/${encodeURIComponent(title)}</link><description>&lt;p&gt;Celtics notes&lt;/p&gt;</description>` +
      `<pubDate>Sun, 25 Oct 2026 12:00:00 GMT</pubDate><media:content url="https://img/1.jpg"/></item>` +
      `<item><title>Best sportsbook promo code for tonight</title><link>https://x/promo</link></item></channel></rss>`;
    serve([
      ["/news", { articles: [{ id: 1, headline: "Celtics win", description: "Big night", published: "2026-10-25T01:00:00Z", links: { web: { href: "https://espn/1" } }, images: [{ url: "https://img/e.jpg" }] }] }],
      ["/injuries", { injuries: [{ id: "2", displayName: "Boston Celtics", injuries: [{ athlete: { displayName: "A" }, status: "Out", details: { side: "Left", type: "Knee" } }] }] }],
      ["hoopsrumors", rss("Rumor about Celtics")],
      ["realgm", rss("Wire item")],
      ["", rss("Story")],
    ]);
    for (const teamId of [1610612738, null]) {
      const h = await news.hub(teamId, new Cache({ persist: false }));
      expect(h.league.length).toBeGreaterThan(0);
      expect(h.rumors.length).toBeGreaterThan(0);
      expect(h.injuries.league.length).toBe(1);
      expect(h.rumors.some((a) => /promo/i.test(a.title))).toBe(false); // promos dropped
    }
    const h = await news.hub(1610612738, new Cache({ persist: false }));
    expect(h.injuries.team[0]).toMatchObject({ player: "A", injury: "Left Knee" });
    expect(h.rumors[0].title).toBe("Rumor about Celtics"); // team rumors first
    const story = h.league.find((a) => a.source === "CBS Sports")!;
    expect(story).toMatchObject({ summary: "Celtics notes", image: "https://img/1.jpg", published: "2026-10-25T12:00:00+00:00" });
  });

  it("strips HTML from summaries", () => {
    expect(news.clean("<p>Hello &amp; <b>welcome</b></p>")).toBe("Hello & welcome");
  });
});

// ── music ────────────────────────────────────────────────────────────────────

describe("music", () => {
  it("round-trips settings and clamps bad values", async () => {
    await music.saveSettings({ shuffle: true, volume: 100 });
    const s = await music.loadSettings();
    expect(s.shuffle).toBe(true);
    expect(s.volume).toBe(100);
    const out = await music.saveSettings({ loop_mode: "bogus" as any, volume: 250, muted: true });
    expect(out.loop_mode).toBe("none");
    expect(out.volume).toBe(100);
    expect(out.muted).toBe(true);
  });
});
