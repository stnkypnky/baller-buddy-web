import { motion } from "motion/react";
import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Chip, cx, Empty, ErrorState, Headshot, Item, Panel, Segmented, Skeleton, Stagger, TeamLogo } from "../components/ui";
import { pyFormat } from "../lib/format";
import { useLeaders, usePlayerLeaders, useSelection, useStandings } from "../lib/queries";
import { useApp } from "../lib/store";
import type { StandingRow } from "../lib/types";

export default function LeaguePage() {
  const [view, setView] = useState<"standings" | "players" | "rookies" | "leaders">("standings");
  const sel = useSelection();
  return (
    <Stagger className="space-y-5">
      <Item className="flex items-end justify-between">
        <div>
          <div className="eyebrow text-team-text">{sel.season}</div>
          <h1 className="display text-4xl font-bold uppercase">League</h1>
        </div>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "standings", label: "Standings" },
            { value: "players", label: "Player leaders" },
            { value: "rookies", label: "Rookie leaders" },
            { value: "leaders", label: "Team leaders" },
          ]}
        />
      </Item>
      <Item>
        {view === "standings" ? <Standings /> : view === "players" ? <PlayerLeaders /> : view === "rookies" ? <PlayerLeaders rookies /> : <Leaders />}
      </Item>
    </Stagger>
  );
}

function Standings() {
  const sel = useSelection();
  const setTeam = useApp((s) => s.setTeam);
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useStandings(sel.season);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading)
    return (
      <div className="grid grid-cols-2 gap-5">
        <Skeleton className="h-[640px] rounded-[18px]" />
        <Skeleton className="h-[640px] rounded-[18px]" />
      </div>
    );

  const pick = (r: StandingRow) => {
    setTeam(r.team_id);
    toast(`Switched to ${r.team_name}`);
    navigate("/");
  };

  return (
    <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
      {(["East", "West"] as const).map((conf) => {
        const rows = (data ?? []).filter((r) => r.conference === conf).sort((a, b) => a.rank - b.rank);
        return (
          <Panel key={conf} className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h3 className="display text-xl font-bold uppercase">{conf}ern Conference</h3>
              <span className="text-xs text-muted">Click a team to switch</span>
            </div>
            <table className="w-full text-[13px] tabular">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted">
                  <th className="w-10 py-2.5 pl-5 text-left font-medium">#</th>
                  <th className="py-2.5 text-left font-medium">Team</th>
                  <th className="py-2.5 text-right font-medium">W</th>
                  <th className="py-2.5 text-right font-medium">L</th>
                  <th className="py-2.5 text-right font-medium">Pct</th>
                  <th className="py-2.5 text-right font-medium">GB</th>
                  <th className="py-2.5 text-right font-medium">Strk</th>
                  <th className="py-2.5 text-right font-medium">L10</th>
                  <th className="py-2.5 text-right font-medium">Home</th>
                  <th className="py-2.5 pr-5 text-right font-medium">Road</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const t = sel.byId.get(r.team_id);
                  const mine = r.team_id === sel.team?.id;
                  return (
                    <Fragment key={r.team_id}>
                      {(i === 6 || i === 10) && (
                        <tr>
                          <td colSpan={10} className="px-5 pt-2 pb-1">
                            <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
                              <div className="h-px flex-1 border-t border-dashed border-white/15" />
                              {i === 6 ? "Play-in tournament" : "Lottery"}
                              <div className="h-px flex-1 border-t border-dashed border-white/15" />
                            </div>
                          </td>
                        </tr>
                      )}
                      <motion.tr
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.02 }}
                        onClick={() => pick(r)}
                        className={cx(
                          "cursor-pointer border-t border-line/40 transition-colors hover:bg-white/[0.04]",
                          mine && "bg-team/15 hover:bg-team/20",
                        )}
                      >
                        <td className={cx("py-2 pl-5 font-semibold", mine ? "text-team-text" : "text-muted")}>{r.rank}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-2.5">
                            <TeamLogo espnAbbr={t?.espn_abbr} size={24} />
                            <span className={cx("font-semibold", mine && "text-team-text")}>{t?.nickname ?? r.team_name}</span>
                          </div>
                        </td>
                        <td className="py-2 text-right font-semibold">{r.wins}</td>
                        <td className="py-2 text-right">{r.losses}</td>
                        <td className="py-2 text-right text-fg/80">{r.win_pct.toFixed(3).replace(/^0/, "")}</td>
                        <td className="py-2 text-right text-muted">{r.gb ? r.gb.toFixed(1) : "—"}</td>
                        <td className={cx("py-2 text-right font-medium", r.streak.startsWith("W") ? "text-win" : "text-loss")}>{r.streak}</td>
                        <td className="py-2 text-right text-fg/80">{r.last10}</td>
                        <td className="py-2 text-right text-muted">{r.home}</td>
                        <td className="py-2 pr-5 text-right text-muted">{r.road}</td>
                      </motion.tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        );
      })}
    </div>
  );
}

