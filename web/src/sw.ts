/// <reference lib="webworker" />
/** Service worker: precaches the app shell (so the installed app starts
 *  offline and updates in the background), caches team logos and headshots,
 *  and shows Web Push alerts from the Cloudflare cron. */

import { clientsClaim } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst, StaleWhileRevalidate } from "workbox-strategies";

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/api\//] }));

// Headshots and other images fetched through the proxy change rarely.
const isProxiedImage = (url: URL) =>
  url.pathname === "/api/proxy" && /\.(png|jpe?g|webp)$/i.test(url.searchParams.get("url") ?? "");
registerRoute(
  ({ url }) => isProxiedImage(url),
  new CacheFirst({ cacheName: "images", plugins: [new ExpirationPlugin({ maxEntries: 600, maxAgeSeconds: 7 * 86400 })] }),
);
registerRoute(({ url }) => url.pathname.startsWith("/logos/"), new StaleWhileRevalidate({ cacheName: "logos" }));

interface PushAlert {
  kind?: string;
  title: string;
  body: string;
  route?: string;
  game_id?: string;
}

const ICON: Record<string, string> = { tipoff: "🏀", close: "🔥", final: "🏁", upset: "⚡" };

self.addEventListener("push", (event) => {
  let a: PushAlert;
  try {
    a = event.data?.json() as PushAlert;
  } catch {
    a = { title: "Baller Buddy", body: event.data?.text() ?? "" };
  }
  event.waitUntil(
    (async () => {
      // Always shown, even with the app open (Chrome penalizes silent pushes,
      // and the desktop app raised a native notification next to its toast too).
      await self.registration.showNotification(`${ICON[a.kind ?? ""] ?? "🏀"} ${a.title}`, {
        body: a.body,
        tag: a.game_id ? `${a.kind}-${a.game_id}` : undefined,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { route: a.route ?? "/live" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route: string = event.notification.data?.route ?? "/live";
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const win = wins[0];
      if (win) {
        await win.focus();
        win.postMessage({ type: "navigate", route });
        return;
      }
      await self.clients.openWindow(`/#${route}`);
    })(),
  );
});
