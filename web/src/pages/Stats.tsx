import { motion } from "motion/react";
import { useMemo } from "react";
import { cx, Empty, ErrorState, Item, Panel, SectionTitle, Skeleton, Stagger, TeamLogo, Tip } from "../components/ui";
import { pyFormat } from "../lib/format";
import { useHistory, useLeaders, useOverview, useSelection } from "../lib/queries";
import type { Dashboard, HistoryRow } from "../lib/types";

const SPLIT_ROWS: { key: keyof Dashboard; label: string; pct?: boolean; signed?: boolean }[] = [
  { key: "gp", label: "Games" },
  { key: "pts", label: "Points" },
  { key: "reb", label: "Rebounds" },
  { key: "ast", label: "Assists" },
  { key: "stl", label: "Steals" },
  { key: "blk", label: "Blocks" },
  { key: "tov", label: "Turnovers" },
  { key: "fg_pct", label: "FG%", pct: true },
  { key: "fg3_pct", label: "3P%", pct: true },
  { key: "ft_pct", label: "FT%", pct: true },
  { key: "plus_minus", label: "+/-", signed: true },
];

const HIST_COLS: { key: keyof HistoryRow; label: string; fmt: (r: HistoryRow) => string }[] = [
  { key: "wins", label: "W", fmt: (r) => String(r.wins) },
  { key: "losses", label: "L", fmt: (r) => String(r.losses) },
  { key: "win_pct", label: "Win%", fmt: (r) => r.win_pct.toFixed(3) },
  { key: "pts", label: "PPG", fmt: (r) => r.pts.toFixed(1) },
  { key: "reb", label: "RPG", fmt: (r) => r.reb.toFixed(1) },
  { key: "ast", label: "APG", fmt: (r) => r.ast.toFixed(1) },
  { key: "fg_pct", label: "FG%", fmt: (r) => r.fg_pct.toFixed(1) },
  { key: "fg3_pct", label: "3P%", fmt: (r) => r.fg3_pct.toFixed(1) },
  { key: "ft_pct", label: "FT%", fmt: (r) => r.ft_pct.toFixed(1) },
];

