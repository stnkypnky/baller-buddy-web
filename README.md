# Baller Buddy (web app)

Baller Buddy as one installable web app (PWA), replacing the separate
Windows/Linux desktop app ([`baller-buddy`](https://github.com/stnkypnky/baller-buddy))
and Android app ([`baller-buddy-android`](https://github.com/stnkypnky/baller-buddy-android)).
Same pages and look as the desktop app, with a phone layout under 640px.
Every push to `main` updates it on every device.

Scores, team and player analytics, Game Pulse, standings and leaders, Compare,
the news hub, the AI analyst (local or cloud models, 13 tools, fallbacks),
live game alerts (including push notifications when the app is closed) and a
music player for each device's own songs.

## How it fits together

```
web/                  The app (React 19, Vite, Tailwind v4, motion, TanStack Query)
  src/pages, components, lib     the desktop app's UI
  src/backend/        the desktop's Python backend, ported to TypeScript and run
                      in the browser: same /api paths and JSON, served in-process
    nba/              stats.nba.com + ESPN fetchers, services (overview, compare…)
    llm/              providers, encrypted keys, tools, OpenAI-compatible + Claude adapters, router
    news.ts pulse.ts alerts.ts music.ts cache.ts (IndexedDB) settings.ts
  src/sw.ts           service worker: offline app shell, image cache, push notifications
worker/               The Cloudflare Worker: serves the app and runs the cron
  index.ts            routes /api/* (everything else is the built app), plus the cron
  alerts.ts           1-minute cron: live-game alerts -> Web Push
  lib/proxy.ts        GET proxy for nba.com / ESPN / RSS / search (allowlisted hosts only)
  lib/relay.ts        pass-through for AI APIs that block browser requests
  lib/push*.ts        Web Push: VAPID key, subscribe, unsubscribe, test
shared/alertsCore.ts  alert rules used by both the app and the cron
tests/                Vitest (ported from the desktop's pytest suite), offline
```

What changed from the desktop app, by necessity:

| Desktop | Web app |
|---|---|
| Python sidecar on localhost | The same logic in TypeScript in the browser; a small Cloudflare proxy reaches the sites without browser (CORS) access |
| `nba_cache.json` | IndexedDB, same keys and TTLs |
| Windows Credential Manager / GNOME Keyring | Keys encrypted in the browser with a non-extractable key; they only go to their own provider |
| Music folder on the PC | Each device picks its own: a folder (desktop Chrome/Edge) or songs (phones/tablets, kept in the browser's storage) |
| Native notifications from the tray app | In-app toasts, plus Web Push from the cron so alerts arrive with the app closed |
| Frameless window + title bar buttons | Installed app window; on desktop the ticker sits in the title bar |
| Installers, releases | `git push` |

## Develop

```bash
npm install
npm run dev          # http://localhost:5173 (the dev server also serves the proxy)
npm test             # offline tests
npm run typecheck
npm run build        # → dist/
npm run preview      # the Worker + dist/ locally under wrangler (cron: curl localhost:8787/cdn-cgi/handler/scheduled)
npm run shots        # screenshots of every page, desktop + phone, with sample data
```

`npm run shots` needs the dev server running and uses `scripts/sample-data.mjs`
instead of the network, and flags any page that scrolls sideways.

Local AI (LM Studio / Ollama) works from a computer's browser at
`http://localhost`: in LM Studio turn on **Enable CORS** in the server settings;
for Ollama set `OLLAMA_ORIGINS=*`. Another device can use a local server only
through an `https://` address (browsers block plain `http://` from an `https`
page); enter it on the provider's card in Settings.

## Deploy (Cloudflare, free plan)

One Worker serves the app, the API routes and the alerts cron. One-time setup,
about 15 minutes.

1. **Create the Worker from GitHub.** dash.cloudflare.com → Workers & Pages →
   Create application → connect `stnkypnky/baller-buddy-web`. Build command
   `npm run build`, deploy command `npx wrangler deploy` (the defaults are fine).
   Turn **Protect with Cloudflare Access** on (step 4 explains it). Deploy; you get
   `https://baller-buddy-<you>.workers.dev`.
2. **KV namespace** for push subscriptions: nothing to do. `wrangler.jsonc` declares
   the `PUSH` binding without an id, so the first deploy creates the namespace and
   links it. If that ever fails, create one under Storage & Databases → KV and put
   its id in `wrangler.jsonc` as `"id": "…"`.
3. **Push keys.** Run `node scripts/vapid-keys.mjs`. In the Worker → Settings →
   Variables and Secrets (the runtime ones, not Build) add `VAPID_PUBLIC_KEY`
   (text), `VAPID_PRIVATE_KEY` (secret) and `VAPID_SUBJECT` (text,
   `mailto:you@example.com`).
4. **Lock it to you.** Zero Trust → Access → Applications: the Worker's
   application (created by the toggle in step 1) → Policies → Allow → Emails →
   your address. Sign-in is a one-time code by email. The cron runs inside
   Cloudflare, so Access doesn't affect it. If the browser offers no "Install"
   afterwards, add a *Bypass* policy for `/manifest.webmanifest`, `/icon-*.png`
   and `/sw.js`.

After that, every push to `main` deploys; CI (GitHub Actions) runs the
typecheck, tests and build. The cron shows under the Worker → Settings → Triggers.

## Install on each device

- **Windows / Linux / Mac (Chrome or Edge):** open the site → the install icon in
  the address bar (or ⋮ → Cast, save and share → Install). It gets its own window
  and Start-menu / app-menu entry.
- **Android phone (Chrome):** ⋮ → Add to Home screen → Install.
- **Fire tablet (Silk):** ⋮ → Add to Home Screen. If Silk's push notifications
  don't arrive, alerts still show while the app is open.
- **iPhone/iPad (Safari):** Share → Add to Home Screen; push works from the
  installed icon (iOS 16.4+).

Then in Settings: add AI keys (each device keeps its own), pick music, and
turn on "Notify me when the app is closed" under Live game alerts.

## Data sources

stats.nba.com (requests spaced 0.65 s apart, as `nba_api` does), ESPN
(scoreboard, summaries, news, injuries), RSS (ESPN, CBS, Yahoo, Hoops Rumors,
RealGM), DuckDuckGo/Bing for web search. Cloud servers are sometimes blocked
by stats.nba.com; if team stats stop loading while ESPN scores still work,
that's why: open an issue and the affected views can move to ESPN data.
