import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  Menu,
  Newspaper,
  Radio,
  RefreshCw,
  Search,
  Settings,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { post } from "../lib/api";
import { useSelection } from "../lib/queries";
import { useApp } from "../lib/store";
import type { Team } from "../lib/types";
import { cx, IconButton, TeamLogo, Tip } from "./ui";

/* ── Title bar ────────────────────────────────────────────────────────────── */

/** The app's top strip: brand + live ticker. Installed on a desktop with
 *  "window-controls-overlay", it sits in the title bar next to the OS window
 *  buttons (the titlebar-area insets keep it clear of them). */
export function TitleBar({ center }: { center?: ReactNode }) {
  return (
    <div
      className="drag relative z-30 flex h-10 shrink-0 items-center gap-3 border-b border-line/60 bg-black/30 pl-4 backdrop-blur-md"
      style={{
        paddingLeft: "max(1rem, env(titlebar-area-x, 0px))",
        paddingRight: "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))",
      }}
    >
      <div className="flex items-center gap-2">
        <BallMark className="size-[18px]" />
        <span className="display text-[15px] font-bold uppercase tracking-[0.12em] text-fg/90">
          Baller <span className="text-team-text">Buddy</span>
        </span>
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">{center}</div>
    </div>
  );
}

export function BallMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <circle cx="12" cy="12" r="10.5" fill="var(--team)" />
      <g stroke="rgb(0 0 0 / .55)" strokeWidth="1.3" fill="none">
        <path d="M1.5 12h21M12 1.5v21" />
        <path d="M4.6 4.6c3.3 3 3.3 11.8 0 14.8M19.4 4.6c-3.3 3-3.3 11.8 0 14.8" />
      </g>
    </svg>
  );
}

/* ── Sidebar ──────────────────────────────────────────────────────────────── */

type NavItem = { to: string; label: string; icon: ReactNode; match?: string[] };
const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Team",
    items: [
      { to: "/", label: "Overview", icon: <LayoutDashboard /> },
      { to: "/roster", label: "Roster", icon: <Users />, match: ["/player"] },
      { to: "/stats", label: "Stats", icon: <BarChart3 /> },
      { to: "/trends", label: "Trends", icon: <TrendingUp /> },
      { to: "/news", label: "News & Links", icon: <Newspaper /> },
    ],
  },
  {
    group: "League",
    items: [
      { to: "/league", label: "Standings", icon: <Trophy /> },
      { to: "/scores", label: "Scores", icon: <CalendarDays /> },
      { to: "/compare", label: "Compare", icon: <ArrowLeftRight /> },
    ],
  },
  {
    group: "Game Day",
    items: [
      { to: "/live", label: "Live", icon: <Radio /> },
      { to: "/pulse", label: "Game Pulse", icon: <Activity /> },
    ],
  },
  { group: "AI", items: [{ to: "/ai", label: "AI Analyst", icon: <Bot /> }] },
];

export function Sidebar() {
  const collapsed = useApp((s) => s.sidebarCollapsed);
  const toggle = useApp((s) => s.toggleSidebar);
  const { pathname } = useLocation();
  const isActive = (it: NavItem) =>
    it.to === "/" ? pathname === "/" : pathname.startsWith(it.to) || !!it.match?.some((m) => pathname.startsWith(m));

  return (
    <motion.aside
      animate={{ width: collapsed ? 68 : 216 }}
      transition={{ type: "spring", stiffness: 320, damping: 34 }}
      className="relative z-20 flex shrink-0 flex-col border-r border-line/60 bg-black/20 backdrop-blur-md max-sm:hidden"
    >
      <nav className="scroll flex-1 overflow-x-hidden px-2.5 py-3">
        {NAV.map((g) => (
          <div key={g.group} className="mb-3">
            <div className={cx("eyebrow mb-1.5 h-4 px-3 text-[10px] transition-opacity", collapsed && "opacity-0")}>
              {g.group}
            </div>
            {g.items.map((it) => (
              <SideLink key={it.to} item={it} active={isActive(it)} collapsed={collapsed} />
            ))}
          </div>
        ))}
      </nav>
      <div className="border-t border-line/60 px-2.5 py-2.5">
        <SideLink
          item={{ to: "/settings", label: "Settings", icon: <Settings /> }}
          active={pathname.startsWith("/settings")}
          collapsed={collapsed}
        />
        <button
          onClick={toggle}
          className="mt-1 flex h-9 w-full items-center gap-3 rounded-xl px-3 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          {collapsed ? <ChevronsRight className="size-[18px] shrink-0" /> : <ChevronsLeft className="size-[18px] shrink-0" />}
          {!collapsed && <span className="text-[13px]">Collapse</span>}
        </button>
      </div>
    </motion.aside>
  );
}