function PlayerLeaders({ rookies = false }: { rookies?: boolean }) {
  const sel = useSelection();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = usePlayerLeaders(sel.season, rookies);
  const [cat, setCat] = useState("Points");

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-[640px] rounded-[18px]" />;
  const category = data.categories.find((c) => c.label === cat) ?? data.categories[0];
  const rows = category?.leaders ?? [];

  const hi = rows[0]?.value ?? 0;
  const lo = Math.min(0, rows[rows.length - 1]?.value ?? 0); // +/- can be negative
  const norm = (v: number) => (hi === lo ? 100 : 8 + ((v - lo) / (hi - lo)) * 92);
  const qual = [
    `min. ${data.min_games} game${data.min_games === 1 ? "" : "s"}`,
    category?.min_per_game && `${category.min_per_game.value} ${category.min_per_game.field.replace("FG3M", "3PM")} a game`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Panel className="p-5">
      <div className="mb-4 flex flex-wrap gap-2">
        {data.categories.map((c) => (
          <Chip key={c.label} active={c.label === category?.label} onClick={() => setCat(c.label)}>
            {c.label}
          </Chip>
        ))}
      </div>
      <div className="mb-4 text-sm text-muted">
        <span className="display mr-2 text-lg font-bold uppercase text-fg">
          {rookies ? "Top 10 rookies" : "Top 10"} · {category?.label}
        </span>
        {category?.definition} · {qual}
      </div>
      {!rows.length ? (
        <Empty title={rookies ? "No qualified rookies yet this season" : "No qualified players yet this season"} />
      ) : (
        <div className="space-y-1">
          {rows.map((r, i) => {
            const t = sel.byId.get(r.team_id);
            const mine = r.team_id === sel.team?.id;
            return (
              <motion.button
                key={`${category.label}-${r.pid}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.025 }}
                onClick={() => navigate(`/player/${r.pid}?team=${r.team_id}`)}
                className={cx(
                  "flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04]",
                  mine && "bg-team/15 ring-1 ring-team-text/30",
                )}
              >
                <span className={cx("w-6 text-right text-sm font-bold tabular", i < 3 ? "text-team-text" : "text-muted")}>{i + 1}</span>
                <Headshot pid={r.pid} name={r.name} className="size-10 shrink-0 rounded-full bg-surface-2" />
                <div className="w-56 min-w-0">
                  <div className="truncate text-[13px] font-semibold">{r.name}</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted">
                    <TeamLogo espnAbbr={t?.espn_abbr} size={14} />
                    {t?.nickname ?? r.team_abbr} · {r.gp} GP
                  </div>
                </div>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: mine ? "var(--team-text)" : t?.colors.primary, opacity: mine ? 1 : 0.75 }}
                    initial={{ width: 0 }}
                    animate={{ width: `${norm(r.value)}%` }}
                    transition={{ delay: 0.1 + i * 0.025, type: "spring", stiffness: 80, damping: 16 }}
                  />
                </div>
                <span className="w-16 text-right text-[15px] font-bold tabular">{pyFormat(category.format, r.value)}</span>
              </motion.button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function Leaders() {
  const sel = useSelection();
  const { data, isLoading, error, refetch } = useLeaders(sel.season);
  const [cat, setCat] = useState("Net Rating");

  const category = data?.categories.find((c) => c.label === cat) ?? data?.categories[0];
  const rows = useMemo(() => {
    if (!data || !category) return [];
    const list = [...data[category.measure]].filter((r) => r[category.field] != null);
    list.sort((a, b) => (category.higher_is_better ? b[category.field] - a[category.field] : a[category.field] - b[category.field]));
    return list;
  }, [data, category]);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-[640px] rounded-[18px]" />;
  if (!rows.length || !category) return <Empty title="No team stats for this season yet" />;

  const vals = rows.map((r) => r[category.field]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const norm = (v: number) => {
    const t = hi === lo ? 1 : (v - lo) / (hi - lo);
    return 8 + (category.higher_is_better ? t : 1 - t) * 92;
  };

  return (
    <Panel className="p-5">
      <div className="mb-4 flex flex-wrap gap-2">
        {data.categories.map((c) => (
          <Chip key={c.label} active={c.label === category.label} onClick={() => setCat(c.label)}>
            {c.label}
          </Chip>
        ))}
      </div>
      <div className="mb-4 text-sm text-muted">{category.definition}</div>
      <div className="grid grid-cols-1 gap-x-10 gap-y-1.5 xl:grid-cols-2">
        {rows.map((r, i) => {
          const t = sel.byId.get(r.team_id);
          const mine = r.team_id === sel.team?.id;
          return (
            <motion.div
              key={`${category.label}-${r.team_id}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.015 }}
              className={cx("flex items-center gap-3 rounded-xl px-2 py-1.5", mine && "bg-team/15 ring-1 ring-team-text/30")}
            >
              <span className={cx("w-6 text-right text-xs font-semibold tabular", i < 3 ? "text-team-text" : "text-muted")}>{i + 1}</span>
              <TeamLogo espnAbbr={t?.espn_abbr} size={22} />
              <span className="w-28 truncate text-[13px] font-medium">{t?.nickname}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: mine ? "var(--team-text)" : t?.colors.primary, opacity: mine ? 1 : 0.75 }}
                  initial={{ width: 0 }}
                  animate={{ width: `${norm(r[category.field])}%` }}
                  transition={{ delay: 0.1 + i * 0.015, type: "spring", stiffness: 80, damping: 16 }}
                />
              </div>
              <span className="w-16 text-right text-[13px] font-semibold tabular">{pyFormat(category.format, r[category.field])}</span>
            </motion.div>
          );
        })}
      </div>
    </Panel>
  );
}
