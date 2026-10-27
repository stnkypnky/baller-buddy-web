import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { ErrorState, Item, Panel, Skeleton, Stagger, TeamLogo } from "../components/ui";
import { chartTooltipStyle, usePalette } from "../lib/palette";
import { useHistory, useSelection } from "../lib/queries";
import type { HistoryRow } from "../lib/types";

type Metric = { key: string; title: string; unit: string; get: (r: HistoryRow) => number; color: (p: ReturnType<typeof usePalette>) => string };

const METRICS: Metric[] = [
  { key: "win", title: "Win percentage", unit: "%", get: (r) => Math.round(r.win_pct * 1000) / 10, color: (p) => p.accent },
  { key: "pts", title: "Points per game", unit: "", get: (r) => r.pts, color: () => "#3ddc84" },
  { key: "fg3", title: "Three-point %", unit: "%", get: (r) => r.fg3_pct, color: (p) => p.secondary },
  { key: "ast", title: "Assists per game", unit: "", get: (r) => r.ast, color: (p) => p.tertiary },
  { key: "fg", title: "Field-goal %", unit: "%", get: (r) => r.fg_pct, color: () => "#c084fc" },
  { key: "reb", title: "Rebounds per game", unit: "", get: (r) => r.reb, color: () => "#fb7185" },
];

export default function TrendsPage() {
  const sel = useSelection();
  const pal = usePalette();
  const { data, isLoading, error, refetch } = useHistory(sel.team?.id);

  // A season only a handful of games old would drag every line toward noise.
  const MIN_GAMES = 15;
  const last = data?.[data.length - 1];
  const partial = last && last.wins + last.losses < MIN_GAMES ? last : undefined;
  const rows = partial ? data!.slice(0, -1) : (data ?? []);

  return (
    <Stagger className="space-y-5">
      <Item className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <TeamLogo espnAbbr={sel.team?.espn_abbr} size={52} glow />
          <div>
            <div className="eyebrow text-team-text">Last {rows.length || 5} completed seasons</div>
            <h1 className="display text-4xl font-bold uppercase">Multi-season trends</h1>
          </div>
        </div>
        {partial && (
          <div className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-muted">
            {partial.season} in progress ({partial.wins + partial.losses} GP) — joins the trend after {MIN_GAMES} games
          </div>
        )}
      </Item>
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {METRICS.map((m) => (
          <Item key={m.key}>
            {isLoading ? <Skeleton className="h-[260px] rounded-[18px]" /> : <TrendCard m={m} rows={rows} color={m.color(pal)} pal={pal} />}
          </Item>
        ))}
      </div>
    </Stagger>
  );
}

function TrendCard({ m, rows, color, pal }: { m: Metric; rows: HistoryRow[]; color: string; pal: ReturnType<typeof usePalette> }) {
  const series = useMemo(() => rows.map((r) => ({ season: r.season.slice(2), full: r.season, v: m.get(r) })), [rows, m]);
  if (!series.length) return null;
  const vals = series.map((s) => s.v);
  const peak = series[vals.indexOf(Math.max(...vals))];
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const delta = prev ? last.v - prev.v : 0;
  const id = `g-${m.key}`;
  return (
    <Panel className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-muted">{m.title}</div>
          <div className="display mt-0.5 text-4xl font-bold tabular">
            {last.v.toFixed(1)}
            <span className="text-lg text-muted">{m.unit}</span>
          </div>
        </div>
        {prev && (
          <div
            className="rounded-full px-2.5 py-1 text-xs font-semibold tabular"
            style={{ background: `${delta >= 0 ? "#3ddc84" : "#f0506e"}22`, color: delta >= 0 ? "#3ddc84" : "#f0506e" }}
          >
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)} vs {prev.full}
          </div>
        )}
      </div>
      <div className="mt-3 h-[170px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 22, right: 34, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={pal.grid} vertical={false} />
            <XAxis dataKey="season" tick={{ fill: pal.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis domain={["dataMin - 2", "dataMax + 2"]} tick={{ fill: pal.axis, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => Number(v).toFixed(0)} />
            <RTooltip {...chartTooltipStyle} labelFormatter={(_, p) => p?.[0]?.payload.full ?? ""} formatter={(v: any) => [`${Number(v).toFixed(1)}${m.unit}`, m.title]} />
            <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2.5} fill={`url(#${id})`} dot={{ r: 3, fill: color, strokeWidth: 0 }} activeDot={{ r: 5 }} animationDuration={900} />
            <ReferenceDot x={peak.season} y={peak.v} r={6} fill={color} stroke="#07090d" strokeWidth={2} label={{ value: `Peak ${peak.v.toFixed(1)}`, position: "top", fill: color, fontSize: 11, fontWeight: 600 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}
