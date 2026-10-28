/** The /api/push/* endpoints: a device's subscription and alert preferences
 *  (kept in the PUSH KV namespace) and a test notification. */

import { SAMPLES, type AlertKind } from "../../shared/alertsCore";
import { json, loadSubs, saveSubs, sendPush, subId, type PushEnv, type Subscriber } from "./push";

const BOOL_KEYS = ["enabled", "tipoff", "close", "final", "upset"] as const;
const HHMM = /^(\d{2}:\d{2})?$/;

const body = (request: Request) => request.json().catch(() => null) as Promise<any>;

/** Constant-time string compare, so the passcode can't be guessed by timing. */
function same(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Signing up for alerts (and test pushes) needs the passcode, so strangers who
 *  find the public link can't fill the device slots. Null means "go ahead". */
function passcodeError(request: Request, env: PushEnv): Response | null {
  if (!env.PUSH_PASSCODE) return json({ error: "push passcode not set" }, 503);
  if (!same(request.headers.get("x-push-passcode") ?? "", env.PUSH_PASSCODE)) return json({ error: "wrong passcode" }, 401);
  return null;
}

/** The VAPID public key the browser subscribes with. */
export const pushKey = (env: PushEnv) =>
  env.VAPID_PUBLIC_KEY ? json({ key: env.VAPID_PUBLIC_KEY }) : json({ error: "push not configured" }, 503);

/** Store (or update) this device's subscription and alert preferences. */
export async function pushSubscribe(request: Request, env: PushEnv) {
  const denied = passcodeError(request, env);
  if (denied) return denied;
  const b = await body(request);
  const sub = b?.subscription;
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) {
    return json({ error: "bad subscription" }, 400);
  }
  const p = b.prefs ?? {};
  const prefs = {
    ...(Object.fromEntries(BOOL_KEYS.map((k) => [k, p[k] !== false])) as Record<(typeof BOOL_KEYS)[number], boolean>),
    followed: (Array.isArray(p.followed) ? p.followed : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 30),
    quiet_start: HHMM.test(p.quiet_start ?? "") ? (p.quiet_start ?? "") : "",
    quiet_end: HHMM.test(p.quiet_end ?? "") ? (p.quiet_end ?? "") : "",
  };
  let tz = String(b.tz ?? "UTC");
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
    subs[id] = { ...next, updated: Date.now() };
    await saveSubs(env, subs);
  }
  return json({ ok: true });
}

export async function pushUnsubscribe(request: Request, env: PushEnv) {
  const b = await body(request);
  if (!b?.endpoint) return json({ error: "bad request" }, 400);
  const id = await subId(String(b.endpoint));
  const subs = await loadSubs(env);
  if (subs[id]) {
    delete subs[id];
    await saveSubs(env, subs);
  }
  return json({ ok: true });
}

/** Push a sample alert to the calling device. */
export async function pushTest(request: Request, env: PushEnv) {
  const denied = passcodeError(request, env);
  if (denied) return denied;
  const b = await body(request);
  const sub = (await loadSubs(env))[await subId(String(b?.endpoint ?? ""))];
  if (!sub) return json({ error: "not subscribed" }, 404);
  const kind: AlertKind = String(b?.kind) in SAMPLES ? b.kind : "close";
  const [title, text] = SAMPLES[kind];
  return json({ ok: await sendPush(env, sub.subscription, { kind, title, body: text, route: "/live" }, 60) });
}
