import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { BallMark, BottomNav, Sidebar, TitleBar, TopBar } from "./components/shell";
import { Skeleton } from "./components/ui";
import { api } from "./lib/api";
import { useSelection } from "./lib/queries";
import { applyTeamTheme } from "./lib/theme";
import type { Health } from "./lib/types";
import OverviewPage from "./pages/Overview";

const Roster = lazy(() => import("./pages/Roster"));
const PlayerPage = lazy(() => import("./pages/Player"));
const Stats = lazy(() => import("./pages/Stats"));
const Trends = lazy(() => import("./pages/Trends"));
const League = lazy(() => import("./pages/League"));
const ScoresPage = lazy(() => import("./pages/Scores"));
const ComparePage = lazy(() => import("./pages/Compare"));
const Live = lazy(() => import("./pages/Live"));
const Pulse = lazy(() => import("./pages/Pulse"));
const News = lazy(() => import("./pages/News"));
const AI = lazy(() => import("./pages/AI"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const MusicDock = lazy(() => import("./components/MusicDock"));
const Ticker = lazy(() => import("./components/Ticker"));
const AlertListener = lazy(() => import("./components/AlertListener"));

export default function App() {
  const sel = useSelection();
  const location = useLocation();
  const navigate = useNavigate();

  // Re-theme the whole app whenever the selected team changes.
  useEffect(() => {
    if (sel.team) applyTeamTheme(sel.team.colors);
  }, [sel.team]);

  // Notification clicks (service worker) deep-link into a route.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (e: MessageEvent) => e.data?.type === "navigate" && navigate(e.data.route);
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [navigate]);

  const booted = !!sel.meta;

  return (
    <>
      <div className="app-backdrop" />
      <div className="relative z-10 flex h-full flex-col">
        <TitleBar
          center={
            <Suspense fallback={null}>
              <Ticker />
            </Suspense>
          }
        />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <div className="relative min-h-0 flex-1">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={location.pathname.split("/").slice(0, 2).join("/")}
                  initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -8, filter: "blur(4px)", transition: { duration: 0.15 } }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                  className="scroll absolute inset-0 px-6 pt-1 pb-8 max-sm:px-3 max-sm:pb-6"
                >
                  {booted && (
                    <PageErrorBoundary resetKey={location.pathname}>
                      <Suspense fallback={<PageFallback />}>
                        <Routes location={location}>
                          <Route path="/" element={<OverviewPage />} />
                          <Route path="/roster" element={<Roster />} />
                          <Route path="/player/:pid" element={<PlayerPage />} />
                          <Route path="/stats" element={<Stats />} />
                          <Route path="/trends" element={<Trends />} />
                          <Route path="/league" element={<League />} />
                          <Route path="/scores" element={<ScoresPage />} />
                          <Route path="/compare" element={<ComparePage />} />
                          <Route path="/live" element={<Live />} />
                          <Route path="/pulse" element={<Pulse />} />
                          <Route path="/pulse/:eventId" element={<Pulse />} />
                          <Route path="/news" element={<News />} />
                          <Route path="/ai" element={<AI />} />
                          <Route path="/settings" element={<SettingsPage />} />
                          <Route path="*" element={<OverviewPage />} />
                        </Routes>
                      </Suspense>
                    </PageErrorBoundary>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>
        <Suspense fallback={<div className="h-[72px] shrink-0 border-t border-line/60" />}>
          <MusicDock />
        </Suspense>
        <BottomNav />
      </div>
      {booted && (
        <Suspense fallback={null}>
          <AlertListener />
        </Suspense>
      )}
      <BootSplash ready={booted} />
    </>
  );
}

const RELOADED_KEY = "page-chunk-reloaded";

/**
 * Keeps one broken page from blanking the whole window. A page chunk that
 * fails to load usually means a stale index.html from an older install, so
 * reload once to pick up the current build; anything else shows a message.
 */
class PageErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    const chunk = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(error.message);
    let reloaded = false;
    try {
      reloaded = sessionStorage.getItem(RELOADED_KEY) === "1";
      if (chunk && !reloaded) sessionStorage.setItem(RELOADED_KEY, "1");
    } catch {
      /* ignore */
    }
    if (chunk && !reloaded) window.location.reload();
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-full place-items-center text-center">
        <div>
          <div className="display text-2xl font-bold uppercase">This page couldn't load</div>
          <div className="mt-2 text-sm text-muted">{this.state.error.message}</div>
          <button className="mt-4 rounded-xl border border-line px-4 py-2 text-sm hover:bg-white/[0.04]" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

function PageFallback() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-44 rounded-[18px]" />
      <div className="grid grid-cols-3 gap-5">
        <Skeleton className="h-64 rounded-[18px]" />
        <Skeleton className="h-64 rounded-[18px]" />
        <Skeleton className="h-64 rounded-[18px]" />
      </div>
    </div>
  );
}

/** In-app splash that mirrors the Electron splash, then lifts away. */
function BootSplash({ ready }: { ready: boolean }) {
  const [gone, setGone] = useState(false);
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api<Health>("/health"),
    refetchInterval: (q) => (q.state.data?.ready ? false : 600),
    enabled: !gone,
  });
  const show = !(ready && health.data?.ready);
  useEffect(() => {
    if (!show) {
      const t = setTimeout(() => setGone(true), 900);
      return () => clearTimeout(t);
    }
  }, [show]);
  if (gone) return null;
  const pct = health.data ? (health.data.done / Math.max(health.data.total, 1)) * 100 : 8;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          exit={{ opacity: 0, scale: 1.04, filter: "blur(10px)" }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-[200] grid place-items-center bg-[#07090d]"
        >
          <div className="app-backdrop" />
          <div className="relative flex flex-col items-center">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2.4, ease: "linear" }}
              className="drop-shadow-[0_0_40px_var(--team-glow)]"
            >
              <BallMark className="size-24" />
            </motion.div>
            <div className="display mt-8 text-4xl font-bold uppercase tracking-[0.18em]">
              Baller <span className="text-team-text">Buddy</span>
            </div>
            <div className="mt-6 h-1 w-64 overflow-hidden rounded-full bg-white/10">
              <motion.div className="h-full rounded-full bg-team-text" animate={{ width: `${pct}%` }} transition={{ duration: 0.4 }} />
            </div>
            <div className="mt-3 h-4 text-xs text-muted">
              {health.isError ? "Starting data service…" : (health.data?.step ?? "Starting…")}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
