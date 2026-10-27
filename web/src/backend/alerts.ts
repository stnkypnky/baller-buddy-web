/** Live game alerts in the app (stand-in for backend/alerts.py's poller), plus
 *  the Web Push subscription that lets the Cloudflare cron alert this device
 *  while the app is closed. */

import { processGames, inQuietHours, SAMPLES, type AlertKind, type GameState } from "../../../shared/alertsCore";
import { fetchScoreboard } from "./nba/data";
import { ESPN_IDS, getTeamName } from "./nba/teams";
import * as settings from "./settings";

export interface AlertEvent {
  id: number;
  kind: AlertKind;
  title: string;
  body: string;
  game_id: string;
  route: string;
  ts: number;
}

type Listener = (ev: AlertEvent) => void;

const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

class AlertEngine {
  recent: AlertEvent[] = [];
  private listeners = new Set<Listener>();
  private state: Record<string, GameState> = {};
  private primed = false;
  private ids = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  publish(kind: AlertKind, title: string, body: string, gameId = "", route = "/live") {
    const ev: AlertEvent = { id: this.ids++, kind, title, body, game_id: gameId, route, ts: Date.now() / 1000 };
    this.recent = [...this.recent, ev].slice(-30);
    for (const fn of this.listeners) fn(ev);
    return ev;
  }

  start() {
    if (!this.timer) this.timer = setTimeout(() => this.run(), 1000);
  }

  async followedEspnIds(): Promise<Set<number>> {
    const prefs = await settings.get("alerts");
    let ids = prefs.followed ?? [];
    const ui = await settings.get("ui");
    if (!ids.length && ui.team_id) ids = [ui.team_id];
    return new Set(ids.map((i) => ESPN_IDS[getTeamName(i)]).filter((x): x is number => !!x));
  }

  private async run() {
    let delay = 300;
    try {
      const board = await fetchScoreboard();
      delay = await this.process(board.games);
    } catch (e) {
      console.info("alert poll failed:", e);
      delay = 120;
    }
    this.timer = setTimeout(() => this.run(), delay * 1000);
  }

  async process(games: Parameters<typeof processGames>[0]) {
    const prefs = await settings.get("alerts");
    const silent = !this.primed || !prefs.enabled || inQuietHours(prefs, hhmm());
    const { alerts, delay } = processGames(games, this.state, prefs, await this.followedEspnIds(), silent);
    this.primed = true;
    for (const a of alerts) this.publish(a.kind, a.title, a.body, a.game_id, a.route);
    return delay;
  }

  simulate(kind: AlertKind) {
    const [title, body] = SAMPLES[kind] ?? SAMPLES.close;
    return this.publish(kind, title, body, "", "/live");
  }
}

export const engine = new AlertEngine();

// ── Web Push ─────────────────────────────────────────────────────────────────

const pushSupported = () => typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

function b64urlToBytes(s: string) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function subscription(create: boolean): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  const have = await reg.pushManager.getSubscription();
  if (have || !create) return have;
  if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") return null;
  const r = await fetch("/api/push/key");
  if (!r.ok) return null;
  const { key } = await r.json();
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) });
}

/** Tell the cron what this device wants: followed teams, kinds, quiet hours. */
export async function syncPush(opts: { create?: boolean } = {}) {
  try {
    const sub = await subscription(!!opts.create);
    if (!sub) return { push: false };
    const prefs = await settings.get("alerts");
    const ui = await settings.get("ui");
    const followed = prefs.followed?.length ? prefs.followed : ui.team_id ? [ui.team_id] : [];
    const r = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: sub.toJSON(),
        prefs: { ...prefs, followed: followed.map((i) => ESPN_IDS[getTeamName(i)]).filter(Boolean) },
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    return { push: r.ok };
  } catch (e) {
    console.info("push sync failed:", e);
    return { push: false };
  }
}

export async function pushStatus() {
  if (!pushSupported()) return { supported: false, subscribed: false, permission: "unsupported" };
  return { supported: true, subscribed: !!(await subscription(false)), permission: Notification.permission };
}

export async function unsubscribePush() {
  const sub = await subscription(false);
  if (!sub) return;
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe();
}

/** Ask the server to push a sample alert to this device. */
export async function testPush(kind: AlertKind) {
  const sub = await subscription(false);
  if (!sub) return false;
  const r = await fetch("/api/push/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint, kind }),
  }).catch(() => null);
  return !!r?.ok;
}
