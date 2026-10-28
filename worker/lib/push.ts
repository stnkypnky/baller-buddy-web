/** Web Push storage and sending, shared by the Pages Functions (subscribe,
 *  test) and the cron Worker (live-game alerts).
 *
 *  KV keeps writes rare (the free plan allows 1,000 a day): every
 *  subscription lives in one "subs" record that changes only when a device
 *  subscribes or updates its preferences, and game state is written only
 *  when an alert-worthy change happens. */

import { buildPushPayload, type PushSubscription, type VapidKeys } from "@block65/webcrypto-web-push";
import type { AlertPrefs } from "../../shared/alertsCore";

export interface PushEnv {
  PUSH: KVNamespace;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT?: string;
  /** Shared passcode a device must send to sign up for alerts (Worker secret). */
  PUSH_PASSCODE?: string;
}

export interface Subscriber {
  subscription: PushSubscription;
  /** Followed teams as ESPN ids. */
  prefs: AlertPrefs;
  tz: string;
  updated: number;
}

export type Subs = Record<string, Subscriber>;

export async function subId(endpoint: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function loadSubs(env: PushEnv): Promise<Subs> {
  return ((await env.PUSH.get("subs", "json")) as Subs | null) ?? {};
}

export const saveSubs = (env: PushEnv, subs: Subs) => env.PUSH.put("subs", JSON.stringify(subs));

const vapid = (env: PushEnv): VapidKeys => ({
  subject: env.VAPID_SUBJECT || "mailto:baller-buddy@users.noreply.github.com",
  publicKey: env.VAPID_PUBLIC_KEY,
  privateKey: env.VAPID_PRIVATE_KEY,
});

/** Sends one notification. Returns false when the subscription is gone (404/410). */
export async function sendPush(env: PushEnv, sub: PushSubscription, data: unknown, ttl = 600): Promise<boolean> {
  const payload = await buildPushPayload({ data: JSON.stringify(data), options: { ttl, urgency: "high" } }, sub, vapid(env));
  const r = await fetch(sub.endpoint, payload);
  if (r.status === 404 || r.status === 410) return false;
  if (!r.ok) console.warn(`push ${new URL(sub.endpoint).host}: HTTP ${r.status} ${await r.text().catch(() => "")}`);
  return true;
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
