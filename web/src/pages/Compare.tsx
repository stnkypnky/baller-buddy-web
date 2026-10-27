import { motion } from "motion/react";
import { useState } from "react";
import { AiInline } from "../components/AiInline";
import { GameStoryDrawer, type StoryTarget } from "../components/GameStory";
import { TeamSwitcher } from "../components/shell";
import { cx, Empty, ErrorState, Item, Panel, SectionTitle, Segmented, Skeleton, Stagger, TeamLogo } from "../components/ui";
import { readableOnDark } from "../lib/theme";
import { useCompare, useSelection } from "../lib/queries";
import { useApp } from "../lib/store";
import type { Dashboard, Team } from "../lib/types";

const ROWS: { key: keyof Dashboard; label: string; pct?: boolean; signed?: boolean; lowerBetter?: boolean }[] = [
  { key: "pts", label: "Points" },
  { key: "reb", label: "Rebounds" },
  { key: "ast", label: "Assists" },
  { key: "stl", label: "Steals" },
  { key: "blk", label: "Blocks" },
  { key: "tov", label: "Turnovers", lowerBetter: true },
  { key: "fg_pct", label: "FG%", pct: true },
  { key: "fg3_pct", label: "3P%", pct: true },
  { key: "ft_pct", label: "FT%", pct: true },
  { key: "plus_minus", label: "+/-", signed: true },
];