function SideLink({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  const link = (
    <NavLink
      to={item.to}
      className={cx(
        "relative mb-0.5 flex h-10 items-center gap-3 rounded-xl px-3 transition-colors",
        active ? "text-fg" : "text-muted hover:bg-surface hover:text-fg",
      )}
    >
      {active && (
        <motion.span
          layoutId="nav-active"
          className="absolute inset-0 rounded-xl border border-team-text/25 bg-gradient-to-r from-team/30 to-team/5"
          transition={{ type: "spring", stiffness: 420, damping: 36 }}
        >
          <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-team-text" />
        </motion.span>
      )}
      <span className={cx("relative z-10 shrink-0 [&>svg]:size-[18px]", active && "text-team-text")}>{item.icon}</span>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            className="relative z-10 truncate text-[13px] font-medium"
          >
            {item.label}
          </motion.span>
        )}
      </AnimatePresence>
    </NavLink>
  );
  return collapsed ? (
    <Tip label={item.label} side="right">
      {link}
    </Tip>
  ) : (
    link
  );
}

/* ── Top bar ──────────────────────────────────────────────────────────────── */

export function TopBar({ title }: { title?: ReactNode }) {
  const sel = useSelection();
  const fetching = useIsFetching();
  const qc = useQueryClient();
  const [spinning, setSpinning] = useState(false);

  async function refresh() {
    if (!sel.team) return;
    setSpinning(true);
    try {
      await post(`/team/${sel.team.id}/refresh?season=${sel.season}`);
      await qc.invalidateQueries();
      toast.success("Refreshed", { description: `${sel.team.name} · ${sel.season}` });
    } catch (e) {
      toast.error("Refresh failed", { description: String(e) });
    } finally {
      setSpinning(false);
    }
  }

  return (
    <div className="flex h-16 shrink-0 items-center gap-3 px-6 max-sm:gap-2 max-sm:px-3">
      <TeamSwitcher />
      <SeasonPicker />
      <div className="min-w-0 flex-1 truncate pl-2 text-sm text-muted max-sm:pl-0">{title}</div>
      <AnimatePresence>
        {fetching > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2 text-xs text-muted"
          >
            <span className="size-1.5 animate-pulse rounded-full bg-team-text" />
            <span className="max-sm:hidden">Syncing</span>
          </motion.div>
        )}
      </AnimatePresence>
      <IconButton label="Refresh team data" onClick={refresh} disabled={spinning}>
        <RefreshCw className={cx("size-4", spinning && "animate-spin")} />
      </IconButton>
    </div>
  );
}

