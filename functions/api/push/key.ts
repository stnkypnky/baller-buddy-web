import { json, type PushEnv } from "../../_shared/push";

/** The VAPID public key the browser subscribes with. */
export const onRequestGet: PagesFunction<PushEnv> = ({ env }) =>
  env.VAPID_PUBLIC_KEY ? json({ key: env.VAPID_PUBLIC_KEY }) : json({ error: "push not configured" }, 503);
