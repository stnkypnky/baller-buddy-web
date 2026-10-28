import * as Switch from "@radix-ui/react-switch";
import { useNavigate } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CalendarDays, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { GameStoryDrawer, type StoryTarget } from "../components/GameStory";
import { cx, Empty, ErrorState, Item, Panel, SectionTitle, Segmented, Skeleton, Stagger, TeamLogo } from "../components/ui";
import { dayLabel, shortDate, timeLocal } from "../lib/format";
import { useScores, useSelection } from "../lib/queries";
import type { ScoreGame, SeasonType, UpcomingGame } from "../lib/types";

type Row = { kind: "date"; date: string; count: number } | { kind: "game"; g: ScoreGame };

export default function ScoresPage() {
  const sel = useSelection();
  const { data, isLoading, error, refetch } = useScores(sel.season);
  const [type, setType] = useState<SeasonType>("regular");
  const [mine, setMine] = useState(false);
  const [query, setQuery] = useState("");
  const [story, setStory] = useState<StoryTarget | null>(null);

  const myAbbr = sel.team?.abbr;

  const games = useMemo(() => {
    if (!data) return [];
    let list =
      type === "playoffs"
        ? data.playoffs
        : type === "full"
          ? [...data.playoffs, ...data.regular].sort((a, b) => (a.date + a.game_id < b.date + b.game_id ? 1 : -1))
          : data.regular;
    if (mine && myAbbr) list = list.filter((g) => g.home.abbr === myAbbr || g.away.abbr === myAbbr);
    const q = query.trim().toUpperCase();
    if (q) list = list.filter((g) => g.home.abbr.includes(q) || g.away.abbr.includes(q));
    return list;
  }, [data, type, mine, myAbbr, query]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    let header = null as { kind: "date"; date: string; count: number } | null;
    for (const g of games) {
      if (g.date !== header?.date) {
        header = { kind: "date", date: g.date, count: 0 };
        out.push(header);
      }
      header.count++;
      out.push({ kind: "game", g });
    }
    return out;
  }, [games]);

  const upcoming = useMemo(() => {
    const u = data?.upcoming ?? [];
    return mine && sel.team ? u.filter((g) => g.home.app_name === sel.team!.name || g.away.app_name === sel.team!.name) : u;
  }, [data, mine, sel.team]);

  return (
    <Stagger className="space-y-5">
      <Item className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow text-team-text">{sel.season}</div>
          <h1 className="display text-4xl font-bold uppercase">Scores</h1>
        </div>
        <div className="flex items-center gap-3 max-sm:w-full max-sm:flex-wrap max-sm:gap-2">
          <div className="flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3 max-sm:flex-1">
            <Search className="size-4 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Team (e.g. LAL)"
              className="w-32 bg-transparent text-sm outline-none placeholder:text-faint max-sm:w-full max-sm:min-w-0"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted">
            <Switch.Root
              checked={mine}
              onCheckedChange={setMine}
              className="relative h-6 w-11 rounded-full bg-white/10 transition-colors data-[state=checked]:bg-team"
            >
              <Switch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
            </Switch.Root>
            {sel.team?.nickname} only
          </label>
          <Segmented
            value={type}
            onChange={setType}
            options={[
              { value: "regular", label: "Regular" },
              { value: "playoffs", label: "Playoffs" },
              { value: "full", label: "All" },
            ]}
          />
        </div>
      </Item>

      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {!!upcoming.length && (
        <Item>
          <Panel className="p-5">
            <SectionTitle right={<span className="text-xs text-muted">Next 14 days · local time</span>}>Upcoming</SectionTitle>
            <UpcomingStrip games={upcoming.slice(0, 24)} />
          </Panel>
        </Item>
      )}

      <Item>
        <Panel className="p-2">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : rows.length ? (
            <GameList rows={rows} myAbbr={myAbbr} onOpen={setStory} />
          ) : (
            <Empty icon={<CalendarDays className="size-8" />} title="No completed games match" hint={type === "playoffs" ? "Playoffs haven't started for this season." : undefined} />
          )}
        </Panel>
      </Item>

      <GameStoryDrawer target={story} onClose={() => setStory(null)} />
    </Stagger>
  );
}

