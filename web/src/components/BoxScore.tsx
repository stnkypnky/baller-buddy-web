import { Radio } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGameBox, useSelection } from "../lib/queries";
import type { BoxPlayer, BoxSide, BoxStats } from "../lib/types";
import { cx, Empty, ErrorState, Segmented, Skeleton, TeamLogo, Tip } from "./ui";

type Col = { label: string; title: string; v: (s: BoxStats) => string | number; key?: keyof BoxStats; wide?: boolean };

const shot = (m: number, a: number) => `${m}-${a}`;
const pct = (m: number, a: number) => (a ? `${((m / a) * 100).toFixed(1)}%` : "–");
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** Stat columns after MIN; `key` marks the ones whose team high gets highlighted. */
const COLS: Col[] = [
  { label: "PTS", title: "Points", v: (s) => s.pts, key: "pts" },
  { label: "REB", title: "Rebounds", v: (s) => s.reb, key: "reb" },
  { label: "AST", title: "Assists", v: (s) => s.ast, key: "ast" },
  { label: "STL", title: "Steals", v: (s) => s.stl, key: "stl" },
  { label: "BLK", title: "Blocks", v: (s) => s.blk, key: "blk" },
  { label: "TO", title: "Turnovers", v: (s) => s.tov },
  { label: "PF", title: "Personal fouls", v: (s) => s.pf },
  { label: "FG", title: "Field goals made-attempted", v: (s) => shot(s.fgm, s.fga), wide: true },
  { label: "3P", title: "Three-pointers made-attempted", v: (s) => shot(s.tpm, s.tpa), wide: true },
  { label: "FT", title: "Free throws made-attempted", v: (s) => shot(s.ftm, s.fta), wide: true },
  { label: "OR", title: "Offensive rebounds", v: (s) => s.oreb },
  { label: "DR", title: "Defensive rebounds", v: (s) => s.dreb },
  { label: "+/-", title: "Plus/minus while on the floor", v: (s) => signed(s.pm) },
];

/**
 * Full box score for one game: every player's line, team by team, with
 * starters, bench, totals and who sat. Loads when shown (see useGameBox).
 */
export function BoxScore({ source, id }: { source: "nba" | "espn"; id: string }) {
  const { data, isLoading, error, refetch } = useGameBox(source, id);
  const sel = useSelection();
  const teamOf = (abbr?: string) =>
    abbr ? (sel.byAbbr.get(abbr) ?? sel.teams.find((t) => t.espn_abbr?.toLowerCase() === abbr.toLowerCase())) : undefined;
  // Open on the selected team's side when it played.
  const mine = data && (["away", "home"] as const).find((s) => teamOf(data[s]?.abbr)?.id === sel.team?.id);
  const [picked, setPicked] = useState<"away" | "home" | null>(null);
  const side = picked ?? mine ?? "away";

  if (isLoading)
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-96" />
      </div>
    );
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const box = data?.[side];
  if (!data || !data.away?.players.length || !data.home?.players.length)
    return <Empty title="No box score yet" hint="Player stats appear once the game tips off." />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Segmented
          value={side}
          onChange={setPicked}
          options={(["away", "home"] as const).map((s) => ({
            value: s,
            label: (
              <span className="flex items-center gap-2">
                <TeamLogo espnAbbr={teamOf(data[s]?.abbr)?.espn_abbr} size={18} />
                {data[s]?.abbr}
                <span className="tabular opacity-70">{data[s]?.totals.pts}</span>
              </span>
            ),
          }))}
        />
        {!data.final && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-loss">
            <Radio className="size-3.5" /> Live · updates every 20s
          </span>
        )}
      </div>
      {box && <TeamTable box={box} teamId={teamOf(box.abbr)?.id} linkable={data.source === "nba"} />}
    </div>
  );
}

