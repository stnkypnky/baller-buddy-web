import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { put, sse } from "../lib/api";
import { useSelection } from "../lib/queries";

interface AlertEvent {
  id: number;
  kind: "tipoff" | "close" | "final" | "upset";
  title: string;
  body: string;
  route: string;
}

const ICON: Record<AlertEvent["kind"], string> = { tipoff: "🏀", close: "🔥", final: "🏁", upset: "⚡" };

/** Subscribes to alert events and shows in-app toasts. While the app is in the
 *  background it raises a system notification instead, unless this device
 *  gets Web Push (the server sends those, so it would be a duplicate). Also
 *  records the selected team, the default for alerts. */
export default function AlertListener() {
  const navigate = useNavigate();
  const { team } = useSelection();

  useEffect(() => {
    if (team) put("/ui", { team_id: team.id }).catch(() => {});
  }, [team]);

  useEffect(() => {
    const ctrl = new AbortController();
    let retry = 2000;
    (async function loop() {
      while (!ctrl.signal.aborted) {
        try {
          for await (const ev of sse("/events", undefined, ctrl.signal, "GET")) {
            retry = 2000;
            if (ev.event !== "alert") continue;
            const a = ev.data as AlertEvent;
            if (document.hidden) {
              notify(a);
              continue;
            }
            toast(`${ICON[a.kind] ?? "🏀"} ${a.title}`, {
              description: a.body,
              duration: 9000,
              action: { label: "Open", onClick: () => navigate(a.route) },
            });
          }
        } catch {
          /* backend restarting / offline — back off and retry */
        }
        if (ctrl.signal.aborted) break;
        await new Promise((r) => setTimeout(r, retry));
        retry = Math.min(retry * 2, 30000);
      }
    })();
    return () => ctrl.abort();
  }, [navigate]);

  return null;
}

async function notify(a: AlertEvent) {
  try {
    if (!("serviceWorker" in navigator) || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    if (await reg.pushManager?.getSubscription()) return; // the push copy is on its way
    await reg.showNotification(`${ICON[a.kind] ?? "🏀"} ${a.title}`, {
      body: a.body,
      tag: `${a.kind}-${a.id}`,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { route: a.route },
    });
  } catch {
    /* notifications unavailable */
  }
}