function UpcomingStrip({ games }: { games: UpcomingGame[] }) {
  const sel = useSelection();
  return (
    <div className="scroll -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
      {games.map((g) => {
        const away = sel.byName.get(g.away.app_name);
        const home = sel.byName.get(g.home.app_name);
        const mine = sel.team && (away?.id === sel.team.id || home?.id === sel.team.id);
        return (
          <div key={g.id} className={cx("min-w-[180px] rounded-2xl border border-line bg-black/20 p-3", mine && "border-team-text/40 bg-team/10")}>
            <div className="mb-2 flex items-center justify-between text-[11px] text-muted">
              <span>{dayLabel(g.date_utc)}</span>
              <span className="font-semibold text-fg/80">{timeLocal(g.date_utc)}</span>
            </div>
            {[away, home].map((t, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5">
                <TeamLogo espnAbbr={t?.espn_abbr} size={20} />
                <span className="text-[13px] font-semibold">{t?.abbr}</span>
                <span className="text-[11px] text-faint">{i ? "home" : "away"}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function GameList({ rows, myAbbr, onOpen }: { rows: Row[]; myAbbr?: string; onOpen: (t: StoryTarget) => void }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i].kind === "date" ? 40 : 58),
    overscan: 12,
  });
  return (
    <div ref={parentRef} className="scroll h-[640px]">
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((it) => {
          const row = rows[it.index];
          return (
            <div key={it.key} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${it.start}px)`, height: it.size }}>
              {row.kind === "date" ? (
                <div className="flex h-full items-end gap-3 px-4 pb-1.5">
                  <span className="display text-[15px] font-bold uppercase tracking-wider">{shortDate(row.date, true)}</span>
                  <span className="text-[11px] text-faint">
                    {row.count} game{row.count > 1 ? "s" : ""}
                  </span>
                </div>
              ) : (
                <ScoreRow g={row.g} myAbbr={myAbbr} onOpen={onOpen} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScoreRow({ g, myAbbr, onOpen }: { g: ScoreGame; myAbbr?: string; onOpen: (t: StoryTarget) => void }) {
  const sel = useSelection();
  const navigate = useNavigate();
  const away = sel.byAbbr.get(g.away.abbr);
  const home = sel.byAbbr.get(g.home.abbr);
  const awayWon = g.away.pts > g.home.pts;
  const mine = g.home.abbr === myAbbr || g.away.abbr === myAbbr;
  const margin = Math.abs(g.away.pts - g.home.pts);
  return (
    <button
      onClick={() =>
        // A final nba.com hasn't logged yet has no Game Story; Game Pulse (ESPN) has it.
        g.pending
          ? navigate(`/pulse/${g.espn_id}`)
          : onOpen({ gameId: g.game_id, title: `${g.away.abbr} @ ${g.home.abbr}`, subtitle: `${shortDate(g.date, true)}${g.ot ? " · OT" : ""}` })
      }
      className={cx(
        "mx-1 grid h-[52px] w-[calc(100%-0.5rem)] grid-cols-[1fr_auto_1fr_minmax(120px,auto)] items-center gap-4 rounded-xl px-4 text-left transition-colors hover:bg-white/[0.045] max-sm:grid-cols-[1fr_auto_1fr_auto] max-sm:gap-2 max-sm:px-2",
        mine && "bg-team/10 ring-1 ring-team-text/25",
      )}
    >
      <div className="flex min-w-0 items-center justify-end gap-3 max-sm:gap-1.5">
        <span className={cx("text-[13px] font-semibold", awayWon ? "text-fg" : "text-muted")}>
          <span className="max-sm:hidden">{away?.name ?? g.away.abbr}</span>
          <span className="sm:hidden">{g.away.abbr}</span>
        </span>
        <TeamLogo espnAbbr={away?.espn_abbr} size={28} />
      </div>
      <div className="display flex w-28 items-center justify-center gap-2 text-2xl font-bold tabular max-sm:w-auto max-sm:gap-1 max-sm:text-lg">
        <span className={awayWon ? "text-fg" : "text-faint"}>{g.away.pts}</span>
        <span className="text-sm text-faint">–</span>
        <span className={!awayWon ? "text-fg" : "text-faint"}>{g.home.pts}</span>
      </div>
      <div className="flex min-w-0 items-center gap-3 max-sm:gap-1.5">
        <TeamLogo espnAbbr={home?.espn_abbr} size={28} />
        <span className={cx("text-[13px] font-semibold", !awayWon ? "text-fg" : "text-muted")}>
          <span className="max-sm:hidden">{home?.name ?? g.home.abbr}</span>
          <span className="sm:hidden">{g.home.abbr}</span>
        </span>
      </div>
      {/* Phones: a narrow column; a long tag wraps to two lines within the row. */}
      <div className="flex justify-end gap-1.5 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider max-sm:w-[68px] max-sm:flex-col max-sm:items-end max-sm:gap-0.5 max-sm:whitespace-normal max-sm:text-right max-sm:text-[9px] max-sm:leading-tight max-sm:tracking-normal">
        {g.ot && <span className="rounded bg-warn/15 px-1.5 py-0.5 text-warn">OT</span>}
        {g.pending && <span className="rounded bg-white/10 px-1.5 py-0.5 text-muted" title="Final on ESPN; nba.com's box score comes later">Box score soon</span>}
        {margin <= 3 && <span className="rounded bg-white/10 px-1.5 py-0.5 text-fg/80">Thriller</span>}
        {margin >= 25 && <span className="rounded bg-white/5 px-1.5 py-0.5 text-muted">Blowout</span>}
      </div>
    </button>
  );
}
