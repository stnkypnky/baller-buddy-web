import { MapPin, UsersRound, Whistle } from "lucide-react";
import { useState } from "react";
import { useGameStory, useSelection } from "../lib/queries";
import type { StoryPlayer, StorySide } from "../lib/types";
import { BoxScore } from "./BoxScore";
import { cx, Drawer, ErrorState, Headshot, Segmented, Skeleton, TeamLogo } from "./ui";
import { motion } from "motion/react";

export interface StoryTarget {
  gameId: string;
  title: string;
  subtitle?: string;
}

/** Game Story drawer: line score, top performers by Game Score, venue trivia; or the full box score. */
export function GameStoryDrawer({ target, onClose }: { target: StoryTarget | null; onClose: () => void }) {
  const { data, isLoading, error, refetch } = useGameStory(target?.gameId);
  const sel = useSelection();
  const logo = (s?: StorySide) => (s?.abbr ? sel.byAbbr.get(s.abbr)?.espn_abbr : undefined);
  const [tab, setTab] = useState<"story" | "box">("story");

  return (
    <Drawer
      open={!!target}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setTab("story");
        }
      }}
      title={target?.title ?? ""}
      subtitle={target?.subtitle}
      width={860}
    >
      <Segmented
        className="mb-5"
        value={tab}
        onChange={setTab}
        options={[
          { value: "story", label: "Game story" },
          { value: "box", label: "Box score" },
        ]}
      />
      {/* Only mounted when picked, so the box loads on demand. */}
      {tab === "box" && target && <BoxScore source="nba" id={target.gameId} />}
      {tab === "story" && isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </div>
      )}
      {tab === "story" && error && <ErrorState error={error} onRetry={() => refetch()} />}
      {tab === "story" && data && (
        <div className="space-y-6">
          {(data.label || data.series) && (
            <div className="flex flex-wrap gap-2">
              {[data.label, data.series].filter(Boolean).map((t) => (
                <span key={t} className="rounded-full border border-warn/30 bg-warn/10 px-3 py-1 text-xs text-warn">
                  {t}
                </span>
              ))}
            </div>
          )}

          {/* Scoreboard */}
          <div className="panel overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 py-6">
              {(["away", "home"] as const).map((side, i) => {
                const s = data[side];
                const other = data[side === "away" ? "home" : "away"];
                const won = (s.score ?? 0) > (other.score ?? 0);
                return (
                  <div key={side} className={cx("flex items-center gap-4", i === 1 && "col-start-3 flex-row-reverse text-right")}>
                    <TeamLogo espnAbbr={logo(s)} size={64} />
                    <div>
                      <div className="eyebrow">{side}</div>
                      <div className="display text-2xl font-bold">{s.abbr}</div>
                    </div>
                    <div className={cx("display ml-auto text-6xl font-bold tabular", i === 1 && "mr-auto ml-0", won ? "text-fg" : "text-faint")}>
                      {s.score}
                    </div>
                  </div>
                );
              })}
              <div className="col-start-2 row-start-1 text-xs font-semibold uppercase tracking-widest text-muted">Final</div>
            </div>
            {!!data.home.periods?.length && <LineScore away={data.away} home={data.home} />}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {(["away", "home"] as const).map((side) => (
              <Performers key={side} side={data[side]} logo={logo(data[side])} />
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs">
            {data.arena && <Fact icon={<MapPin />} label="Venue" value={data.arena} />}
            {!!data.attendance && <Fact icon={<UsersRound />} label="Attendance" value={data.attendance.toLocaleString()} />}
            {!!data.officials?.length && <Fact icon={<Whistle />} label="Officials" value={data.officials.join(", ")} />}
          </div>
        </div>
      )}
    </Drawer>
  );
}

function LineScore({ away, home }: { away: StorySide; home: StorySide }) {
  const n = Math.max(away.periods?.length ?? 0, home.periods?.length ?? 0);
  const label = (i: number) => (i < 4 ? `Q${i + 1}` : n - 4 > 1 ? `OT${i - 3}` : "OT");
  return (
    <table className="phone-scroll w-full border-t border-line text-sm tabular">
      <thead>
        <tr className="text-[11px] uppercase tracking-wider text-muted">
          <th className="py-2 pl-6 text-left font-medium">Team</th>
          {Array.from({ length: n }, (_, i) => (
            <th key={i} className="py-2 font-medium">
              {label(i)}
            </th>
          ))}
          <th className="py-2 pr-6 text-right font-medium">T</th>
        </tr>
      </thead>
      <tbody>
        {[away, home].map((s, r) => {
          const other = r === 0 ? home : away;
          return (
            <tr key={r} className="border-t border-line/60">
              <td className="py-2 pl-6 font-semibold">{s.abbr}</td>
              {s.periods?.map((p, i) => (
                <td key={i} className={cx("py-2 text-center", p > (other.periods?.[i] ?? 0) ? "text-fg" : "text-muted")}>
                  {p}
                </td>
              ))}
              <td className="py-2 pr-6 text-right font-bold">{s.score}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Performers({ side, logo }: { side: StorySide; logo?: string }) {
  const players = (side.players ?? []).slice(0, 5);
  const max = Math.max(...players.map((p) => p.gmsc), 1);
  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <TeamLogo espnAbbr={logo} size={22} />
        <span className="eyebrow">{side.abbr} · Top performers</span>
      </div>
      <div className="space-y-2.5">
        {players.map((p, i) => (
          <PerformerRow key={p.pid || p.name} p={p} max={max} rank={i} />
        ))}
        {!players.length && <div className="py-6 text-center text-xs text-muted">No box score</div>}
      </div>
    </div>
  );
}

function PerformerRow({ p, max, rank }: { p: StoryPlayer; max: number; rank: number }) {
  return (
    <div className="flex items-center gap-3">
      <Headshot pid={p.pid} name={p.name} className="size-10 shrink-0 rounded-full bg-surface-2" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-semibold">{p.name}</span>
          <span className="text-[11px] text-muted tabular">GmSc {p.gmsc}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
          <motion.div
            className="h-full rounded-full bg-team-text"
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(4, (p.gmsc / max) * 100)}%` }}
            transition={{ delay: 0.1 + rank * 0.05, type: "spring", stiffness: 120, damping: 20 }}
          />
        </div>
        <div className="mt-1 text-[11px] text-muted tabular">
          {p.pts} PTS · {p.reb} REB · {p.ast} AST{p.stl ? ` · ${p.stl} STL` : ""}
          {p.blk ? ` · ${p.blk} BLK` : ""} · {p.pm > 0 ? "+" : ""}
          {p.pm}
        </div>
      </div>
    </div>
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="panel flex gap-3 p-3">
      <div className="text-team-text [&>svg]:size-4">{icon}</div>
      <div className="min-w-0">
        <div className="eyebrow text-[10px]">{label}</div>
        <div className="mt-0.5 text-fg/90">{value}</div>
      </div>
    </div>
  );
}
