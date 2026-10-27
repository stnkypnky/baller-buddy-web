import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowLeft, Flame, Repeat, Swords, Table as TableIcon, TrendingUp, Zap } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AiInline } from "../components/AiInline";
import { BoxScore } from "../components/BoxScore";
import { Button, cx, Empty, ErrorState, Item, Panel, SectionTitle, Skeleton, Stagger, TeamLogo } from "../components/ui";
import { api } from "../lib/api";
import { timeLocal } from "../lib/format";
import { useLive, useSelection } from "../lib/queries";
import { contrast, hexToRgb, readableOnDark } from "../lib/theme";

interface PulseTeam {
  espn_id: number;
  app_name: string;
  abbr: string;
  short: string;
  score: number;
  color: string;
  alt_color: string;
  record: string;
  linescores: number[];
}

interface Point {
  t: number;
  period: number;
  clock: string;
  home: number;
  away: number;
  text: string;
  scoring: boolean;
  wp: number | null;
}

interface Run {
  team: "home" | "away";
  points: number;
  start_t: number;
  end_t: number;
  start_clock: string;
  end_clock: string;
  start_period: number;
  end_period: number;
  from: [number, number];
  to: [number, number];
}

interface PulseData {
  event_id: string;
  status: { state: "pre" | "in" | "post"; detail: string; period: number; clock: string };
  teams: { home: PulseTeam; away: PulseTeam };
  timeline: Point[];
  game_length: number;
  periods: { label: string; start: number }[];
  runs: Run[];
  swings: (Point & { delta: number })[];
  lead_changes: number;
  ties: number;
  biggest_lead: Record<"home" | "away", { margin: number; t: number; clock: string; period: number }>;
  leaders: { team: string; category: string; player: string; value: string; headshot: string }[];
  venue: string;
}

const pLabel = (p: number) => (p <= 4 ? `Q${p}` : p === 5 ? "OT" : `${p - 4}OT`);

/** Pick display colours for both teams that read on dark and don't clash. */
function teamColors(home: PulseTeam, away: PulseTeam) {
  const h = readableOnDark(home.color, 3);
  let a = readableOnDark(away.color, 3);
  if (contrast(hexToRgb(h), hexToRgb(a)) < 1.6) a = readableOnDark(away.alt_color, 3);
  return { home: h, away: a };
}

export default function PulsePage() {
  const { eventId } = useParams();
  return eventId ? <GamePulse eventId={eventId} /> : <Picker />;
}

function Picker() {
  const { data, isLoading } = useLive();
  const sel = useSelection();
  const navigate = useNavigate();
  const games = data?.games ?? [];
  return (
    <Stagger className="space-y-5">
      <Item>
        <div className="eyebrow flex items-center gap-2 text-team-text">
          <Activity className="size-3.5" /> Game Pulse
        </div>
        <h1 className="display text-4xl font-bold uppercase">Pick a game</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          A live win-probability river, automatic run detection, the biggest momentum swings — and an AI broadcaster that catches you up in 30 seconds.
        </p>
      </Item>
      {isLoading && <Skeleton className="h-40 rounded-[18px]" />}
      {data && !games.length && <Empty title="No games today" hint="Open the Live page and browse to another date, then click a game." />}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {games.map((g) => (
          <Item key={g.id}>
            <motion.button
              whileHover={{ y: -4 }}
              onClick={() => navigate(`/pulse/${g.id}`)}
              disabled={g.state === "pre"}
              className="panel panel-hover w-full p-5 text-left disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div className={cx("mb-3 text-xs font-semibold", g.state === "in" ? "text-loss" : "text-muted")}>
                {g.state === "in" ? (
                  <span className="flex items-center gap-2">
                    <span className="live-dot" /> {g.status_text}
                  </span>
                ) : g.state === "pre" ? (
                  `${timeLocal(g.date_utc)} · Pulse opens at tip-off`
                ) : (
                  g.status_text
                )}
              </div>
              {[g.away, g.home].map((s, i) => (
                <div key={i} className="flex items-center gap-3 py-1">
                  <TeamLogo espnAbbr={sel.byName.get(s.app_name)?.espn_abbr} size={30} />
                  <span className="flex-1 text-sm font-semibold">{s.app_name}</span>
                  {g.state !== "pre" && <span className="display text-2xl font-bold tabular">{s.score}</span>}
                </div>
              ))}
            </motion.button>
          </Item>
        ))}
      </div>
    </Stagger>
  );
}

