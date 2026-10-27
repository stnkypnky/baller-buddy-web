/** Live-game alert rules (port of backend/alerts.py's AlertEngine.process),
 *  shared by the in-app engine and the Cloudflare cron that sends Web Push.
 *  Pure: state is a plain JSON object the caller keeps between polls. */

export const CLOSE_MARGIN = 5;
export const CLOSE_SECONDS = 5 * 60;
export const UPSET_GAP = 0.2; // win% difference that makes a lead an upset
export const UPSET_MIN_GAMES = 10;

export type AlertKind = "tipoff" | "close" | "final" | "upset";

export interface AlertPrefs {
  enabled: boolean;
  followed: number[];
  tipoff: boolean;
  close: boolean;
  final: boolean;
  upset: boolean;
  quiet_start: string;
  quiet_end: string;
}

export interface Side {
  espn_id: number;
  abbr: string;
  short: string;
  score: string;
  record: string;
}

export interface Game {
  id: string;
  state: string;
  status_text: string;
  date_utc: string;
  period: number;
  clock: string;
  home: Side;
  away: Side;
}

export interface GameState {
  tipped: boolean;
  final: boolean;
  close: number[];
  upset: boolean;
}

export interface Alert {
  kind: AlertKind;
  title: string;
  body: string;
  game_id: string;
  route: string;
  /** ESPN ids of the two teams, so a server can match each subscriber's teams. */
  teams: number[];
}

/** ESPN displayClock '4:32' / '38.5' -> seconds remaining. */
export function clockSeconds(clock: string): number {
  if (typeof clock !== "string") return 9999;
  const v = clock.includes(":") ? parseInt(clock.split(":")[0], 10) * 60 + parseFloat(clock.split(":")[1]) : parseFloat(clock);
  return Number.isFinite(v) ? v : 9999;
}

export function record(rec: string): [number, number] | null {
  const parts = String(rec ?? "").split("-").slice(0, 2).map((x) => (/^\s*\d+\s*$/.test(x) ? parseInt(x, 10) : NaN));
  return parts.length === 2 && parts.every(Number.isFinite) ? [parts[0], parts[1]] : null;
}

/** "HH:MM" local time `now` falls in the quiet window (which may wrap midnight). */
export function inQuietHours(prefs: Pick<AlertPrefs, "quiet_start" | "quiet_end">, nowHHMM: string): boolean {
  const { quiet_start: start, quiet_end: end } = prefs;
  if (!start || !end) return false;
  return start < end ? start <= nowHHMM && nowHHMM < end : nowHHMM >= start || nowHHMM < end;
}

/** Diff the scoreboard against what we've seen. `silent` still advances the
 *  state (first poll, alerts off, quiet hours) without producing alerts.
 *  Returns the alerts and the next poll delay in seconds. */
export function processGames(
  games: Game[],
  state: Record<string, GameState>,
  prefs: AlertPrefs,
  followed: Set<number>,
  silent: boolean,
  now = Date.now(),
): { alerts: Alert[]; delay: number; changed: boolean } {
  const alerts: Alert[] = [];
  let changed = false;
  let anyLive = false;
  let anyMineLive = false;
  let soon = false;

  for (const g of games) {
    if (!state[g.id]) {
      state[g.id] = { tipped: false, final: false, close: [], upset: false };
      changed = true;
    }
    const st = state[g.id];
    const mine = followed.has(g.home.espn_id) || followed.has(g.away.espn_id);
    const h = g.home;
    const a = g.away;
    const hs = parseInt(h.score || "0", 10) || 0;
    const as = parseInt(a.score || "0", 10) || 0;
    const matchup = `${a.abbr} @ ${h.abbr}`;
    const route = `/pulse/${g.id}`;
    const emit = (kind: AlertKind, title: string, body: string) =>
      alerts.push({ kind, title, body, game_id: g.id, route, teams: [h.espn_id, a.espn_id] });

    if (g.state === "pre") {
      const tip = Date.parse(g.date_utc);
      if (Number.isFinite(tip)) soon ||= tip - now < 1800_000;
      continue;
    }

    if (g.state === "in") {
      anyLive = true;
      anyMineLive ||= mine;
      if (!st.tipped) {
        st.tipped = true;
        changed = true;
        if (mine && prefs.tipoff && !silent) emit("tipoff", `Tip-off: ${matchup}`, `${a.short} at ${h.short} is underway.`);
      }
      const period = g.period || 0;
      const secs = clockSeconds(g.clock || "");
      const margin = Math.abs(hs - as);
      if (period >= 4 && secs <= CLOSE_SECONDS && margin <= CLOSE_MARGIN && !st.close.includes(period)) {
        st.close.push(period);
        changed = true;
        if (mine && prefs.close && !silent) {
          const leader = hs > as ? h : a;
          const status = margin === 0 ? "Tied" : `${leader.abbr} by ${margin}`;
          emit("close", `Close game: ${matchup}`, `${a.abbr} ${as} – ${h.abbr} ${hs} · ${status} · ${g.status_text}`);
        }
      }
      if (period >= 4 && !st.upset) {
        const ra = record(a.record);
        const rh = record(h.record);
        if (ra && rh && Math.min(ra[0] + ra[1], rh[0] + rh[1]) >= UPSET_MIN_GAMES) {
          const pa = ra[0] / (ra[0] + ra[1]);
          const ph = rh[0] / (rh[0] + rh[1]);
          const [under, fav, uScore, fScore] = pa < ph ? [a, h, as, hs] : [h, a, hs, as];
          if (Math.abs(pa - ph) >= UPSET_GAP && uScore > fScore) {
            st.upset = true;
            changed = true;
            if (prefs.upset && !silent) {
              emit(
                "upset",
                `Upset watch: ${under.short} lead ${fav.short}`,
                `${under.abbr} (${under.record}) up ${uScore}-${fScore} on ${fav.abbr} (${fav.record}) · ${g.status_text}`,
              );
            }
          }
        }
      }
    }

    if (g.state === "post" && !st.final) {
      st.final = true;
      st.tipped = true;
      changed = true;
      if (mine && prefs.final && !silent) {
        const [winner, loser] = hs > as ? [h, a] : [a, h];
        emit("final", `Final: ${winner.abbr} ${Math.max(hs, as)}, ${loser.abbr} ${Math.min(hs, as)}`, `${winner.short} beat the ${loser.short}. ${g.status_text}`);
      }
    }
  }

  const delay = anyMineLive ? 15 : anyLive || soon ? 45 : 300;
  return { alerts, delay, changed };
}

export const SAMPLES: Record<AlertKind, [string, string]> = {
  tipoff: ["Tip-off: NYK @ BOS", "Knicks at Celtics is underway."],
  close: ["Close game: NYK @ BOS", "NYK 101 – BOS 103 · BOS by 2 · 2:41 - 4th"],
  final: ["Final: BOS 112, NYK 108", "Celtics beat the Knicks. Final"],
  upset: ["Upset watch: Wizards lead Thunder", "WSH (8-30) up 98-94 on OKC (31-7) · 4:10 - 4th"],
};
