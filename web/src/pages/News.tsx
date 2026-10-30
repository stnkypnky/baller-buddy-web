import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import {
  Ambulance,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ExternalLink,
  Globe,
  House,
  MessageCircle,
  Newspaper,
  PlayCircle,
  Repeat,
  Ticket,
  Tv,
} from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState, type ReactNode } from "react";
import { AiInline } from "../components/AiInline";
import { cx, Empty, ErrorState, InjuryBadge, Item, Panel, SectionTitle, Skeleton, Stagger, TeamLogo } from "../components/ui";
import { api, openExternal } from "../lib/api";
import { useSelection } from "../lib/queries";

interface Article {
  id: string;
  title: string;
  summary: string;
  url: string;
  image: string;
  source: string;
  byline: string;
  published: string;
  type: "story" | "video" | "recap" | "preview" | "rumor";
  premium: boolean;
}

interface Injury {
  team?: string;
  player: string;
  position: string;
  headshot: string;
  status: string;
  injury: string;
  return_date: string;
  comment: string;
  date: string;
}

interface Hub {
  team_name: string;
  team: Article[];
  league: Article[];
  rumors: Article[];
  video: Article[];
  injuries: { team: Injury[]; league: Injury[] };
  links: { label: string; url: string; kind: string }[];
  sources: string[];
}

type Tab = "team" | "league" | "rumors" | "video" | "injuries";

/** The AI briefing card follows the tab: each one briefs what's on that page. */
const BRIEF_COPY: Record<Tab, { title: string; hint: (team: string) => string }> = {
  team: { title: "Team briefing", hint: (t) => `Five bullets on the latest ${t} news, injuries and moves — read or listen.` },
  league: { title: "League briefing", hint: () => "Five bullets on the biggest storylines around the NBA — read or listen." },
  rumors: { title: "Rumor briefing", hint: () => "The most significant trade and signing reports, with firm news separated from speculation." },
  video: { title: "Video briefing", hint: () => "What's worth watching in today's highlights and clips." },
  injuries: { title: "Injury briefing", hint: () => "The absences that matter most around the league, and what they mean." },
};

const READ_KEY = "nba-news-read";
function loadRead(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}
function saveRead(s: Set<string>) {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...s].slice(-500)));
  } catch {
    /* ignore */
  }
}

export function ago(iso: string) {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function NewsPage() {
  const sel = useSelection();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["news-hub", sel.team?.id],
    queryFn: () => api<Hub>(`/news/hub${sel.team ? `?team_id=${sel.team.id}` : ""}`),
    staleTime: 10 * 60_000,
  });
  const [tab, setTab] = useState<Tab>("team");
  const [read, setRead] = useState(loadRead);

  const open = (a: Article) => {
    if (a.url) openExternal(a.url);
    const next = new Set(read).add(a.id);
    setRead(next);
    saveRead(next);
  };

  const items = useMemo(() => {
    if (!data || tab === "injuries") return [];
    return data[tab];
  }, [data, tab]);

  const tabs: TabOption[] = [
    { key: "team", label: sel.team?.nickname ?? "Team", icon: <TeamLogo espnAbbr={sel.team?.espn_abbr} size={16} />, count: data?.team.length },
    { key: "league", label: "League", icon: <Newspaper className="size-3.5" />, count: data?.league.length },
    { key: "rumors", label: "Trades & rumors", icon: <Repeat className="size-3.5" />, count: data?.rumors.length },
    { key: "video", label: "Video", icon: <PlayCircle className="size-3.5" />, count: data?.video.length },
    { key: "injuries", label: "Injuries", icon: <Ambulance className="size-3.5" />, count: data?.injuries.league.length },
  ];

  return (
    <Stagger className="space-y-5">
      <Item className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <TeamLogo espnAbbr={sel.team?.espn_abbr} size={52} glow />
          <div>
            <div className="eyebrow text-team-text">{data ? `${data.sources.length} sources · updated live` : "Loading sources…"}</div>
            <h1 className="display text-4xl font-bold uppercase">News & links</h1>
          </div>
        </div>
        <TypePicker tabs={tabs} value={tab} onChange={setTab} />
      </Item>

      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      <div className="grid grid-cols-12 gap-5">
        <Item className="col-span-12 xl:col-span-8">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-80 rounded-[18px]" />
              <div className="grid grid-cols-2 gap-4">
                <Skeleton className="h-64 rounded-[18px]" />
                <Skeleton className="h-64 rounded-[18px]" />
              </div>
            </div>
          ) : tab === "injuries" ? (
            <InjuryBoard rows={data?.injuries.league ?? []} highlight={data?.team_name} />
          ) : items.length ? (
            <Feed items={items} read={read} onOpen={open} />
          ) : (
            <Empty icon={<Newspaper className="size-8" />} title="Nothing here right now" />
          )}
        </Item>

        {/* Stacked (phones, tablets), the briefing and the team's injuries come before the feed. */}
        <Item className="col-span-12 space-y-5 max-xl:order-first xl:col-span-4">
          <AiInline
            title={BRIEF_COPY[tab].title}
            cta="Brief me"
            mode="brief"
            focus={tab}
            resetKey={`${sel.team?.id}-${tab}`}
            speakable
            hint={BRIEF_COPY[tab].hint(sel.team?.nickname ?? "team")}
          />
          {/* The team's report belongs with its news; the Injuries board already leads with the team. */}
          {tab === "team" && <TeamInjuries rows={data?.injuries.team} loading={isLoading} team={sel.team?.nickname} />}
          <div className="max-xl:hidden">
            <Links links={data?.links ?? []} />
          </div>
        </Item>
        <Item className="col-span-12 xl:hidden">
          <Links links={data?.links ?? []} />
        </Item>
      </div>
    </Stagger>
  );
}

