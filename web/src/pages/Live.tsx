import { Activity, ChevronLeft, ChevronRight, Radio, Tv } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BoxScore } from "../components/BoxScore";
import { Button, cx, Drawer, Empty, ErrorState, Item, Panel, Segmented, Skeleton, Stagger, TeamLogo } from "../components/ui";
import { timeLocal, yyyymmdd } from "../lib/format";
import { useGameBox, useLive, useSelection } from "../lib/queries";
import type { BoxStats, LiveGame } from "../lib/types";

export default function LivePage() {
  const sel = useSelection();
  const [offset, setOffset] = useState(0);
  const date = offset === 0 ? undefined : yyyymmdd(new Date(Date.now() + offset * 86400000));
  const { data, isLoading, error, refetch, dataUpdatedAt } = useLive(date);
  const [open, setOpen] = useState<LiveGame | null>(null);

  const games = useMemo(() => {
    const list = [...(data?.games ?? [])];
    const order = { in: 0, pre: 1, post: 2 } as const;
    const mine = (g: LiveGame) => (sel.team && [g.home.espn_id, g.away.espn_id].includes(sel.team.espn_id) ? -10 : 0);
    return list.sort((a, b) => mine(a) - mine(b) || order[a.state] - order[b.state] || a.date_utc.localeCompare(b.date_utc));
  }, [data, sel.team]);

  const liveCount = games.filter((g) => g.state === "in").length;
  const label = new Date(Date.now() + offset * 86400000).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <Stagger className="space-y-5">
      <Item className="flex items-end justify-between max-sm:flex-wrap max-sm:gap-3">
        <div>
          <div className="eyebrow flex items-center gap-2 whitespace-nowrap text-team-text">
            {liveCount > 0 ? (
              <>
                <span className="live-dot" /> {liveCount} live now
              </>
            ) : (
              "Scoreboard"
            )}
          </div>
          <h1 className="display text-4xl font-bold uppercase">{offset === 0 ? "Today" : label}</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="mr-2 text-xs text-muted max-sm:hidden">
            {dataUpdatedAt ? `Updated ${new Date(dataUpdatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : ""}
          </span>
          <Button variant="outline" size="sm" onClick={() => setOffset((o) => o - 1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant={offset === 0 ? "solid" : "outline"} size="sm" onClick={() => setOffset(0)}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOffset((o) => o + 1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </Item>

      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {isLoading && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))] gap-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[190px] rounded-[18px]" />
          ))}
        </div>
      )}
      {data && !games.length && <Empty icon={<Radio className="size-8" />} title="No games on this date" hint="Use the arrows to browse other days." />}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))] gap-4">
        {games.map((g, i) => (
          <Item key={g.id}>
            <GameCard g={g} index={i} onOpen={() => setOpen(g)} />
          </Item>
        ))}
      </div>

      <BoxDrawer game={open} onClose={() => setOpen(null)} />
    </Stagger>
  );
}

function GameCard({ g, onOpen }: { g: LiveGame; index: number; onOpen: () => void }) {
  const sel = useSelection();
  const mine = !!sel.team && [g.home.espn_id, g.away.espn_id].includes(sel.team.espn_id);
  const live = g.state === "in";
  const as = Number(g.away.score) || 0;
  const hs = Number(g.home.score) || 0;
  return (
    <motion.button
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      onClick={onOpen}
      className={cx("panel panel-hover relative w-full overflow-hidden p-5 text-left", mine && "ring-1 ring-team-text/40")}
    >
      {live && <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-loss to-transparent" />}
      <div className="mb-4 flex items-center justify-between text-xs">
        {live ? (
          <span className="flex items-center gap-2 font-semibold text-loss">
            <span className="live-dot" /> {g.status_text}
          </span>
        ) : g.state === "post" ? (
          <span className="font-semibold text-muted">{g.status_text}</span>
        ) : (
          <span className="font-semibold text-fg/80">{timeLocal(g.date_utc)}</span>
        )}
        <span className="flex items-center gap-1.5 truncate text-muted">
          {g.broadcast && (
            <>
              <Tv className="size-3.5" /> {g.broadcast}
            </>
          )}
          {mine && <span className="ml-2 rounded-full bg-team px-2 py-0.5 text-[10px] font-bold text-team-on">YOUR TEAM</span>}
        </span>
      </div>
      {[
        { side: g.away, score: as, lead: as > hs },
        { side: g.home, score: hs, lead: hs > as },
      ].map(({ side, lead }, i) => {
        const t = sel.byName.get(side.app_name);
        const dim = g.state !== "pre" && !lead;
        return (
          <div key={i} className="flex items-center gap-3 py-1.5">
            <TeamLogo espnAbbr={t?.espn_abbr} size={40} />
            <div className="min-w-0 flex-1">
              <div className={cx("truncate text-[15px] font-semibold", dim && "text-muted")}>{t?.name ?? side.app_name}</div>
              <div className="text-[11px] text-faint">{side.record}</div>
            </div>
            {g.state !== "pre" && (
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={side.score}
                  initial={{ y: -14, opacity: 0, color: "#fff" }}
                  animate={{ y: 0, opacity: 1, color: dim ? "#596174" : "#e9ecf2" }}
                  exit={{ y: 14, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 22 }}
                  className="display text-4xl font-bold tabular"
                >
                  {side.score}
                </motion.span>
              </AnimatePresence>
            )}
          </div>
        );
      })}
    </motion.button>
  );
}

const pct = (m: number, a: number) => (a ? ((m / a) * 100).toFixed(1) : "–");

const BOX_ROWS: { label: string; v: (s: BoxStats) => string | number }[] = [
  { label: "Field goals", v: (s) => `${s.fgm}-${s.fga}` },
  { label: "FG%", v: (s) => pct(s.fgm, s.fga) },
  { label: "Three pointers", v: (s) => `${s.tpm}-${s.tpa}` },
  { label: "3P%", v: (s) => pct(s.tpm, s.tpa) },
  { label: "Free throws", v: (s) => `${s.ftm}-${s.fta}` },
  { label: "Rebounds", v: (s) => s.reb },
  { label: "Assists", v: (s) => s.ast },
  { label: "Steals", v: (s) => s.stl },
  { label: "Blocks", v: (s) => s.blk },
  { label: "Turnovers", v: (s) => s.tov },
];

/** Team totals side by side, from the same (shared) box score query as the player tables. */
function TeamStats({ eventId }: { eventId: string }) {
  const { data, isLoading } = useGameBox("espn", eventId);
  if (isLoading) return <Skeleton className="h-72" />;
  if (!data?.away || !data.home) return <Empty title="Box score unavailable" />;
  const { away, home } = data;
  return (
    <Panel className="p-4">
      <table className="phone-scroll w-full text-[13px] tabular">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-muted">
            <th className="pb-2 text-right font-medium">{away.abbr}</th>
            <th className="pb-2 font-medium" />
            <th className="pb-2 text-left font-medium">{home.abbr}</th>
          </tr>
        </thead>
        <tbody>
          {BOX_ROWS.map((r) => (
            <tr key={r.label} className="border-t border-line/50">
              <td className="py-2 text-right font-semibold">{r.v(away.totals)}</td>
              <td className="py-2 text-center text-xs text-muted">{r.label}</td>
              <td className="py-2 text-left font-semibold">{r.v(home.totals)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function BoxDrawer({ game, onClose }: { game: LiveGame | null; onClose: () => void }) {
  const sel = useSelection();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"players" | "team">("players");
  const away = game ? sel.byName.get(game.away.app_name) : undefined;
  const home = game ? sel.byName.get(game.home.app_name) : undefined;
  return (
    <Drawer
      open={!!game}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setTab("players");
        }
      }}
      title={game ? `${game.away.abbr} @ ${game.home.abbr}` : ""}
      subtitle={game?.status_text}
      width={860}
    >
      {game && (
        <div className="space-y-5">
          <Panel className="flex items-center justify-around px-6 py-6">
            {[
              { t: away, s: game.away },
              { t: home, s: game.home },
            ].map(({ t, s }, i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <TeamLogo espnAbbr={t?.espn_abbr} size={72} />
                <div className="display text-5xl font-bold tabular">{game.state === "pre" ? "–" : s.score}</div>
                <div className="text-xs text-muted">{s.record}</div>
              </div>
            ))}
          </Panel>
          <Button className="w-full" size="lg" onClick={() => navigate(`/pulse/${game.id}`)}>
            <Activity className="size-4" /> Open Game Pulse
          </Button>
          {game.state === "pre" ? (
            <Empty title="Box score appears at tip-off" />
          ) : (
            <>
              <Segmented
                value={tab}
                onChange={setTab}
                options={[
                  { value: "players", label: "Player stats" },
                  { value: "team", label: "Team stats" },
                ]}
              />
              {tab === "players" ? <BoxScore source="espn" id={game.id} /> : <TeamStats eventId={game.id} />}
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