function TeamTable({ box, teamId, linkable }: { box: BoxSide; teamId?: number; linkable: boolean }) {
  const navigate = useNavigate();
  const played = box.players.filter((p) => !p.dnp);
  const starters = played.filter((p) => p.starter);
  const bench = played.filter((p) => !p.starter);
  const sat = box.players.filter((p) => p.dnp);
  const high = Object.fromEntries(
    COLS.filter((c) => c.key).map((c) => [c.key, Math.max(...played.map((p) => p[c.key!]), 1)]),
  ) as Partial<Record<keyof BoxStats, number>>;
  const open = linkable && teamId ? (p: BoxPlayer) => navigate(`/player/${p.pid}?team=${teamId}`) : undefined;
  const t = box.totals;

  return (
    <div className="space-y-3">
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[760px] text-[12.5px] tabular">
          <thead>
            <tr className="border-b border-line text-[10.5px] uppercase tracking-wider text-muted">
              <th className="py-2.5 pl-4 text-left font-medium">Player</th>
              <th className="px-1.5 py-2.5 text-right font-medium">Min</th>
              {COLS.map((c) => (
                <th key={c.label} className={cx("px-1.5 py-2.5 text-right font-medium", c.wide && "min-w-[46px]")}>
                  <Tip label={c.title}>
                    <span className="cursor-help">{c.label}</span>
                  </Tip>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Group label="Starters" />
            {starters.map((p) => (
              <Row key={p.pid || p.espn_id || p.name} p={p} high={high} onOpen={open} />
            ))}
            {!!bench.length && <Group label="Bench" />}
            {bench.map((p) => (
              <Row key={p.pid || p.espn_id || p.name} p={p} high={high} onOpen={open} />
            ))}
            <tr className="border-t-2 border-line bg-white/[0.03] font-semibold">
              <td className="py-2 pl-4">Totals</td>
              <td />
              {COLS.map((c) => (
                <td key={c.label} className="px-1.5 py-2 text-right">
                  {c.label === "+/-" ? "" : c.v(t)}
                </td>
              ))}
            </tr>
            <tr className="text-[11px] text-muted">
              <td className="pb-2 pl-4" />
              <td colSpan={8} />
              <td className="px-1.5 pb-2 text-right">{pct(t.fgm, t.fga)}</td>
              <td className="px-1.5 pb-2 text-right">{pct(t.tpm, t.tpa)}</td>
              <td className="px-1.5 pb-2 text-right">{pct(t.ftm, t.fta)}</td>
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
      </div>
      {!!sat.length && (
        <div className="text-xs leading-relaxed text-muted">
          <span className="eyebrow mr-2 text-[10px]">Did not play</span>
          {sat.map((p, i) => (
            <span key={p.pid || p.espn_id || p.name}>
              {i > 0 && " · "}
              <span className="text-fg/80">{p.name}</span> <span className="text-faint">({p.dnp})</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Group({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={2 + COLS.length} className="pt-3 pb-1 pl-4 text-[10px] font-semibold uppercase tracking-widest text-team-text">
        {label}
      </td>
    </tr>
  );
}

function Row({ p, high, onOpen }: { p: BoxPlayer; high: Partial<Record<keyof BoxStats, number>>; onOpen?: (p: BoxPlayer) => void }) {
  return (
    <tr
      onClick={onOpen && (() => onOpen(p))}
      className={cx("border-t border-line/40 transition-colors", onOpen && "cursor-pointer hover:bg-white/[0.035]")}
    >
      <td className="max-w-[170px] py-1.5 pl-4">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate font-semibold">{p.name}</span>
          {p.pos && <span className="shrink-0 text-[10px] text-faint">{p.pos}</span>}
        </div>
      </td>
      <td className="px-1.5 py-1.5 text-right text-muted">{p.min}</td>
      {COLS.map((c) => {
        const v = c.v(p);
        const top = c.key && p[c.key] > 0 && p[c.key] === high[c.key];
        return (
          <td
            key={c.label}
            className={cx(
              "px-1.5 py-1.5 text-right",
              top ? "font-bold text-team-text" : "text-fg/85",
              c.label === "+/-" && (p.pm > 0 ? "text-win" : p.pm < 0 ? "text-loss" : ""),
            )}
          >
            {v}
          </td>
        );
      })}
    </tr>
  );
}