type TabOption = { key: Tab; label: string; icon: ReactNode; count?: number };

function TypePicker({ tabs, value, onChange }: { tabs: TabOption[]; value: Tab; onChange: (t: Tab) => void }) {
  const [open, setOpen] = useState(false);
  const current = tabs.find((t) => t.key === value) ?? tabs[0];
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="group flex h-12 min-w-[200px] items-center gap-3 rounded-2xl border border-line bg-surface px-4 transition-colors hover:border-team-text/30 hover:bg-surface-2 max-sm:w-full">
          <span className="text-team-text [&>svg]:size-4">{current.icon}</span>
          <div className="flex-1 text-left leading-tight">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">News type</div>
            <div className="display text-[17px] font-bold tracking-wide">{current.label}</div>
          </div>
          <ChevronDown className="size-4 text-muted transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-[60] w-[var(--radix-popover-trigger-width)] min-w-56 rounded-2xl border border-line bg-[#0d1017]/95 p-1.5 shadow-2xl backdrop-blur-xl"
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                onChange(t.key);
                setOpen(false);
              }}
              className={cx(
                "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-white/[0.06]",
                t.key === value && "text-team-text",
              )}
            >
              <span className="[&>svg]:size-4">{t.icon}</span>
              <span className="flex-1">{t.label}</span>
              {t.count != null && <span className="text-xs text-muted tabular">{t.count}</span>}
              {t.key === value && <Check className="size-3.5" />}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Feed({ items, read, onOpen }: { items: Article[]; read: Set<string>; onOpen: (a: Article) => void }) {
  const hero = items[0];
  const heroWithImage = hero.image ? hero : items.find((a) => a.image) ?? hero;
  const others = items.filter((a) => a !== heroWithImage);
  return (
    <div className="space-y-4">
      <HeroCard a={heroWithImage} onOpen={onOpen} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {others.slice(0, 40).map((a, i) => (
          <ArticleCard key={a.id} a={a} read={read.has(a.id)} onOpen={onOpen} index={i} />
        ))}
      </div>
    </div>
  );
}

function HeroCard({ a, onOpen }: { a: Article; onOpen: (a: Article) => void }) {
  return (
    <motion.button
      whileHover={{ scale: 1.005 }}
      onClick={() => onOpen(a)}
      className="panel group relative block h-[340px] w-full overflow-hidden text-left"
    >
      {a.image ? (
        <img src={a.image} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-team/40 to-transparent" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[#07090d] via-[#07090d]/70 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-7">
        <Meta a={a} />
        <h2 className="display mt-2 max-w-3xl text-[38px] leading-[1.02] font-bold">{a.title}</h2>
        {a.summary && <p className="mt-2 line-clamp-2 max-w-3xl text-sm text-fg/80">{a.summary}</p>}
      </div>
      {a.type === "video" && <PlayBadge />}
    </motion.button>
  );
}

function ArticleCard({ a, read, onOpen, index }: { a: Article; read: boolean; onOpen: (a: Article) => void; index: number }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 10) * 0.03 }}
      whileHover={{ y: -3 }}
      onClick={() => onOpen(a)}
      className={cx("panel panel-hover group flex flex-col overflow-hidden text-left", read && "opacity-55")}
    >
      {a.image && (
        <div className="relative h-40 overflow-hidden">
          <img src={a.image} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
          {a.type === "video" && <PlayBadge small />}
        </div>
      )}
      <div className="flex flex-1 flex-col p-4">
        <Meta a={a} />
        <div className="mt-1.5 line-clamp-3 text-[15px] leading-snug font-semibold">{a.title}</div>
        {a.summary && !a.image && <div className="mt-1.5 line-clamp-3 text-xs text-muted">{a.summary}</div>}
      </div>
    </motion.button>
  );
}

const SOURCE_COLORS: Record<string, string> = {
  ESPN: "#ff4d4d",
  "CBS Sports": "#4da3ff",
  "Yahoo Sports": "#a78bfa",
  "Hoops Rumors": "#f5b93b",
  RealGM: "#3ddc84",
};

