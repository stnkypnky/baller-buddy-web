import { SAMPLES, type AlertKind } from "../../../shared/alertsCore";
import { json, loadSubs, sendPush, subId, type PushEnv } from "../../_shared/push";

/** Push a sample alert to the calling device. */
export const onRequestPost: PagesFunction<PushEnv> = async ({ env, request }) => {
  const body = (await request.json().catch(() => null)) as any;
  const sub = (await loadSubs(env))[await subId(String(body?.endpoint ?? ""))];
  if (!sub) return json({ error: "not subscribed" }, 404);
  const kind: AlertKind = String(body?.kind) in SAMPLES ? body.kind : "close";
  const [title, text] = SAMPLES[kind];
  const ok = await sendPush(env, sub.subscription, { kind, title, body: text, route: "/live" }, 60);
  return json({ ok });
};
