import { json, loadSubs, saveSubs, subId, type PushEnv, type Subscriber } from "../../_shared/push";

const BOOL_KEYS = ["enabled", "tipoff", "close", "final", "upset"] as const;
const HHMM = /^(\d{2}:\d{2})?$/;
const MAX_DEVICES = 50;

/** Store (or update) this device's subscription and alert preferences. */
export const onRequestPost: PagesFunction<PushEnv> = async ({ env, request }) => {
  const body = (await request.json().catch(() => null)) as any;
  const sub = body?.subscription;
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) {
    return json({ error: "bad subscription" }, 400);
  }
  const p = body.prefs ?? {};
  const prefs = {
    ...(Object.fromEntries(BOOL_KEYS.map((k) => [k, p[k] !== false])) as Record<(typeof BOOL_KEYS)[number], boolean>),
    followed: (Array.isArray(p.followed) ? p.followed : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 30),
    quiet_start: HHMM.test(p.quiet_start ?? "") ? (p.quiet_start ?? "") : "",
    quiet_end: HHMM.test(p.quiet_end ?? "") ? (p.quiet_end ?? "") : "",
  };
  let tz = String(body.tz ?? "UTC");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const id = await subId(sub.endpoint);
  const subs = await loadSubs(env);
  const next: Omit<Subscriber, "updated"> = {
    subscription: { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
    prefs,
    tz,
  };
  const prev = subs[id];
  // Skip the KV write when nothing changed (KV writes are rationed).
  const same = prev && JSON.stringify({ ...prev, updated: 0 }) === JSON.stringify({ ...next, updated: 0 });
  if (!same) {
    if (!prev && Object.keys(subs).length >= MAX_DEVICES) return json({ error: "too many devices" }, 429);
    subs[id] = { ...next, updated: Date.now() };
    await saveSubs(env, subs);
  }
  return json({ ok: true });
};