function Meta({ a }: { a: Article }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="font-bold tracking-wide" style={{ color: SOURCE_COLORS[a.source] ?? "var(--team-text)" }}>
        {a.source.toUpperCase()}
      </span>
      {a.type !== "story" && <span className="rounded bg-white/10 px-1.5 py-px text-[10px] font-semibold uppercase text-fg/80">{a.type}</span>}
      {a.premium && <span className="rounded bg-warn/20 px-1.5 py-px text-[10px] font-semibold text-warn">ESPN+</span>}
      <span className="text-faint">{ago(a.published)}</span>
    </div>
  );
}

function PlayBadge({ small }: { small?: boolean }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className={cx("grid place-items-center rounded-full bg-black/55 backdrop-blur transition-transform group-hover:scale-110", small ? "size-12" : "size-20")}>
        <PlayCircle className={cx("text-white", small ? "size-7" : "size-11")} />
      </div>
    </div>
  );
}

function InjuryRow({ r, showTeam }: { r: Injury; showTeam?: boolean }) {
  return (
    <div className="flex gap-3 border-t border-line/60 py-3 first:border-0">
      {r.headshot ? (
        <img src={r.headshot} alt="" className="size-11 shrink-0 rounded-full bg-surface-2 object-cover max-sm:size-9" />
      ) : (
        <div className="size-11 shrink-0 rounded-full bg-surface-2 max-sm:size-9" />
      )}
      {/* Nothing is cut short: the name wraps beside the badge and ESPN's note shows in full. */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <span className="min-w-0 text-[13px] leading-snug font-semibold break-words">
            {r.player} <span className="text-[11px] font-normal text-faint">{r.position}</span>
          </span>
          <InjuryBadge status={r.status} className="ml-auto whitespace-nowrap" />
        </div>
        <div className="mt-0.5 text-[11px] break-words text-muted">
          {showTeam && r.team ? `${r.team} · ` : ""}
          {r.injury || "Undisclosed"}
          {r.return_date && ` · est. return ${new Date(r.return_date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
        </div>
        {r.comment && <div className="mt-1 text-xs leading-relaxed break-words text-fg/75">{r.comment}</div>}
      </div>
    </div>
  );
}

function TeamInjuries({ rows, loading, team }: { rows?: Injury[]; loading: boolean; team?: string }) {
  return (
    <Panel className="p-5">
      <SectionTitle right={<span className="text-xs text-muted">ESPN</span>}>
        <span className="flex items-center gap-2">
          <Ambulance className="size-4 text-team-text" /> Injury report
        </span>
      </SectionTitle>
      {loading ? <Skeleton className="h-32" /> : rows?.length ? rows.map((r) => <InjuryRow key={r.player} r={r} />) : <div className="text-sm text-muted">No injuries reported for the {team}. 🎉</div>}
    </Panel>
  );
}

function InjuryBoard({ rows, highlight }: { rows: Injury[]; highlight?: string }) {
  const byTeam = useMemo(() => {
    const m = new Map<string, Injury[]>();
    for (const r of rows) m.set(r.team ?? "", [...(m.get(r.team ?? "") ?? []), r]);
    return [...m.entries()].sort(([a], [b]) => (a === highlight ? -1 : b === highlight ? 1 : a.localeCompare(b)));
  }, [rows, highlight]);
  const sel = useSelection();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {byTeam.map(([team, list]) => (
        <Panel key={team} className={cx("p-4", team === highlight && "ring-1 ring-team-text/40")}>
          <div className="mb-1 flex items-center gap-2">
            <TeamLogo espnAbbr={sel.byName.get(team)?.espn_abbr} size={22} />
            <span className="display text-lg font-bold uppercase">{team}</span>
            <span className="ml-auto text-xs text-muted">{list.length}</span>
          </div>
          {list.map((r) => (
            <InjuryRow key={r.player} r={r} />
          ))}
        </Panel>
      ))}
    </div>
  );
}

const LINK_ICONS: Record<string, ReactNode> = {
  home: <House />,
  calendar: <CalendarDays />,
  ticket: <Ticket />,
  espn: <Tv />,
  stats: <BarChart3 />,
  reddit: <MessageCircle />,
  video: <PlayCircle />,
};

function Links({ links }: { links: { label: string; url: string; kind: string }[] }) {
  if (!links.length) return null;
  return (
    <Panel className="p-5">
      <SectionTitle>
        <span className="flex items-center gap-2">
          <Globe className="size-4 text-team-text" /> Team links
        </span>
      </SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        {links.map((l) => (
          <button
            key={l.url}
            onClick={() => openExternal(l.url)}
            className="group flex items-center gap-2.5 rounded-xl border border-line bg-black/20 px-3 py-2.5 text-left text-[13px] transition-colors hover:border-team-text/30 hover:bg-white/[0.04]"
          >
            <span className="text-team-text [&>svg]:size-4">{LINK_ICONS[l.kind] ?? <ExternalLink />}</span>
            <span className="flex-1 truncate">{l.label}</span>
            <ExternalLink className="size-3 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ))}
      </div>
    </Panel>
  );
}
