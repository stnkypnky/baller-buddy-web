import { ArrowDown, ArrowUp, LayoutGrid, List } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { PlayerStatus } from "../components/PlayerStatus";
import { cx, Empty, ErrorState, Headshot, Panel, Segmented, Skeleton, TeamLogo } from "../components/ui";
import { useAbsenceNotes, useRoster, useSelection } from "../lib/queries";
import { useApp } from "../lib/store";
import type { Player } from "../lib/types";

type SortKey = keyof Pick<Player, "mpg" | "ppg" | "rpg" | "apg" | "spg" | "bpg" | "fg_pct" | "fg3_pct" | "plus_minus" | "gp" | "name">;

const COLS: { key: SortKey; label: string; fmt?: (p: Player) => string }[] = [
  { key: "gp", label: "GP" },
  { key: "mpg", label: "MIN" },
  { key: "ppg", label: "PTS" },
  { key: "rpg", label: "REB" },
  { key: "apg", label: "AST" },
  { key: "spg", label: "STL" },
  { key: "bpg", label: "BLK" },
  { key: "fg_pct", label: "FG%", fmt: (p) => p.fg_pct.toFixed(1) },
  { key: "fg3_pct", label: "3P%", fmt: (p) => p.fg3_pct.toFixed(1) },
  { key: "plus_minus", label: "+/-", fmt: (p) => `${p.plus_minus > 0 ? "+" : ""}${p.plus_minus}` },
];

/** Card sort options; the card's headline tile follows the selection. */
const CARD_KEYS = ["mpg", "ppg", "rpg", "apg", "spg", "bpg", "fg_pct", "fg3_pct", "plus_minus"] as const;
type CardKey = (typeof CARD_KEYS)[number];

