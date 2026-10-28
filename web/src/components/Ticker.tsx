import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { timeLocal } from "../lib/format";
import { useLive, useSelection } from "../lib/queries";
import type { LiveGame } from "../lib/types";
import { cx, TeamLogo } from "./ui";

// Scroll speed in pixels per second, the same on every screen.
const SPEED = 30;

/** Scrolling scoreboard in the title bar. Scores flash when they change. */
export default function Ticker() {
  const { data } = useLive();
  const games = data?.games ?? [];
  const strip = useRef<HTMLDivElement>(null);
  const paused = useRef(false);

  // Moved frame by frame from the real clock rather than by a CSS animation:
  // Safari on iPad ran the CSS version far too fast. The strip holds the games
  // twice, so after half its width it wraps around seamlessly.
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    let raf = 0;
    let last = performance.now();
    let x = 0;
    const step = (t: number) => {
      const dt = Math.min(t - last, 100) / 1000; // no jump after the tab was hidden
      last = t;
      const half = el.scrollWidth / 2;
      if (!paused.current && half > 0) {
        x = (x + SPEED * dt) % half;
        el.style.transform = `translate3d(${-x}px, 0, 0)`;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [games.length]);

  if (!games.length) return null;
  const live = games.filter((g) => g.state === "in").length;
  // duplicate the strip so the marquee loops seamlessly
  const doubled = [...games, ...games];
  return (
    <div
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      className="no-drag group relative mx-auto flex h-7 max-w-[760px] items-center overflow-hidden rounded-full border border-line/70 bg-black/30 [mask-image:linear-gradient(90deg,transparent,black_6%,black_94%,transparent)]"
    >
      <div ref={strip} className="marquee flex shrink-0 items-center gap-6 pl-6 will-change-transform">
        {doubled.map((g, i) => (
          <TickerItem key={`${g.id}-${i}`} g={g} />
        ))}
      </div>
      {live > 0 && (
        <div className="absolute top-1/2 left-2 flex -translate-y-1/2 items-center">
          <span className="live-dot scale-75" />
        </div>
      )}
    </div>
  );
}

function TickerItem({ g }: { g: LiveGame }) {
  const sel = useSelection();
  const navigate = useNavigate();
  const mine = !!sel.team && [g.home.espn_id, g.away.espn_id].includes(sel.team.espn_id);
  const status = g.state === "pre" ? timeLocal(g.date_utc) : g.status_text.replace(" - ", " ");
  return (
    <button
      onClick={() => navigate(`/pulse/${g.id}`)}
      className={cx("flex shrink-0 items-center gap-2 text-[11px] whitespace-nowrap hover:text-fg", mine ? "text-fg" : "text-fg/75")}
    >
      {[g.away, g.home].map((s, i) => {
        const t = sel.byName.get(s.app_name);
        return (
          <span key={i} className="flex items-center gap-1">
            <TeamLogo espnAbbr={t?.espn_abbr} size={14} />
            <span className={cx("font-semibold", mine && t?.id === sel.team?.id && "text-team-text")}>{s.abbr}</span>
            {g.state !== "pre" && <Score value={s.score} />}
          </span>
        );
      })}
      <span className={cx("font-medium", g.state === "in" ? "text-loss" : "text-faint")}>{status}</span>
    </button>
  );
}

function Score({ value }: { value: string }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1600);
      return () => clearTimeout(t);
    }
  }, [value]);
  return (
    <motion.span
      animate={flash ? { scale: [1, 1.35, 1], color: ["#e9ecf2", "#ffd34d", "#e9ecf2"] } : {}}
      transition={{ duration: 1.2 }}
      className="font-bold tabular"
    >
      {value}
    </motion.span>
  );
}
