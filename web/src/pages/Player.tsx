import { ArrowLeft, IdCard, Ruler } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AbsenceContext, MISSED, returnDate } from "../components/PlayerStatus";
import { ShotChart } from "../components/ShotChart";
import {
  AnimatedNumber,
  Button,
  ErrorState,
  Headshot,
  InjuryBadge,
  Item,
  Panel,
  SectionTitle,
  Segmented,
  Skeleton,
  Stagger,
  TeamLogo,
  Tip,
} from "../components/ui";
import { ageFrom, feetInches, inches } from "../lib/format";
import { chartTooltipStyle, usePalette } from "../lib/palette";
import { usePlayerProfile, useSelection } from "../lib/queries";
import type { Anthro, PlayerBio } from "../lib/types";

const ADV: { key: "ts" | "efg" | "usg" | "ast_pct" | "ast_to" | "pie"; label: string; def: string; pct: boolean }[] = [
  { key: "ts", label: "TS%", def: "True Shooting — scoring efficiency including 3s and free throws", pct: true },
  { key: "efg", label: "eFG%", def: "Field-goal % adjusted for 3-pointers being worth more", pct: true },
  { key: "usg", label: "USG%", def: "Share of team plays used while on the floor", pct: true },
  { key: "ast_pct", label: "AST%", def: "Share of teammate field goals he assisted while on the floor", pct: true },
  { key: "ast_to", label: "AST/TO", def: "Assists per turnover", pct: false },
  { key: "pie", label: "PIE", def: "Player Impact Estimate — share of game events he produced", pct: true },
];