const METRIC: Record<CardKey, { label: string; fmt: (v: number) => string }> = {
  mpg: { label: "MIN", fmt: (v) => v.toFixed(1) },
  ppg: { label: "PTS", fmt: (v) => v.toFixed(1) },
  rpg: { label: "REB", fmt: (v) => v.toFixed(1) },
  apg: { label: "AST", fmt: (v) => v.toFixed(1) },
  spg: { label: "STL", fmt: (v) => v.toFixed(1) },
  bpg: { label: "BLK", fmt: (v) => v.toFixed(1) },
  fg_pct: { label: "FG%", fmt: (v) => v.toFixed(1) },
  fg3_pct: { label: "3P%", fmt: (v) => v.toFixed(1) },
  plus_minus: { label: "+/-", fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}` },
};

export default function RosterPage() {
  const sel = useSelection();
  const { rosterView, setRosterView } = useApp();
  const { data, isLoading, error, refetch } = useRoster(sel.team?.id, sel.season);
  const notes = useAbsenceNotes(sel.team?.id, sel.season, !!data?.some((p) => p.absence));
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "mpg", desc: true });
  const navigate = useNavigate();
  const status = (p: Player, className?: string) => (
    <PlayerStatus p={p} season={sel.season} note={notes.data?.[p.pid]} noteLoading={notes.isLoading} className={className} />
  );

  const players = useMemo(() => {
    const list = [...(data ?? [])];
    list.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sort.desc ? -cmp : cmp;
    });
    return list;
  }, [data, sort]);

  // Column leaders get highlighted in the table.
  const best = useMemo(() => {
    const out: Partial<Record<SortKey, number>> = {};
    for (const c of COLS) out[c.key] = Math.max(...(data ?? []).map((p) => p[c.key] as number));
    return out;
  }, [data]);

  const open = (p: Player) => navigate(`/player/${p.pid}`);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div className="flex items-center gap-4">
          <TeamLogo espnAbbr={sel.team?.espn_abbr} size={52} glow />
          <div>
            <div className="eyebrow text-team-text">{sel.season}</div>
            <h1 className="display text-4xl font-bold uppercase">Roster</h1>
          </div>
          {data && <span className="mt-4 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-muted">{data.length} players</span>}
        </div>
        <div className="flex items-center gap-3">
          {rosterView === "cards" && (
            <Segmented
              size="sm"
              value={sort.key === "name" || sort.key === "gp" ? "mpg" : (sort.key as CardKey)}
              onChange={(k) => setSort({ key: k, desc: true })}
              options={CARD_KEYS.map((k) => ({ value: k, label: METRIC[k].label }))}
            />
          )}
          <Segmented
            size="sm"
            value={rosterView}
            onChange={setRosterView}
            options={[
              { value: "cards", label: <LayoutGrid className="size-4" /> },
              { value: "table", label: <List className="size-4" /> },
            ]}
          />
        </div>
      </div>

      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {isLoading && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-[300px] rounded-[18px]" />
          ))}
        </div>
      )}
      {data && !data.length && <Empty title="No roster available" hint="nba.com didn't return this team's roster. Try again later, or pick another season." />}

      {data && !!data.length && rosterView === "cards" && (
        <motion.div layout className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {players.map((p, i) => (
            <PlayerCard key={p.pid} p={p} index={i} onOpen={() => open(p)} sortKey={sort.key} status={status(p, "backdrop-blur")} />
          ))}
        </motion.div>
      )}

      {data && !!data.length && rosterView === "table" && (
        <Panel className="overflow-hidden">
          <table className="w-full text-[13px] tabular">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
                <Th label="Player" k="name" sort={sort} setSort={setSort} left />
                <th className="px-2 py-3 font-medium">Pos</th>
                {COLS.map((c) => (
                  <Th key={c.key} label={c.label} k={c.key} sort={sort} setSort={setSort} />
                ))}
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.pid} onClick={() => open(p)} className="cursor-pointer border-t border-line/50 transition-colors hover:bg-white/[0.035]">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      <Headshot pid={p.pid} name={p.name} className="size-9 rounded-full bg-surface-2" />
                      <span className="font-semibold">{p.name}</span>
                      {status(p)}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center text-muted">{p.pos || "—"}</td>
                  {COLS.map((c) => {
                    const v = p[c.key] as number;
                    return (
                      <td
                        key={c.key}
                        className={cx(
                          "px-2 py-2 text-right",
                          v === best[c.key] && c.key !== "gp" ? "font-bold text-team-text" : "text-fg/85",
                          c.key === "plus_minus" && (v > 0 ? "text-win" : v < 0 ? "text-loss" : ""),
                        )}
                      >
                        {c.fmt ? c.fmt(p) : v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

function Th({
  label,
  k,
  sort,
  setSort,
  left,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; desc: boolean };
  setSort: (s: { key: SortKey; desc: boolean }) => void;
  left?: boolean;
}) {
  const active = sort.key === k;
  return (
    <th className={cx("px-2 py-3 font-medium", left ? "pl-4 text-left" : "text-right")}>
      <button
        onClick={() => setSort({ key: k, desc: active ? !sort.desc : k !== "name" })}
        className={cx("inline-flex items-center gap-1 uppercase hover:text-fg", active && "text-team-text")}
      >
        {label}
        {active && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </th>
  );
}

function PlayerCard({ p, index, onOpen, sortKey, status }: { p: Player; index: number; onOpen: () => void; sortKey: SortKey; status: ReactNode }) {
  // Headline = the sorted metric; then points/rebounds/assists, minus the headline.
  const head: CardKey = (CARD_KEYS as readonly string[]).includes(sortKey) ? (sortKey as CardKey) : "mpg";
  const keys: CardKey[] = [head, ...(["ppg", "rpg", "apg"] as const).filter((k) => k !== head)].slice(0, 3);
  const stats = keys.map((k) => ({ k, label: METRIC[k].label, v: METRIC[k].fmt(p[k]) }));
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.035, type: "spring", stiffness: 260, damping: 26 }}
      whileHover={{ y: -5 }}
      whileTap={{ scale: 0.98 }}
      onClick={onOpen}
      className="panel panel-hover group overflow-hidden text-left"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-b from-team/35 via-team/10 to-transparent">
        <div className="absolute inset-0 opacity-30 [background:radial-gradient(circle_at_50%_120%,var(--team)_0%,transparent_60%)]" />
        <Headshot pid={p.pid} name={p.name} className="relative h-full w-full transition-transform duration-500 group-hover:scale-[1.06]" />
        <div className="absolute top-3 left-3 rounded-md bg-black/50 px-2 py-0.5 text-[11px] font-bold text-fg/90 backdrop-blur">
          {p.pos || "—"}
        </div>
        <div className="absolute top-3 right-3 rounded-md bg-black/50 px-2 py-0.5 text-[11px] text-muted backdrop-blur tabular">
          {p.mpg} MIN
        </div>
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0b0e14] to-transparent" />
        {(p.injury || p.absence) && <div className="absolute bottom-2 left-3 flex">{status}</div>}
      </div>
      <div className="px-4 pt-1 pb-4">
        <div className="display truncate text-[22px] font-bold uppercase leading-tight">{p.name}</div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {stats.map((s) => (
            <div key={s.k} className={cx("rounded-xl py-2 text-center", s.k === head ? "bg-team/20 ring-1 ring-team-text/30" : "bg-white/[0.04]")}>
              <div className={cx("display text-xl font-bold tabular", s.k === head && "text-team-text")}>{s.v}</div>
              <div className={cx("text-[10px] font-semibold tracking-wider", s.k === head ? "text-team-text" : "text-muted")}>{s.label}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-1.5">
          <Bar label="FG%" v={p.fg_pct} max={65} />
          <Bar label="3P%" v={p.fg3_pct} max={50} />
        </div>
      </div>
    </motion.button>
  );
}

function Bar({ label, v, max }: { label: string; v: number; max: number }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-7 text-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full bg-team-text/80" style={{ width: `${Math.min(100, (v / max) * 100)}%` }} />
      </div>
      <span className="w-9 text-right tabular text-fg/80">{v.toFixed(1)}</span>
    </div>
  );
}
