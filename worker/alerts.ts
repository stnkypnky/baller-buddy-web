/** The alerts cron: every minute, checks ESPN's scoreboard and sends Web Push
 *  alerts (tip-off, close game, final, upset) to subscribed devices, using the
 *  same rules as the in-app engine (shared/alertsCore.ts). */

import { processGames, inQuietHours, type Game, type GameState } from "../shared/alertsCore";
import { loadSubs, saveSubs, sendPush, type PushEnv } from "./lib/push";

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";

interface DayState {
  games: Record<string, GameState>;
}

/** Today on the NBA's (Eastern) calendar, YYYYMMDD. */
function nbaToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now)
    .replaceAll("-", "");
}

function parseGames(j: any): Game[] {
  const out: Game[] = [];
  for (const ev of j?.events ?? []) {
    const comp = ev?.competitions?.[0];
    const cs: any[] = comp?.competitors ?? [];
    const side = (ha: string) => {
      const c = cs.find((x) => x.homeAway === ha);
      if (!c) return null;
      return {
        espn_id: parseInt(c.team?.id ?? "0", 10) || 0,
        abbr: c.team?.abbreviation ?? "",
        short: c.team?.shortDisplayName ?? "",
        score: String(c.score ?? "0"),
        record: c.records?.[0]?.summary ?? "",
      };
    };
    const home = side("home");
    const away = side("away");
    if (!home || !away) continue;
    out.push({
      id: String(ev.id ?? ""),
      state: ev.status?.type?.state ?? "",
      status_text: ev.status?.type?.shortDetail ?? "",
      date_utc: ev.date ?? "",
      period: parseInt(ev.status?.period ?? "0", 10) || 0,
      clock: ev.status?.displayClock ?? "",
      home,
      away,
    });
  }
  return out;
}

const localHHMM = (tz: string, now = new Date()) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);

export async function runOnce(env: PushEnv, now = new Date()) {
  const subs = await loadSubs(env);
  if (!Object.keys(subs).length) return { alerts: 0, sent: 0 };

  const day = nbaToday(now);
  const r = await fetch(`${SCOREBOARD}?dates=${day}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`ESPN scoreboard HTTP ${r.status}`);
  const games = parseGames(await r.json());

  const key = `state:${day}`;
  const stored = (await env.PUSH.get(key, "json")) as DayState | null;
  // A new day's first look only records where games stand (like the app's
  // first poll), so nothing already underway fires late.
  const state: DayState = stored ?? { games: {} };
  const all = { enabled: true, followed: [], tipoff: true, close: true, final: true, upset: true, quiet_start: "", quiet_end: "" };
  const everyTeam = new Set(games.flatMap((g) => [g.home.espn_id, g.away.espn_id]));
  const { alerts, changed } = processGames(games, state.games, all, everyTeam, !stored, now.getTime());
  if (changed || !stored) await env.PUSH.put(key, JSON.stringify(state), { expirationTtl: 3 * 86400 });

  let sent = 0;
  let gone = false;
  for (const [id, s] of Object.entries(subs)) {
    const p = s.prefs;
    if (!p.enabled || inQuietHours(p, localHHMM(s.tz, now))) continue;
    for (const a of alerts) {
      const mine = a.teams.some((t) => p.followed.includes(t));
      if (!p[a.kind] || (a.kind !== "upset" && !mine)) continue;
      const ok = await sendPush(env, s.subscription, a);
      sent++;
      if (!ok) {
        delete subs[id];
        gone = true;
        break;
      }
    }
  }
  if (gone) await saveSubs(env, subs);
  return { alerts: alerts.length, sent };
}