export default function PlayerPage() {
  const { pid } = useParams();
  const [params] = useSearchParams();
  const sel = useSelection();
  const navigate = useNavigate();
  const pal = usePalette();
  // ?team= opens a player from another team (league leaders); default is the selected team.
  const team = sel.byId.get(Number(params.get("team"))) ?? sel.team;
  const { data, isLoading, error, refetch } = usePlayerProfile(Number(pid), team?.id, sel.season);
  const [range, setRange] = useState<"10" | "20" | "all">("20");

  const games = useMemo(() => {
    const g = data?.games ?? [];
    const sliced = range === "all" ? g : g.slice(-Number(range));
    return sliced.map((x, i) => ({
      ...x,
      opp: x.matchup.split(" ").pop(),
      tsPct: Math.round(x.ts * 1000) / 10,
      idx: i,
    }));
  }, [data, range]);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const p = data?.player;
  const bio = data?.bio;

  return (
    <Stagger className="space-y-5">
      <Item>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" /> Back
        </Button>
      </Item>

      <Item>
        <Panel className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-team/40 via-team/10 to-transparent" />
          <div className="pointer-events-none absolute -right-8 -bottom-20 opacity-[0.07]">
            <TeamLogo espnAbbr={team?.espn_abbr} size={360} />
          </div>
          <div className="relative flex items-end gap-8 px-8 pt-6 max-sm:flex-col max-sm:items-stretch max-sm:gap-1 max-sm:px-4">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 160, damping: 20 }}
              className="w-[300px] shrink-0 max-sm:mx-auto max-sm:w-[220px]"
            >
              {p ? (
                <Headshot pid={p.pid} name={p.name} size="large" className="aspect-[4/3] w-full drop-shadow-[0_20px_40px_rgba(0,0,0,.6)]" />
              ) : (
                <Skeleton className="aspect-[4/3] w-full" />
              )}
            </motion.div>
            <div className="min-w-0 flex-1 pb-7 max-sm:pb-5">
              <div className="flex items-center gap-2">
                <TeamLogo espnAbbr={team?.espn_abbr} size={22} />
                <span className="eyebrow text-team-text">
                  {team?.name} · {p?.pos || bio?.position || "—"} · {sel.season}
                </span>
              </div>
              <h1 className="display mt-1 text-[60px] leading-[0.92] font-bold uppercase max-sm:text-[38px]">
                {p?.name ?? bio?.name ?? (isLoading ? "Loading…" : "Player not on this roster")}
              </h1>
              {bio && (
                <div className="mt-2 text-[15px] font-semibold text-fg/85">
                  {[
                    bio.jersey && `#${bio.jersey}`,
                    bio.height_in && feetInches(bio.height_in),
                    bio.weight_lb && `${bio.weight_lb} lb`,
                    bio.birthdate && `Age ${ageFrom(bio.birthdate)}`,
                  ]
                    .filter(Boolean)
                    .join("  ·  ")}
                </div>
              )}
              {p?.injury && (
                <div className="mt-3 flex max-w-2xl items-start gap-2 text-[13px]">
                  <InjuryBadge status={p.injury.status} className="mt-px" />
                  <div>
                    <span className="font-semibold">{p.injury.injury || "Undisclosed"}</span>
                    {p.injury.return_date && <span className="text-muted"> · est. return {returnDate(p.injury.return_date)}</span>}
                    {p.injury.comment && <div className="mt-0.5 text-fg/75">{p.injury.comment}</div>}
                  </div>
                </div>
              )}
              {p?.absence && (
                <div className="mt-3 flex max-w-2xl items-start gap-2 text-[13px]">
                  <InjuryBadge status={MISSED} className="mt-px" />
                  <div className="space-y-1">
                    <div className="font-semibold">Didn't play a game in {sel.season}</div>
                    {data?.absence_note && (
                      <div className="text-fg/75">
                        “{data.absence_note.text}”{" "}
                        <a href={data.absence_note.url} target="_blank" rel="noreferrer" className="text-team-text hover:underline">
                          {data.absence_note.source}
                        </a>
                        <span className="text-muted"> · via web search</span>
                      </div>
                    )}
                    <AbsenceContext a={p.absence} acquired={p.acquired} />
                  </div>
                </div>
              )}
              <div className="mt-5 flex flex-wrap gap-6 max-sm:gap-x-4 max-sm:gap-y-3">
                {p &&
                  [
                    ["PTS", p.ppg],
                    ["REB", p.rpg],
                    ["AST", p.apg],
                    ["STL", p.spg],
                    ["BLK", p.bpg],
                    ["MIN", p.mpg],
                  ].map(([l, v]) => (
                    <div key={l as string}>
                      <div className="display text-4xl font-bold max-sm:text-3xl">
                        <AnimatedNumber value={v as number} />
                      </div>
                      <div className="text-[11px] font-semibold tracking-wider text-muted">{l}</div>
                    </div>
                  ))}
                {p && (
                  <div className="ml-2 border-l border-line pl-6 max-sm:ml-0 max-sm:pl-4">
                    <div className="display text-4xl font-bold max-sm:text-3xl">{p.gp}</div>
                    <div className="text-[11px] font-semibold tracking-wider text-muted">GAMES</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Panel>
      </Item>

      <Item className="grid grid-cols-9 gap-3 max-sm:grid-cols-3 max-sm:gap-2">
        {ADV.map((a) => {
          const v = data?.advanced[a.key];
          return (
            <Tip key={a.key} label={a.def}>
              <div className="panel cursor-help p-4 max-sm:p-3">
                <div className="text-[11px] font-semibold tracking-wider text-team-text">{a.label}</div>
                <div className="display mt-1 text-[28px] leading-none font-bold max-sm:text-[22px]">
                  {v == null ? "—" : <AnimatedNumber value={a.pct ? v * 100 : v} format={(x) => (a.pct ? `${x.toFixed(1)}%` : x.toFixed(2))} />}
                </div>
              </div>
            </Tip>
          );
        })}
        {(["pts", "reb", "ast"] as const).map((k) => (
          <Tip key={k} label={`${k.toUpperCase()} per 36 minutes`}>
            <div className="panel cursor-help p-4 max-sm:p-3">
              <div className="text-[11px] font-semibold tracking-wider text-team-text">P36 {k.toUpperCase()}</div>
              <div className="display mt-1 text-[28px] leading-none font-bold max-sm:text-[22px]">
                <AnimatedNumber value={data?.per36[k]} />
              </div>
            </div>
          </Tip>
        ))}
      </Item>

      {bio && <BioPanels bio={bio} anthro={data?.anthro ?? null} />}

      <div className="grid grid-cols-12 gap-5">
        <Item className="col-span-12 2xl:col-span-6">
          <Panel className="p-5">
            <SectionTitle>Shot chart</SectionTitle>
            {isLoading ? <Skeleton className="h-[420px]" /> : data && <ShotChart shots={data.shots} accent={pal.accent} />}
          </Panel>
        </Item>
        <Item className="col-span-12 2xl:col-span-6">
          <Panel className="flex h-full flex-col p-5">
            <SectionTitle
              right={
                <Segmented
                  size="sm"
                  value={range}
                  onChange={setRange}
                  options={[
                    { value: "10", label: "Last 10" },
                    { value: "20", label: "Last 20" },
                    { value: "all", label: "Season" },
                  ]}
                />
              }
            >
              Game log
            </SectionTitle>
            {isLoading ? (
              <Skeleton className="h-[380px]" />
            ) : games.length ? (
              <div className="min-h-[380px] flex-1 max-sm:min-h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={games} margin={{ top: 10, right: 6, left: -12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="pts-bar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={pal.accent} stopOpacity={0.95} />
                        <stop offset="100%" stopColor={pal.accent} stopOpacity={0.25} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={pal.grid} vertical={false} />
                    <XAxis dataKey="opp" tick={{ fill: pal.axis, fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
                    <YAxis yAxisId="pts" tick={{ fill: pal.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="ts" orientation="right" domain={[0, 100]} tick={{ fill: pal.axis, fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                    <RTooltip
                      {...chartTooltipStyle}
                      labelFormatter={(_, payload) => {
                        const g = payload?.[0]?.payload;
                        return g ? `${g.date} · ${g.matchup}` : "";
                      }}
                      formatter={(v: any, name: any) => (name === "TS%" ? [`${v}%`, name] : [v, name])}
                    />
                    <Bar yAxisId="pts" dataKey="pts" name="PTS" fill="url(#pts-bar)" radius={[6, 6, 2, 2]} maxBarSize={26} animationDuration={700} />
                    <Line yAxisId="ts" dataKey="tsPct" name="TS%" stroke={pal.secondary} strokeWidth={2.2} dot={{ r: 2.5, fill: pal.secondary }} animationDuration={900} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="grid flex-1 place-items-center text-sm text-muted">No games logged yet</div>
            )}
          </Panel>
        </Item>
      </div>
    </Stagger>
  );
}

/** Physical measurements and background, side by side. */
function BioPanels({ bio, anthro: a }: { bio: PlayerBio; anthro: Anthro | null }) {
  // Ape index: wingspan beyond height, both barefoot at the combine.
  const ape = a?.wingspan != null && a.height_no_shoes != null ? a.wingspan - a.height_no_shoes : null;
  const physical: [string, string][] = [];
  if (bio.height_in) physical.push(["Height", feetInches(bio.height_in)]);
  if (bio.weight_lb) physical.push(["Weight", `${bio.weight_lb} lb`]);
  if (bio.birthdate) {
    const born = new Date(`${bio.birthdate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    physical.push(["Age", `${ageFrom(bio.birthdate)} (born ${born})`]);
  }
  if (a?.wingspan != null)
    physical.push(["Wingspan", `${feetInches(a.wingspan)}${ape == null ? "" : `  (${ape >= 0 ? "+" : "−"}${inches(Math.abs(ape))})`}`]);
  if (a?.standing_reach != null) physical.push(["Standing reach", feetInches(a.standing_reach)]);
  if (a?.hand_length != null)
    physical.push(["Hand size", `${inches(a.hand_length)} long${a.hand_width != null ? ` · ${inches(a.hand_width)} wide` : ""}`]);
  if (a?.body_fat != null) physical.push(["Body fat", `${a.body_fat.toFixed(1)}%`]);

  const background: [string, string][] = [
    ["Draft", bio.draft_year && bio.draft_pick ? `${bio.draft_year} · Round ${bio.draft_round ?? 1}, Pick ${bio.draft_pick}` : "Undrafted"],
    ["Experience", bio.season_exp > 0 ? `${bio.season_exp} year${bio.season_exp === 1 ? "" : "s"}` : "Rookie"],
  ];
  if (bio.school) background.push(["From", bio.school]);
  if (bio.country) background.push(["Country", bio.country]);
  if (bio.position) background.push(["Position", bio.position]);

  return (
    <Item className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Panel className="p-5">
        <SectionTitle>
          <span className="inline-flex items-center gap-2">
            <Ruler className="size-4 text-team-text" /> Physical
          </span>
        </SectionTitle>
        <KeyValues rows={physical} />
        <div className="mt-3 text-xs text-faint">
          {a
            ? `Wingspan, reach and hands from the ${a.year} draft combine, measured barefoot; (+) is wingspan beyond height.`
            : "No draft-combine measurements on record, so wingspan isn't available."}
        </div>
      </Panel>
      <Panel className="p-5">
        <SectionTitle>
          <span className="inline-flex items-center gap-2">
            <IdCard className="size-4 text-team-text" /> Background
          </span>
        </SectionTitle>
        <KeyValues rows={background} />
      </Panel>
    </Item>
  );
}

function KeyValues({ rows }: { rows: [string, string][] }) {
  return (
    <div className="divide-y divide-line/60 text-[14px]">
      {rows.map(([l, v]) => (
        <div key={l} className="flex items-center justify-between py-2.5">
          <span className="text-muted">{l}</span>
          <span className="font-semibold tabular">{v}</span>
        </div>
      ))}
    </div>
  );
}
