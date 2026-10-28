import { CalendarClock, Flame, Snowflake } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GameStoryDrawer, type StoryTarget } from "../components/GameStory";
import {
  AnimatedNumber,
  cx,
  Empty,
  ErrorState,
  Item,
  Panel,
  SectionTitle,
  Segmented,
  Skeleton,
  Stagger,
  TeamLogo,
  Tip,
  WL,
} from "../components/ui";
import { countdown, tipLocal } from "../lib/format";
import { useIsPhone } from "../lib/phone";
import { seasonTypeLabel, useLeaders, useOverview, useSelection } from "../lib/queries";
import { useApp } from "../lib/store";
import type { Dashboard, SeasonType, Standing, Team, TeamGame } from "../lib/types";

const KPIS: { key: keyof Dashboard; label: string; field: string; fmt: (v: number) => string; lowerBetter?: boolean; pct?: boolean }[] = [
  { key: "pts", label: "Points", field: "PTS", fmt: (v) => v.toFixed(1) },
  { key: "reb", label: "Rebounds", field: "REB", fmt: (v) => v.toFixed(1) },
  { key: "ast", label: "Assists", field: "AST", fmt: (v) => v.toFixed(1) },
  { key: "plus_minus", label: "Plus / Minus", field: "PLUS_MINUS", fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}` },
  { key: "fg_pct", label: "Field Goal %", field: "FG_PCT", fmt: (v) => `${v.toFixed(1)}%`, pct: true },
  { key: "fg3_pct", label: "Three Point %", field: "FG3_PCT", fmt: (v) => `${v.toFixed(1)}%`, pct: true },
  { key: "ft_pct", label: "Free Throw %", field: "FT_PCT", fmt: (v) => `${v.toFixed(1)}%`, pct: true },
  { key: "stl", label: "Steals", field: "STL", fmt: (v) => v.toFixed(1) },
  { key: "blk", label: "Blocks", field: "BLK", fmt: (v) => v.toFixed(1) },
  { key: "tov", label: "Turnovers", field: "TOV", fmt: (v) => v.toFixed(1), lowerBetter: true },
];

export default function OverviewPage() {
  const sel = useSelection();
  const { seasonType, setSeasonType } = useApp();
  const { data, isLoading, error, refetch } = useOverview(sel.team?.id, sel.season);
  const leaders = useLeaders(sel.season);
  const [story, setStory] = useState<StoryTarget | null>(null);

  const dash = data?.dash[seasonType] as Dashboard | undefined;
  const games: TeamGame[] = useMemo(() => {
    if (!data) return [];
    if (seasonType === "playoffs") return data.games.playoffs;
    if (seasonType === "full") return [...data.games.playoffs, ...data.games.regular];
    return data.games.regular;
  }, [data, seasonType]);

  // League rank per KPI (regular season only — leaders are regular-season stats)
  const ranks = useMemo(() => {
    const rows = leaders.data?.Base;
    if (!rows || !sel.team || seasonType !== "regular") return {};
    const out: Record<string, number> = {};
    for (const k of KPIS) {
      const sorted = [...rows].sort((a, b) => (k.lowerBetter ? a[k.field] - b[k.field] : b[k.field] - a[k.field]));
      const idx = sorted.findIndex((r) => r.team_id === sel.team!.id);
      if (idx >= 0) out[k.key] = idx + 1;
    }
    return out;
  }, [leaders.data, sel.team, seasonType]);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const team = sel.team;
  const st = data?.standings && "wins" in data.standings ? (data.standings as Standing) : undefined;

  return (
    <Stagger className="space-y-5">
      <Item>
        <Hero team={team} loading={isLoading} st={st} seasonType={seasonType} onType={setSeasonType} season={sel.season} />
      </Item>

      <div className="grid grid-cols-12 gap-5">
        <Item className="col-span-12 xl:col-span-8">
          <Panel className="p-5">
            <SectionTitle right={<span className="text-xs text-muted">{dash?.gp ? `${dash.gp} game${dash.gp === 1 ? "" : "s"}` : ""}</span>}>
              {seasonTypeLabel[seasonType]} averages
            </SectionTitle>
            {isLoading ? (
              <div className="grid grid-cols-5 gap-3 max-sm:grid-cols-2">
                {Array.from({ length: 10 }, (_, i) => (
                  <Skeleton key={i} className="h-[92px]" />
                ))}
              </div>
            ) : dash && "pts" in dash ? (
              <div className="grid grid-cols-5 gap-3 max-sm:grid-cols-2">
                {KPIS.map((k, i) => (
                  <Kpi key={k.key} label={k.label} value={dash[k.key] as number} fmt={k.fmt} rank={ranks[k.key]} index={i} />
                ))}
              </div>
            ) : (
              <Empty
                title={seasonType === "playoffs" ? "No playoff games this season" : "No games played yet"}
                hint={seasonType === "playoffs" ? "Switch to Regular Season to see this year's numbers." : "Stats appear after the team's first game."}
              />
            )}
          </Panel>
        </Item>

        <Item className="col-span-12 space-y-5 xl:col-span-4">
          <NextGame data={data?.next_game} loading={isLoading} />
          <FormStrip games={games.slice(0, 10)} loading={isLoading} />
        </Item>
      </div>

      <Item>
        <Panel className="p-5">
          <SectionTitle right={<span className="text-xs text-muted">Click a game for its story</span>}>
            {seasonType === "playoffs" ? "Playoff games" : seasonType === "full" ? "All games" : "Recent games"}
          </SectionTitle>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-11" />
              ))}
            </div>
          ) : games.length ? (
            <GamesTable games={games.slice(0, 25)} onOpen={setStory} />
          ) : (
            <Empty title="No games to show yet" />
          )}
        </Panel>
      </Item>

      <GameStoryDrawer target={story} onClose={() => setStory(null)} />
    </Stagger>
  );
}

function Hero({
  team,
  loading,
  st,
  seasonType,
  onType,
  season,
}: {
  team?: Team;
  loading: boolean;
  st?: { wins: number; losses: number; win_pct: number; conf_rank: number; conference: string; streak: string; last10: string; home: string; road: string };
  seasonType: SeasonType;
  onType: (t: SeasonType) => void;
  season: string;
}) {
  const hot = st?.streak.startsWith("W");
  const phone = useIsPhone();
  return (
    <Panel className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-team/35 via-team/10 to-transparent" />
      <motion.div
        key={team?.id}
        initial={{ opacity: 0, scale: 0.9, rotate: -6 }}
        animate={{ opacity: 0.09, scale: 1, rotate: 0 }}
        transition={{ duration: 0.8 }}
        className="pointer-events-none absolute -top-16 -right-10"
      >
        <TeamLogo espnAbbr={team?.espn_abbr} size={380} />
      </motion.div>

      <div className="relative flex items-center gap-7 p-7 max-sm:flex-wrap max-sm:gap-4 max-sm:p-4">
        <motion.div
          key={`logo-${team?.id}`}
          initial={{ opacity: 0, y: 12, scale: 0.85 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 18 }}
          className="grid size-32 shrink-0 place-items-center rounded-3xl border border-white/10 bg-black/30 shadow-[0_20px_60px_-20px_var(--team-glow)] max-sm:size-20 max-sm:rounded-2xl"
        >
          <TeamLogo espnAbbr={team?.espn_abbr} size={phone ? 64 : 104} glow />
        </motion.div>

        <div className="min-w-0 flex-1">
          <div className="eyebrow text-team-text">{team?.city} · {season}</div>
          <h1 className="display mt-1 truncate text-[64px] leading-[0.9] font-bold uppercase max-sm:text-[40px]">{team?.nickname}</h1>
          <div className="mt-4 flex flex-wrap gap-2 max-sm:mt-3 max-sm:gap-1.5">
            {loading || !st ? (
              <Skeleton className="h-7 w-72" />
            ) : (
              <>
                <Badge strong>
                  #{st.conf_rank} {st.conference}
                </Badge>
                <Badge>
                  {hot ? <Flame className="size-3.5 text-warn" /> : <Snowflake className="size-3.5 text-sky-300" />}
                  {st.streak || "—"}
                </Badge>
                <Badge>L10 {st.last10}</Badge>
                <Badge>Home {st.home}</Badge>
                <Badge>Road {st.road}</Badge>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-4 max-sm:w-full max-sm:flex-col-reverse max-sm:items-stretch">
          <Segmented
            size="sm"
            value={seasonType}
            onChange={onType}
            options={[
              { value: "regular", label: "Regular" },
              { value: "playoffs", label: "Playoffs" },
              { value: "full", label: "Full Year" },
            ]}
          />
          <div className="text-right max-sm:flex max-sm:items-end max-sm:justify-between max-sm:gap-3 max-sm:text-left">
            <div className="display text-[84px] leading-none font-bold tabular whitespace-nowrap max-sm:text-[56px]">
              {st ? (
                <>
                  <AnimatedNumber value={st.wins} format={(v) => Math.round(v).toString()} />
                  <span className="mx-3 inline-block h-[6px] w-6 -translate-y-6 rounded-full bg-white/20 align-middle" />
                  <AnimatedNumber value={st.losses} format={(v) => Math.round(v).toString()} />
                </>
              ) : (
                "–"
              )}
            </div>
            <div className="mt-1 text-xs text-muted">
              {st ? `${(st.win_pct * 100).toFixed(1)}% win rate · regular season` : " "}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function Badge({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
        strong ? "border-transparent bg-team text-team-on" : "border-white/10 bg-black/30 text-fg/90",
      )}
    >
      {children}
    </span>
  );
}

function Kpi({ label, value, fmt, rank, index }: { label: string; value: number; fmt: (v: number) => string; rank?: number; index: number }) {
  const elite = rank != null && rank <= 5;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      whileHover={{ y: -3 }}
      className="group relative overflow-hidden rounded-2xl border border-line bg-black/20 p-4"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-team-text/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="text-[11px] font-medium text-muted">{label}</div>
      <div className="display mt-1 text-[34px] leading-none font-bold">
        <AnimatedNumber value={value} format={fmt} />
      </div>
      {rank != null && (
        <div className={cx("mt-2 text-[11px] font-semibold tabular", elite ? "text-team-text" : rank >= 25 ? "text-loss/80" : "text-faint")}>
          #{rank} in NBA
        </div>
      )}
    </motion.div>
  );
}

function NextGame({ data, loading }: { data?: import("../lib/types").UpcomingGame | null; loading: boolean }) {
  const sel = useSelection();
  if (loading) return <Skeleton className="h-[150px] rounded-[18px]" />;
  if (!data)
    return (
      <Panel className="p-5">
        <div className="eyebrow mb-2">Next game</div>
        <div className="text-sm text-muted">No game scheduled in the next two weeks.</div>
      </Panel>
    );
  const away = sel.byName.get(data.away.app_name);
  const home = sel.byName.get(data.home.app_name);
  return (
    <Panel className="relative overflow-hidden p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="eyebrow flex items-center gap-1.5">
          <CalendarClock className="size-3.5" /> Next game
        </span>
        <span className="rounded-full bg-team/20 px-2.5 py-0.5 text-[11px] font-semibold text-team-text">
          {countdown(data.date_utc)}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <TeamSide team={away} label="Away" />
        <div className="display text-2xl font-bold text-faint">@</div>
        <TeamSide team={home} label="Home" right />
      </div>
      <div className="mt-3 text-center text-xs text-muted">
        {tipLocal(data.date_utc)}
        {data.stype === 3 ? " · Playoffs" : ""}
      </div>
    </Panel>
  );
}

function TeamSide({ team, label, right }: { team?: Team; label: string; right?: boolean }) {
  return (
    <div className={cx("flex items-center gap-3", right && "flex-row-reverse text-right")}>
      <TeamLogo espnAbbr={team?.espn_abbr} size={48} />
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
        <div className="display text-xl font-bold uppercase">{team?.abbr}</div>
      </div>
    </div>
  );
}

function FormStrip({ games, loading }: { games: TeamGame[]; loading: boolean }) {
  const wins = games.filter((g) => g.wl === "W").length;
  return (
    <Panel className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="eyebrow">Form · last 10</span>
        {!!games.length && (
          <span className="text-xs font-semibold tabular text-fg/80">
            {wins}-{games.length - wins}
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-10" />
      ) : games.length ? (
        <div className="flex gap-1.5">
          {Array.from({ length: 10 - games.length }, (_, i) => (
            <div key={`empty-${i}`} className="h-10 flex-1 rounded-md border border-dashed border-white/10" />
          ))}
          {[...games].reverse().map((g, i) => (
            <Tip key={g.game_id || i} label={`${g.date} · ${g.matchup} · ${g.wl} ${g.pts} pts (${g.plus_minus > 0 ? "+" : ""}${g.plus_minus})`}>
              <motion.div
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ delay: i * 0.04, type: "spring", stiffness: 300, damping: 20 }}
                className={cx(
                  "h-10 flex-1 origin-bottom rounded-md",
                  g.wl === "W" ? "bg-win/70" : "bg-loss/60",
                )}
                style={{ opacity: 0.45 + Math.min(Math.abs(g.plus_minus), 25) / 45 }}
              />
            </Tip>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted">No games yet.</div>
      )}
    </Panel>
  );
}

function GamesTable({ games, onOpen }: { games: TeamGame[]; onOpen: (t: StoryTarget) => void }) {
  const sel = useSelection();
  const navigate = useNavigate();
  const stat = (v: number | null, digits = 0) => (v == null ? "—" : v.toFixed(digits));
  return (
    // Phones scroll the table sideways rather than drop columns.
    <div className="max-sm:-mx-5 max-sm:overflow-x-auto max-sm:px-5">
    <table className="w-full text-[13px] tabular max-sm:min-w-[600px] max-sm:whitespace-nowrap max-sm:[&_td]:pr-3 max-sm:[&_th]:pr-3">
      <thead>
        <tr className="text-[11px] uppercase tracking-wider text-muted">
          <th className="pb-2 text-left font-medium">Date</th>
          <th className="pb-2 text-left font-medium">Opponent</th>
          <th className="pb-2 font-medium">Result</th>
          <th className="pb-2 text-right font-medium">PTS</th>
          <th className="pb-2 text-right font-medium">REB</th>
          <th className="pb-2 text-right font-medium">AST</th>
          <th className="pb-2 text-right font-medium">FG%</th>
          <th className="pb-2 text-right font-medium">+/-</th>
        </tr>
      </thead>
      <tbody>
        {games.map((g) => {
          const parts = g.matchup.split(" ");
          const opp = sel.byAbbr.get(parts[parts.length - 1]);
          const home = g.matchup.includes("vs.");
          return (
            <tr
              key={g.game_id}
              onClick={() => (g.pending ? navigate(`/pulse/${g.espn_id}`) : onOpen({ gameId: g.game_id, title: g.matchup, subtitle: g.date }))}
              className="group cursor-pointer border-t border-line/60 transition-colors hover:bg-white/[0.035]"
            >
              <td className="py-2.5 text-muted">{g.date}</td>
              <td className="py-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="w-5 text-xs text-faint">{home ? "vs" : "@"}</span>
                  <TeamLogo espnAbbr={opp?.espn_abbr} size={22} />
                  <span className="font-medium">{opp?.name ?? parts[parts.length - 1]}</span>
                </div>
              </td>
              <td className="py-2.5 text-center">
                <WL wl={g.wl} />
                {g.pending && (
                  <span className="ml-1.5 rounded bg-white/10 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-muted" title="Final on ESPN; nba.com's box score comes later">
                    box score soon
                  </span>
                )}
              </td>
              <td className="py-2.5 text-right font-semibold">{g.pts}</td>
              <td className="py-2.5 text-right text-fg/80">{stat(g.reb)}</td>
              <td className="py-2.5 text-right text-fg/80">{stat(g.ast)}</td>
              <td className="py-2.5 text-right text-fg/80">{stat(g.fg_pct, 1)}</td>
              <td className={cx("py-2.5 text-right font-semibold", g.plus_minus > 0 ? "text-win" : g.plus_minus < 0 ? "text-loss" : "text-muted")}>
                {g.plus_minus > 0 ? "+" : ""}
                {g.plus_minus}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