function GamePulse({ eventId }: { eventId: string }) {
  const navigate = useNavigate();
  const sel = useSelection();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["pulse", eventId],
    queryFn: () => api<PulseData>(`/pulse/${eventId}`),
    refetchInterval: (q) => (q.state.data?.status.state === "in" ? 20_000 : false),
  });

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data)
    return (
      <div className="space-y-5">
        <Skeleton className="h-40 rounded-[18px]" />
        <Skeleton className="h-[380px] rounded-[18px]" />
      </div>
    );

  const { home, away } = data.teams;
  const colors = teamColors(home, away);
  const live = data.status.state === "in";
  const wpNow = data.timeline.length ? data.timeline[data.timeline.length - 1].wp : null;

  return (
    <Stagger className="space-y-5">
      <Item className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate("/pulse")}>
          <ArrowLeft className="size-4" /> All games
        </Button>
        <div className="eyebrow flex items-center gap-2 text-team-text">
          <Activity className="size-3.5" /> Game Pulse{data.venue ? ` · ${data.venue}` : ""}
        </div>
      </Item>

      <Item>
        <Panel className="relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0 opacity-50"
            style={{ background: `linear-gradient(100deg, ${away.color}66, transparent 42%, transparent 58%, ${home.color}66)` }}
          />
          <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-6 px-8 py-6">
            <ScoreSide t={away} color={colors.away} espn={sel.byName.get(away.app_name)?.espn_abbr} lead={away.score > home.score} label="Away" />
            <div className="flex flex-col items-center gap-2">
              <div className={cx("rounded-full px-3 py-1 text-xs font-bold", live ? "bg-loss/15 text-loss" : "bg-white/10 text-fg/80")}>
                {live && <span className="live-dot mr-2 scale-75" />}
                {data.status.detail}
              </div>
              {wpNow != null && (
                <div className="w-56">
                  <div className="mb-1 flex justify-between text-[11px] font-semibold tabular">
                    <span style={{ color: colors.away }}>{(100 - wpNow).toFixed(0)}%</span>
                    <span className="text-muted">win probability</span>
                    <span style={{ color: colors.home }}>{wpNow.toFixed(0)}%</span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full">
                    <motion.div animate={{ width: `${100 - wpNow}%` }} style={{ background: colors.away }} />
                    <motion.div animate={{ width: `${wpNow}%` }} style={{ background: colors.home }} />
                  </div>
                </div>
              )}
              <LineScore home={home} away={away} />
            </div>
            <ScoreSide t={home} color={colors.home} espn={sel.byName.get(home.app_name)?.espn_abbr} lead={home.score > away.score} label="Home" right />
          </div>
        </Panel>
      </Item>

      <Item>
        <Panel className="p-5">
          <SectionTitle
            right={
              <div className="flex items-center gap-4 text-xs text-muted">
                <Legend color={colors.away} label={`${away.abbr} favored`} />
                <Legend color={colors.home} label={`${home.abbr} favored`} />
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-5 rounded-sm bg-white/15" /> scoring run
                </span>
              </div>
            }
          >
            <span className="flex items-center gap-2">
              <TrendingUp className="size-4 text-team-text" /> Win probability river
            </span>
          </SectionTitle>
          <River data={data} colors={colors} />
        </Panel>
      </Item>

      <div className="grid grid-cols-12 gap-5">
        <Item className="col-span-12 xl:col-span-7">
          <AiInline
            title="Catch me up"
            cta="Catch me up"
            mode="recap"
            eventId={eventId}
            resetKey={eventId}
            speakable
            hint="A 30-second broadcaster-style recap of the game so far — runs, swings, who's carrying each team. Hit play to hear it."
          />
        </Item>
        <Item className="col-span-12 xl:col-span-5">
          <Panel className="h-full p-5">
            <SectionTitle>
              <span className="flex items-center gap-2">
                <Flame className="size-4 text-team-text" /> Momentum
              </span>
            </SectionTitle>
            <div className="mb-4 grid grid-cols-3 gap-3">
              <Stat icon={<Repeat className="size-3.5" />} label="Lead changes" value={data.lead_changes} />
              <Stat icon={<Swords className="size-3.5" />} label="Ties" value={data.ties} />
              <Stat
                icon={<Zap className="size-3.5" />}
                label="Biggest lead"
                value={Math.max(data.biggest_lead.home.margin, data.biggest_lead.away.margin)}
                sub={data.biggest_lead.home.margin >= data.biggest_lead.away.margin ? home.abbr : away.abbr}
              />
            </div>
            <div className="space-y-2">
              {data.runs.length ? (
                data.runs.map((r, i) => {
                  const t = data.teams[r.team];
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="flex items-center gap-3 rounded-xl border border-line bg-black/20 px-3 py-2.5"
                    >
                      <span className="display min-w-[64px] text-2xl font-bold" style={{ color: colors[r.team] }}>
                        {r.points}-0
                      </span>
                      <div className="text-xs">
                        <div className="font-semibold">{t.short} run</div>
                        <div className="text-muted">
                          {pLabel(r.start_period)} {r.start_clock} → {pLabel(r.end_period)} {r.end_clock} · {r.from[0]}-{r.from[1]} → {r.to[0]}-{r.to[1]}
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              ) : (
                <div className="text-sm text-muted">No 8-0 runs yet.</div>
              )}
            </div>
          </Panel>
        </Item>
      </div>

      <div className="grid grid-cols-12 gap-5">
        <Item className="col-span-12 xl:col-span-7">
          <Panel className="p-5">
            <SectionTitle>Biggest swings</SectionTitle>
            <div className="space-y-2">
              {data.swings.map((s, i) => {
                const favHome = s.delta > 0;
                return (
                  <div key={i} className="flex items-center gap-3 border-t border-line/50 py-2 first:border-0">
                    <span className="w-16 text-xs text-muted tabular">
                      {pLabel(s.period)} {s.clock}
                    </span>
                    <span
                      className="w-16 rounded-md px-1.5 py-0.5 text-center text-[11px] font-bold tabular"
                      style={{ background: `${favHome ? colors.home : colors.away}22`, color: favHome ? colors.home : colors.away }}
                    >
                      {favHome ? home.abbr : away.abbr} +{Math.abs(s.delta).toFixed(1)}%
                    </span>
                    <span className="flex-1 truncate text-[13px]">{s.text}</span>
                    <span className="text-xs text-faint tabular">
                      {s.away}-{s.home}
                    </span>
                  </div>
                );
              })}
              {!data.swings.length && <div className="text-sm text-muted">No win-probability data for this game.</div>}
            </div>
          </Panel>
        </Item>
        <Item className="col-span-12 xl:col-span-5">
          <Panel className="h-full p-5">
            <SectionTitle>Leaders</SectionTitle>
            <div className="grid grid-cols-2 gap-x-4">
              {(["away", "home"] as const).map((side) => (
                <div key={side} className="space-y-2.5">
                  {data.leaders
                    .filter((l) => l.team === data.teams[side].abbr)
                    .map((l) => (
                      <div key={l.category} className="flex items-center gap-2.5">
                        {l.headshot ? <img src={l.headshot} alt="" className="size-10 rounded-full bg-surface-2 object-cover" /> : <div className="size-10 rounded-full bg-surface-2" />}
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-semibold">{l.player}</div>
                          <div className="text-[11px] text-muted">
                            <span className="font-bold" style={{ color: colors[side] }}>
                              {l.value}
                            </span>{" "}
                            {l.category.toLowerCase()}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </Panel>
        </Item>
      </div>

      <Item>
        <PulseBox eventId={eventId} />
      </Item>
    </Stagger>
  );
}

/** The full box score, behind a button so Pulse itself loads no slower. */
function PulseBox({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Panel className="p-5">
      <SectionTitle
        right={
          <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
            <TableIcon className="size-4" /> {open ? "Hide" : "Show"} box score
          </Button>
        }
      >
        Box score
      </SectionTitle>
      {open && <BoxScore source="espn" id={eventId} />}
    </Panel>
  );
}

function ScoreSide({ t, color, espn, lead, label, right }: { t: PulseTeam; color: string; espn?: string; lead: boolean; label: string; right?: boolean }) {
  return (
    <div className={cx("flex items-center gap-5", right && "flex-row-reverse text-right")}>
      <TeamLogo espnAbbr={espn} size={84} />
      <div>
        <div className="text-[11px] tracking-wider text-muted uppercase">
          {label} · {t.record}
        </div>
        <div className="display text-2xl font-bold uppercase">{t.short}</div>
      </div>
      <motion.div
        key={t.score}
        initial={{ y: -10, opacity: 0.4 }}
        animate={{ y: 0, opacity: 1 }}
        className={cx("display text-7xl font-bold tabular", right ? "mr-auto" : "ml-auto")}
        style={{ color: lead ? color : "#596174" }}
      >
        {t.score}
      </motion.div>
    </div>
  );
}

function LineScore({ home, away }: { home: PulseTeam; away: PulseTeam }) {
  if (!home.linescores.length) return null;
  return (
    <table className="text-[11px] tabular">
      <thead>
        <tr className="text-faint">
          <th className="pr-2 text-left font-medium" />
          {home.linescores.map((_, i) => (
            <th key={i} className="w-7 font-medium">
              {pLabel(i + 1)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {[away, home].map((t) => (
          <tr key={t.abbr}>
            <td className="pr-2 font-semibold">{t.abbr}</td>
            {t.linescores.map((v, i) => (
              <td key={i} className="text-center text-fg/80">
                {v}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-full" style={{ background: color }} /> {label}
    </span>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-black/20 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        {icon} {label}
      </div>
      <div className="display mt-1 text-3xl font-bold tabular">
        {value}
        {sub && <span className="ml-1.5 text-sm text-muted">{sub}</span>}
      </div>
    </div>
  );
}

/* ── The river chart ──────────────────────────────────────────────────────── */

const W = 1200;
const H = 300;
const PAD = { l: 72, r: 16, t: 14, b: 26 };

function River({ data, colors }: { data: PulseData; colors: { home: string; away: string } }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const pts = data.timeline;
  const useWp = pts.some((p) => p.wp != null);
  const total = Math.max(data.game_length, pts[pts.length - 1]?.t ?? 1);
  const maxMargin = Math.max(10, ...pts.map((p) => Math.abs(p.home - p.away)));

  const x = (t: number) => PAD.l + (t / total) * (W - PAD.l - PAD.r);
  const val = (p: Point) => (useWp ? (p.wp ?? 50) : 50 + ((p.home - p.away) / maxMargin) * 50);
  const y = (v: number) => PAD.t + ((100 - v) / 100) * (H - PAD.t - PAD.b);
  const mid = y(50);

  const path = useMemo(() => {
    if (!pts.length) return "";
    let d = `M ${x(0)} ${y(useWp ? (pts[0].wp ?? 50) : 50)}`;
    for (const p of pts) d += ` L ${x(p.t).toFixed(1)} ${y(val(p)).toFixed(1)}`;
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pts, total, useWp, maxMargin]);
  const lastX = pts.length ? x(pts[pts.length - 1].t) : x(0);
  const area = path ? `${path} L ${lastX} ${mid} L ${x(0)} ${mid} Z` : "";

  function onMove(e: React.MouseEvent) {
    const svg = ref.current;
    if (!svg || !pts.length) return;
    const r = svg.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width * W - PAD.l) / (W - PAD.l - PAD.r) * total;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    setHover(best);
  }

  if (!pts.length) return <Empty title="The river fills in once the game tips off" />;

  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <clipPath id="above">
            <rect x={0} y={0} width={W} height={mid} />
          </clipPath>
          <clipPath id="below">
            <rect x={0} y={mid} width={W} height={H - mid} />
          </clipPath>
          <linearGradient id="g-home" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.home} stopOpacity={0.55} />
            <stop offset="100%" stopColor={colors.home} stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="g-away" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={colors.away} stopOpacity={0.55} />
            <stop offset="100%" stopColor={colors.away} stopOpacity={0.05} />
          </linearGradient>
        </defs>

        {/* run bands */}
        {data.runs.map((r, i) => (
          <g key={i}>
            <rect
              x={x(r.start_t)}
              y={PAD.t}
              width={Math.max(4, x(r.end_t) - x(r.start_t))}
              height={H - PAD.t - PAD.b}
              fill={colors[r.team]}
              opacity={0.1}
              rx={4}
            />
            <text x={(x(r.start_t) + x(r.end_t)) / 2} y={r.team === "home" ? PAD.t + 14 : H - PAD.b - 6} textAnchor="middle" fontSize={12} fontWeight={700} fill={colors[r.team]}>
              {r.points}-0
            </text>
          </g>
        ))}

        {/* grid: 25/50/75 + period lines */}
        {[25, 50, 75].map((v) => {
          const side = v > 50 ? "home" : v < 50 ? "away" : null;
          const label = !side
            ? useWp ? "50/50" : "tied"
            : `${data.teams[side].abbr} ${useWp ? `${v > 50 ? v : 100 - v}%` : `+${Math.round((Math.abs(v - 50) / 50) * maxMargin)}`}`;
          return (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.08)" strokeDasharray={v === 50 ? "" : "4 6"} />
              <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fontWeight={600} fill={side ? colors[side] : "#596174"} opacity={side ? 0.85 : 1}>
                {label}
              </text>
            </g>
          );
        })}
        {data.periods.map((p) => (
          <g key={p.label}>
            {p.start > 0 && <line x1={x(p.start)} x2={x(p.start)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.08)" />}
            <text x={x(p.start) + 8} y={H - 8} fontSize={11} fill="#596174" fontWeight={600}>
              {p.label}
            </text>
          </g>
        ))}

        {/* the river */}
        <motion.path d={area} fill="url(#g-home)" clipPath="url(#above)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} />
        <motion.path d={area} fill="url(#g-away)" clipPath="url(#below)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} />
        <motion.path d={path} fill="none" stroke={colors.home} strokeWidth={2.2} clipPath="url(#above)" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, ease: "easeInOut" }} />
        <motion.path d={path} fill="none" stroke={colors.away} strokeWidth={2.2} clipPath="url(#below)" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, ease: "easeInOut" }} />

        {/* swing markers */}
        {data.swings.map((s, i) => (
          <circle key={i} cx={x(s.t)} cy={y(val(s))} r={5} fill="#07090d" stroke={s.delta > 0 ? colors.home : colors.away} strokeWidth={2.5} />
        ))}

        {/* live head */}
        {data.status.state === "in" && (
          <g>
            <circle cx={lastX} cy={y(val(pts[pts.length - 1]))} r={9} fill="#f0506e" opacity={0.3}>
              <animate attributeName="r" values="5;12;5" dur="1.6s" repeatCount="indefinite" />
            </circle>
            <circle cx={lastX} cy={y(val(pts[pts.length - 1]))} r={4} fill="#f0506e" />
          </g>
        )}

        {/* hover crosshair */}
        {hover && (
          <g>
            <line x1={x(hover.t)} x2={x(hover.t)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.35)" />
            <circle cx={x(hover.t)} cy={y(val(hover))} r={5} fill="#fff" />
          </g>
        )}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-72 rounded-xl border border-line bg-[#0d1017]/95 p-3 text-xs shadow-xl backdrop-blur"
          style={{ left: `clamp(0px, calc(${(x(hover.t) / W) * 100}% - 144px), calc(100% - 288px))` }}
        >
          <div className="mb-1 flex justify-between text-muted">
            <span>
              {pLabel(hover.period)} {hover.clock}
            </span>
            <span className="font-semibold text-fg tabular">
              {data.teams.away.abbr} {hover.away} – {hover.home} {data.teams.home.abbr}
            </span>
          </div>
          {hover.wp != null && (
            <div className="mb-1 font-semibold tabular" style={{ color: hover.wp >= 50 ? colors.home : colors.away }}>
              {hover.wp >= 50 ? data.teams.home.abbr : data.teams.away.abbr} {Math.max(hover.wp, 100 - hover.wp).toFixed(1)}% to win
            </div>
          )}
          <div className="text-fg/85">{hover.text}</div>
        </div>
      )}
    </div>
  );
}