export function TeamSwitcher({
  value,
  onChange,
  exclude,
  compact,
}: {
  value?: Team;
  onChange?: (t: Team) => void;
  exclude?: number;
  compact?: boolean;
}) {
  const sel = useSelection();
  const setTeam = useApp((s) => s.setTeam);
  const team = value ?? sel.team;
  const choose = onChange ?? ((t: Team) => setTeam(t.id));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sel.teams.filter(
      (t) =>
        t.id !== exclude &&
        (!q || t.name.toLowerCase().includes(q) || t.abbr.toLowerCase().startsWith(q)),
    );
  }, [sel.teams, query, exclude]);

  const pick = (t: Team) => {
    choose(t);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <motion.button
          whileTap={{ scale: 0.98 }}
          className={cx(
            "group flex items-center gap-3 rounded-2xl border border-line bg-surface pr-3 pl-1.5 transition-colors hover:border-team-text/30 hover:bg-surface-2",
            compact ? "h-11" : "h-12",
          )}
        >
          <div className="grid size-9 place-items-center rounded-xl bg-black/30">
            <TeamLogo espnAbbr={team?.espn_abbr} size={28} />
          </div>
          <div className="text-left leading-tight">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{team?.city ?? "Team"}</div>
            <div className="display text-[17px] font-bold uppercase tracking-wide">{team?.nickname ?? "…"}</div>
          </div>
          <ChevronDown className="size-4 text-muted transition-transform group-data-[state=open]:rotate-180" />
        </motion.button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className="z-[60] w-[min(560px,calc(100vw-1.5rem))] rounded-2xl border border-line bg-[#0d1017]/95 p-3 shadow-2xl backdrop-blur-xl data-[state=open]:animate-[pop_.16s_ease-out]"
        >
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-line bg-black/30 px-3">
            <Search className="size-4 text-muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && filtered[0] && pick(filtered[0])}
              placeholder="Search teams…"
              className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 max-sm:max-h-[60vh] max-sm:overflow-y-auto max-sm:grid-cols-1">
            {(["East", "West"] as const).map((conf) => (
              <div key={conf}>
                <div className="eyebrow mb-1.5 px-2">{conf}ern Conference</div>
                <div className="scroll max-h-[360px] pr-1 max-sm:max-h-none">
                  {filtered
                    .filter((t) => t.conference === conf)
                    .map((t) => (
                      <button
                        key={t.id}
                        onClick={() => pick(t)}
                        className={cx(
                          "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-white/[0.06]",
                          t.id === team?.id && "bg-white/[0.06]",
                        )}
                      >
                        <span className="size-2 shrink-0 rounded-full" style={{ background: t.colors.primary }} />
                        <TeamLogo espnAbbr={t.espn_abbr} size={22} />
                        <span className="flex-1 truncate">{t.name}</span>
                        {t.id === team?.id && <Check className="size-3.5 text-team-text" />}
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SeasonPicker() {
  const sel = useSelection();
  const setSeason = useApp((s) => s.setSeason);
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="group flex h-12 items-center gap-2 rounded-2xl border border-line bg-surface px-4 transition-colors hover:border-team-text/30 hover:bg-surface-2 max-sm:px-3">
          <div className="text-left leading-tight">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Season</div>
            <div className="display text-[17px] font-bold tracking-wide">{sel.season || "…"}</div>
          </div>
          <ChevronDown className="size-4 text-muted transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className="z-[60] w-48 rounded-2xl border border-line bg-[#0d1017]/95 p-1.5 shadow-2xl backdrop-blur-xl"
        >
          {sel.meta?.seasons.map((s, i) => (
            <button
              key={s}
              onClick={() => {
                setSeason(i === 0 ? null : s);
                setOpen(false);
              }}
              className={cx(
                "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-white/[0.06]",
                s === sel.season && "text-team-text",
              )}
            >
              <span className="tabular">{s}</span>
              {i === 0 && <span className="text-[10px] uppercase tracking-wider text-muted">Current</span>}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ── Phone navigation ─────────────────────────────────────────────────────── */

const TABS: NavItem[] = [
  { to: "/", label: "Team", icon: <LayoutDashboard />, match: ["/roster", "/player", "/stats", "/trends"] },
  { to: "/scores", label: "Scores", icon: <CalendarDays />, match: ["/league", "/compare"] },
  { to: "/live", label: "Live", icon: <Radio />, match: ["/pulse"] },
  { to: "/ai", label: "AI", icon: <Bot /> },
];

/** Under 640px the sidebar becomes a bottom tab bar plus a "More" sheet with
 *  every page (the Android app's layout). */
export function BottomNav() {
  const { pathname } = useLocation();
  const [more, setMore] = useState(false);
  const isActive = (it: NavItem) =>
    it.to === "/" ? pathname === "/" || !!it.match?.some((m) => pathname.startsWith(m)) : pathname.startsWith(it.to) || !!it.match?.some((m) => pathname.startsWith(m));
  const tabActive = TABS.some(isActive);

  return (
    <>
      <nav className="relative z-40 grid h-[60px] shrink-0 grid-cols-5 border-t border-line/60 bg-black/60 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden">
        {TABS.map((it) => (
          <NavLink key={it.to} to={it.to} className={cx("flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold", isActive(it) ? "text-team-text" : "text-muted")}>
            <span className="[&>svg]:size-5">{it.icon}</span>
            {it.label}
          </NavLink>
        ))}
        <button onClick={() => setMore(true)} className={cx("flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold", !tabActive || more ? "text-team-text" : "text-muted")}>
          <Menu className="size-5" />
          More
        </button>
      </nav>
      <Dialog.Root open={more} onOpenChange={setMore}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm sm:hidden" />
          <Dialog.Content className="scroll fixed inset-x-0 bottom-0 z-[71] max-h-[80vh] rounded-t-3xl border-t border-line bg-[#0d1017]/97 px-3 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:hidden">
            <Dialog.Title className="sr-only">All pages</Dialog.Title>
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15" />
            {[...NAV, { group: "App", items: [{ to: "/settings", label: "Settings", icon: <Settings /> } as NavItem] }].map((g) => (
              <div key={g.group} className="mb-3">
                <div className="eyebrow mb-1.5 px-3 text-[10px]">{g.group}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {g.items.map((it) => {
                    const active = it.to === "/" ? pathname === "/" : pathname.startsWith(it.to) || !!it.match?.some((m) => pathname.startsWith(m));
                    return (
                      <NavLink
                        key={it.to}
                        to={it.to}
                        onClick={() => setMore(false)}
                        className={cx(
                          "flex h-12 items-center gap-3 rounded-xl border px-3 text-[13px] font-medium",
                          active ? "border-team-text/30 bg-team/20 text-fg" : "border-line bg-surface text-fg/85",
                        )}
                      >
                        <span className={cx("[&>svg]:size-[18px]", active && "text-team-text")}>{it.icon}</span>
                        {it.label}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            ))}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