export default function StatsPage() {
  const sel = useSelection();
  const ov = useOverview(sel.team?.id, sel.season);
  const hist = useHistory(sel.team?.id);
  const leaders = useLeaders(sel.season);

  const profile = useMemo(() => {
    const L = leaders.data;
    if (!L || !sel.team) return [];
    return L.categories.map((c) => {
      const rows = L[c.measure];
      const sorted = [...rows].sort((a, b) => (c.higher_is_better ? b[c.field] - a[c.field] : a[c.field] - b[c.field]));
      const idx = sorted.findIndex((r) => r.team_id === sel.team!.id);
      const mine = rows.find((r) => r.team_id === sel.team!.id);
      return { c, rank: idx + 1, of: rows.length, value: mine?.[c.field] };
    }).filter((x) => x.rank > 0);
  }, [leaders.data, sel.team]);

  const best = useMemo(() => {
    // partial seasons (e.g. 1 game in) would "win" columns like fewest losses
    const rows = (hist.data ?? []).filter((r) => r.wins + r.losses >= 41);
    const out: Partial<Record<keyof HistoryRow, number>> = {};
    for (const c of HIST_COLS) {
      const vals = rows.map((r) => r[c.key] as number);
      out[c.key] = c.key === "losses" ? Math.min(...vals) : Math.max(...vals);
    }
    return out;
  }, [hist.data]);

  return (
    <Stagger className="space-y-5">
      <Item className="flex items-center gap-4">
        <TeamLogo espnAbbr={sel.team?.espn_abbr} size={52} glow />
        <div>
          <div className="eyebrow text-team-text">{sel.season}</div>
          <h1 className="display text-4xl font-bold uppercase">Team stats</h1>
        </div>
      </Item>

      <div className="grid grid-cols-12 gap-5">
        <Item className="col-span-12 xl:col-span-5">
          <Panel className="h-full p-5">
            <SectionTitle>Season splits</SectionTitle>
            {ov.isLoading ? (
              <Skeleton className="h-96" />
            ) : ov.error ? (
              <ErrorState error={ov.error} />
            ) : (
              <table className="w-full text-[13px] tabular">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-muted">
                    <th className="pb-2 text-left font-medium">Stat</th>
                    <th className="pb-2 text-right font-medium">Regular</th>
                    <th className="pb-2 text-right font-medium">Playoffs</th>
                    <th className="pb-2 text-right font-medium">Full year</th>
                  </tr>
                </thead>
                <tbody>
                  {SPLIT_ROWS.map((r) => (
                    <tr key={r.key} className="border-t border-line/50">
                      <td className="py-2 text-muted">{r.label}</td>
                      {(["regular", "playoffs", "full"] as const).map((s) => {
                        const d = ov.data?.dash[s] as Dashboard | undefined;
                        const v = d && r.key in d ? (d[r.key] as number) : undefined;
                        return (
                          <td key={s} className={cx("py-2 text-right", s === "regular" ? "font-semibold" : "text-fg/80")}>
                            {v == null ? "—" : r.pct ? `${v.toFixed(1)}%` : r.signed ? `${v > 0 ? "+" : ""}${v.toFixed(1)}` : r.key === "gp" ? v : v.toFixed(1)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </Item>

        <Item className="col-span-12 xl:col-span-7">
          <Panel className="h-full p-5">
            <SectionTitle right={<span className="text-xs text-muted">Rank among {profile[0]?.of ?? 30} teams</span>}>
              League profile
            </SectionTitle>
            {leaders.isLoading ? (
              <Skeleton className="h-96" />
            ) : profile.length ? (
              <div className="grid grid-cols-2 gap-x-8 gap-y-2.5">
                {profile.map(({ c, rank, of, value }, i) => {
                  const pctile = 1 - (rank - 1) / Math.max(of - 1, 1);
                  return (
                    <Tip key={c.label} label={c.definition}>
                      <div className="cursor-help">
                        <div className="mb-1 flex items-baseline justify-between text-xs">
                          <span className="text-fg/85">{c.label}</span>
                          <span className="tabular">
                            <span className="text-muted">{pyFormat(c.format, value)}</span>
                            <span className={cx("ml-2 font-bold", rank <= 5 ? "text-team-text" : rank > of - 5 ? "text-loss" : "text-fg/80")}>
                              #{rank}
                            </span>
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
                          <motion.div
                            className="h-full rounded-full"
                            style={{
                              background: `linear-gradient(90deg, color-mix(in oklab, var(--team-text) 35%, transparent), var(--team-text))`,
                            }}
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.max(3, pctile * 100)}%` }}
                            transition={{ delay: i * 0.03, type: "spring", stiffness: 90, damping: 18 }}
                          />
                        </div>
                      </div>
                    </Tip>
                  );
                })}
              </div>
            ) : (
              <Empty title="League ranks unavailable for this season yet" />
            )}
          </Panel>
        </Item>
      </div>

      <Item>
        <Panel className="p-5">
          <SectionTitle right={<span className="text-xs text-muted">Best season per column highlighted</span>}>
            Recent seasons
          </SectionTitle>
          {hist.isLoading ? (
            <Skeleton className="h-64" />
          ) : (
            <table className="w-full text-[13px] tabular">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted">
                  <th className="pb-2 text-left font-medium">Season</th>
                  {HIST_COLS.map((c) => (
                    <th key={c.key} className="pb-2 text-right font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...(hist.data ?? [])].reverse().map((r) => (
                  <tr key={r.season} className="border-t border-line/50 transition-colors hover:bg-white/[0.03]">
                    <td className="py-2.5 font-semibold">{r.season}</td>
                    {HIST_COLS.map((c) => (
                      <td
                        key={c.key}
                        className={cx("py-2.5 text-right", r[c.key] === best[c.key] ? "font-bold text-team-text" : "text-fg/80")}
                      >
                        {c.fmt(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </Item>
    </Stagger>
  );
}