export default function ComparePage() {
  const sel = useSelection();
  const { compareId, setCompare, compareType, setCompareType, setTeam } = useApp();
  const a = sel.team;
  const fallback = sel.teams.find((t) => t.name === (a?.name === "Los Angeles Lakers" ? "Golden State Warriors" : "Los Angeles Lakers"));
  const b = (compareId && compareId !== a?.id ? sel.byId.get(compareId) : undefined) ?? fallback;
  const { data, isLoading, error, refetch } = useCompare(a?.id, b?.id, sel.season, compareType);
  const [story, setStory] = useState<StoryTarget | null>(null);

  const ca = a ? readableOnDark(a.colors.primary) : "#fff";
  const cb = b ? readableOnDark(b.colors.primary) : "#fff";

  return (
    <Stagger className="space-y-5">
      <Item className="flex items-end justify-between">
        <div>
          <div className="eyebrow text-team-text">{sel.season}</div>
          <h1 className="display text-4xl font-bold uppercase">Head to head</h1>
        </div>
        <Segmented
          value={compareType}
          onChange={setCompareType}
          options={[
            { value: "regular", label: "Regular" },
            { value: "playoffs", label: "Playoffs" },
            { value: "full", label: "Full Year" },
          ]}
        />
      </Item>

      <Item>
        <Panel className="relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{ background: `linear-gradient(100deg, ${a?.colors.primary}55 0%, transparent 45%, transparent 55%, ${b?.colors.primary}55 100%)` }}
          />
          <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-6 px-8 py-7">
            <Side team={a} record={data?.a.record} color={ca} picker={<TeamSwitcher compact onChange={(t) => setTeam(t.id)} exclude={b?.id} />} />
            <div className="flex flex-col items-center">
              <motion.div
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="display grid size-16 place-items-center rounded-full border border-white/15 bg-black/40 text-2xl font-bold"
              >
                VS
              </motion.div>
              {data && (
                <div className="mt-3 text-center text-xs text-muted">
                  {data.series.length ? (
                    <>
                      Series{" "}
                      <span className="font-semibold text-fg tabular">
                        {data.series_record[0]}–{data.series_record[1]}
                      </span>
                    </>
                  ) : (
                    "No meetings yet"
                  )}
                </div>
              )}
            </div>
            <Side
              team={b}
              record={data?.b.record}
              color={cb}
              right
              picker={<TeamSwitcher compact value={b} onChange={(t: Team) => setCompare(t.id)} exclude={a?.id} />}
            />
          </div>
        </Panel>
      </Item>

      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      <div className="grid grid-cols-12 gap-5">
        <Item className="col-span-12 xl:col-span-7">
          <Panel className="p-6">
            <SectionTitle>Tale of the tape</SectionTitle>
            {isLoading ? (
              <Skeleton className="h-[420px]" />
            ) : data && "pts" in data.a.dash && "pts" in data.b.dash ? (
              <div className="space-y-3">
                {ROWS.map((r, i) => {
                  const lv = (data.a.dash as Dashboard)[r.key] as number;
                  const rv = (data.b.dash as Dashboard)[r.key] as number;
                  const lBetter = r.lowerBetter ? lv < rv : lv > rv;
                  const rBetter = r.lowerBetter ? rv < lv : rv > lv;
                  const fmt = (v: number) => (r.pct ? `${v.toFixed(1)}%` : r.signed ? `${v > 0 ? "+" : ""}${v.toFixed(1)}` : v.toFixed(1));
                  // share of the combined magnitude (offset so negatives still draw)
                  const off = r.signed ? Math.max(0, -Math.min(lv, rv)) + 1 : 0;
                  const total = lv + rv + off * 2 || 1;
                  return (
                    <div key={r.key} className="grid grid-cols-[64px_1fr_96px_1fr_64px] items-center gap-3">
                      <span className={cx("text-right text-[15px] font-bold tabular", !lBetter && "text-muted")} style={lBetter ? { color: ca } : undefined}>
                        {fmt(lv)}
                      </span>
                      <div className="flex h-2.5 justify-end overflow-hidden rounded-full bg-white/[0.04]">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: ca, opacity: lBetter ? 1 : 0.35 }}
                          initial={{ width: 0 }}
                          animate={{ width: `${((lv + off) / total) * 100}%` }}
                          transition={{ delay: i * 0.04, type: "spring", stiffness: 90, damping: 18 }}
                        />
                      </div>
                      <span className="text-center text-[11px] font-semibold uppercase tracking-wider text-muted">{r.label}</span>
                      <div className="flex h-2.5 overflow-hidden rounded-full bg-white/[0.04]">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: cb, opacity: rBetter ? 1 : 0.35 }}
                          initial={{ width: 0 }}
                          animate={{ width: `${((rv + off) / total) * 100}%` }}
                          transition={{ delay: i * 0.04, type: "spring", stiffness: 90, damping: 18 }}
                        />
                      </div>
                      <span className={cx("text-[15px] font-bold tabular", !rBetter && "text-muted")} style={rBetter ? { color: cb } : undefined}>
                        {fmt(rv)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty title={compareType === "playoffs" ? "One of these teams has no playoff games this season" : "Not enough games yet to compare"} />
            )}
          </Panel>
        </Item>

        <Item className="col-span-12 xl:col-span-5">
          <Panel className="h-full p-6">
            <SectionTitle>{compareType === "playoffs" ? "Playoff series" : compareType === "full" ? "All meetings" : "Season series"}</SectionTitle>
            {isLoading ? (
              <Skeleton className="h-48" />
            ) : data?.series.length ? (
              <div className="space-y-2">
                {data.series.map((g) => (
                  <button
                    key={g.game_id}
                    onClick={() => setStory({ gameId: g.game_id, title: g.summary.replace(/\s+/g, " "), subtitle: g.date })}
                    className="flex w-full items-center gap-3 rounded-xl border border-line bg-black/20 px-4 py-3 text-left transition-colors hover:bg-white/[0.05]"
                  >
                    <span className={cx("grid size-7 place-items-center rounded-md text-xs font-bold", g.win ? "bg-win/15 text-win" : "bg-loss/15 text-loss")}>
                      {g.win ? "W" : "L"}
                    </span>
                    <div className="flex-1">
                      <div className="text-[13px] font-semibold tabular">{g.summary.replace(/\s+/g, " ")}</div>
                      <div className="text-[11px] text-muted">{g.date}</div>
                    </div>
                    {g.po && <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-bold text-warn">PO</span>}
                  </button>
                ))}
              </div>
            ) : (
              <Empty title={`${a?.nickname} and ${b?.nickname} haven't met in this view`} />
            )}
          </Panel>
        </Item>
      </div>

      <Item>
        <AiInline
          title="AI matchup breakdown"
          cta="Break down this matchup"
          disabled={!data}
          mode="matchup"
          context={data?.context ?? ""}
          resetKey={`${a?.id}-${b?.id}-${sel.season}-${compareType}`}
        />
      </Item>

      <GameStoryDrawer target={story} onClose={() => setStory(null)} />
    </Stagger>
  );
}

function Side({
  team,
  record,
  color,
  right,
  picker,
}: {
  team?: Team;
  record?: [number, number] | null;
  color: string;
  right?: boolean;
  picker: React.ReactNode;
}) {
  return (
    <div className={cx("flex items-center gap-5", right && "flex-row-reverse text-right")}>
      <motion.div key={team?.id} initial={{ opacity: 0, x: right ? 30 : -30 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", stiffness: 160, damping: 18 }}>
        <TeamLogo espnAbbr={team?.espn_abbr} size={110} className="drop-shadow-[0_14px_30px_rgba(0,0,0,.5)]" />
      </motion.div>
      <div className={cx("flex flex-col gap-3", right && "items-end")}>
        {picker}
        <div className="display text-5xl font-bold tabular" style={{ color }}>
          {record ? `${record[0]}–${record[1]}` : "—"}
        </div>
      </div>
    </div>
  );
}
