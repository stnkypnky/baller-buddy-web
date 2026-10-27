import { json, loadSubs, saveSubs, subId, type PushEnv } from "../../_shared/push";

export const onRequestPost: PagesFunction<PushEnv> = async ({ env, request }) => {
  const body = (await request.json().catch(() => null)) as any;
  if (!body?.endpoint) return json({ error: "bad request" }, 400);
  const id = await subId(String(body.endpoint));
  const subs = await loadSubs(env);
  if (subs[id]) {
    delete subs[id];
    await saveSubs(env, subs);
  }
  return json({ ok: true });
};
