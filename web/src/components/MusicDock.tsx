import * as Slider from "@radix-ui/react-slider";
import {
  ChevronUp,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  artUrl,
  cycleLoop,
  fmtTime,
  initPlayer,
  next,
  playIndex,
  prev,
  seek,
  setVolume,
  stop,
  toggleExpanded,
  toggleMute,
  togglePlay,
  toggleShuffle,
  usePlayer,
  type Track,
} from "../lib/player";
import { cx, Tip } from "./ui";

export default function MusicDock() {
  const p = usePlayer();
  const navigate = useNavigate();
  const track = p.index >= 0 ? p.tracks[p.index] : undefined;
  const [scrub, setScrub] = useState<number | null>(null);

  useEffect(() => {
    initPlayer().catch(() => usePlayer.setState({ ready: true }));
  }, []);

  // Space toggles playback when focus isn't in a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code === "Space" && !["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const empty = p.ready && !p.tracks.length;
  const playing = p.state === "playing";
  const pos = scrub ?? p.position;
  const dur = p.duration || track?.duration || 0;

  return (
    <div className="relative z-40 shrink-0">
      <AnimatePresence>{p.expanded && <Playlist />}</AnimatePresence>

      {/* The three-part desktop dock needs ~950px; narrower (tablets, phones on their side), the
          controls take only the room they need and the track title gets the rest. */}
      <div className="relative grid h-[72px] grid-cols-[minmax(240px,1fr)_minmax(380px,560px)_minmax(240px,1fr)] items-center gap-6 border-t border-line/60 bg-black/45 px-5 backdrop-blur-xl max-lg:grid-cols-[minmax(0,1fr)_auto_auto] max-lg:gap-4 max-lg:px-4 max-sm:h-16 max-sm:gap-2 max-sm:px-3 short:h-14">
        {/* progress hairline across the top of the dock */}
        <div className="absolute inset-x-0 top-0 h-[2px] bg-white/[0.04]">
          <div className="h-full bg-team-text shadow-[0_0_12px_var(--team-glow)]" style={{ width: dur ? `${(pos / dur) * 100}%` : 0 }} />
        </div>

        {/* now playing */}
        <div className="flex min-w-0 items-center gap-3">
          {empty ? (
            <button onClick={() => navigate("/settings")} className="text-left text-xs text-muted hover:text-fg">
              <div className="font-semibold text-fg/80">No music yet</div>
              Add a music folder in Settings
            </button>
          ) : (
            <>
              <Cover track={track} spinning={playing} size={46} />
              <NowPlaying track={track} pulse={p.justAdvanced} />
            </>
          )}
        </div>

        {/* transport */}
        <div className={cx("flex flex-col items-center gap-1", empty && "pointer-events-none opacity-40")}>
          <div className="flex items-center gap-1.5">
            <span className="contents max-sm:hidden">
              <Ctl label={p.shuffle ? "Shuffle on" : "Shuffle off"} onClick={toggleShuffle} active={p.shuffle}>
                <Shuffle className="size-4" />
              </Ctl>
            </span>
            <Ctl label="Previous (restarts if >3s in)" onClick={prev}>
              <SkipBack className="size-[18px] fill-current" />
            </Ctl>
            <motion.button
              whileTap={{ scale: 0.88 }}
              whileHover={{ scale: 1.06 }}
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Play"}
              className="grid size-10 place-items-center rounded-full bg-team text-team-on shadow-[0_6px_22px_-6px_var(--team-glow)]"
            >
              {playing ? <Pause className="size-[18px] fill-current" /> : <Play className="size-[18px] translate-x-px fill-current" />}
            </motion.button>
            <Ctl label="Next" onClick={() => next()}>
              <SkipForward className="size-[18px] fill-current" />
            </Ctl>
            <span className="contents max-sm:hidden">
              <Ctl label={{ none: "Loop off", all: "Loop all", one: "Loop one" }[p.loop]} onClick={cycleLoop} active={p.loop !== "none"}>
                {p.loop === "one" ? <Repeat1 className="size-4" /> : <Repeat className="size-4" />}
              </Ctl>
              <Ctl label="Stop" onClick={stop}>
                <Square className="size-3.5 fill-current" />
              </Ctl>
            </span>
          </div>
          <div className="flex w-full items-center gap-2.5 text-[10px] text-muted tabular max-sm:hidden short:hidden">
            <span className="w-9 text-right">{fmtTime(pos)}</span>
            <Slider.Root
              className="group relative flex h-3 flex-1 touch-none items-center select-none"
              value={[pos]}
              max={dur || 1}
              step={0.5}
              onValueChange={([v]) => setScrub(v)}
              onValueCommit={([v]) => {
                seek(v);
                setScrub(null);
              }}
              aria-label="Seek"
            >
              <Slider.Track className="relative h-1 grow overflow-hidden rounded-full bg-white/10">
                <Slider.Range className="absolute h-full rounded-full bg-team-text" />
              </Slider.Track>
              <Slider.Thumb className="block size-3 scale-0 rounded-full bg-white shadow transition-transform group-hover:scale-100 focus:scale-100 focus:outline-none" />
            </Slider.Root>
            <span className="w-9">{fmtTime(dur)}</span>
          </div>
        </div>

        {/* volume + playlist */}
        <div className="flex items-center justify-end gap-3 max-sm:gap-0">
          <span className="contents max-sm:hidden">
          <span className="contents max-lg:hidden">
            <Equalizer active={playing} />
          </span>
          <Ctl label={p.muted ? "Unmute" : "Mute"} onClick={toggleMute}>
            {p.muted || p.volume === 0 ? <VolumeX className="size-4" /> : p.volume < 50 ? <Volume1 className="size-4" /> : <Volume2 className="size-4" />}
          </Ctl>
          <Slider.Root
            className="group relative flex h-3 w-28 touch-none items-center select-none max-lg:w-20"
            value={[p.muted ? 0 : p.volume]}
            max={100}
            step={1}
            onValueChange={([v]) => setVolume(v)}
            aria-label="Volume"
          >
            <Slider.Track className="relative h-1 grow overflow-hidden rounded-full bg-white/10">
              <Slider.Range className="absolute h-full rounded-full bg-fg/70 group-hover:bg-team-text" />
            </Slider.Track>
            <Slider.Thumb className="block size-3 scale-0 rounded-full bg-white shadow transition-transform group-hover:scale-100 focus:outline-none" />
          </Slider.Root>
          </span>
          <Ctl label={p.expanded ? "Hide playlist" : "Show playlist"} onClick={() => toggleExpanded()} active={p.expanded}>
            {p.expanded ? <ChevronUp className="size-4 rotate-180" /> : <ListMusic className="size-4" />}
          </Ctl>
        </div>
      </div>
    </div>
  );
}

function Ctl({ children, label, onClick, active }: { children: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <Tip label={label}>
      <motion.button
        whileTap={{ scale: 0.85 }}
        onClick={onClick}
        aria-label={label}
        className={cx(
          "relative grid size-8 place-items-center rounded-full transition-colors",
          active ? "text-team-text" : "text-muted hover:text-fg",
        )}
      >
        {children}
        {active && <span className="absolute bottom-0.5 size-1 rounded-full bg-team-text" />}
      </motion.button>
    </Tip>
  );
}

/** Generated cover for tracks without embedded art: a vinyl in an
 *  artist-seeded colour. */
function hue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function Cover({ track, spinning, size }: { track?: Track; spinning?: boolean; size: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [track?.id]);
  if (!track) return <div className="shrink-0 rounded-lg bg-surface-2" style={{ width: size, height: size }} />;
  if (track.has_art && !failed)
    return <img src={artUrl(track)} onError={() => setFailed(true)} className="shrink-0 rounded-lg object-cover" style={{ width: size, height: size }} alt="" />;
  const h = hue(track.artist || track.title);
  return (
    <div
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-lg"
      style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 60% 14%))` }}
    >
      <div
        className={cx("relative rounded-full", spinning && "animate-spin [animation-duration:3s]")}
        style={{
          width: size * 0.78,
          height: size * 0.78,
          background: `repeating-radial-gradient(circle, #0b0b0d 0 1.5px, #18181c 1.5px 3px)`,
          boxShadow: "0 2px 8px rgba(0,0,0,.5)",
        }}
      >
        <div className="absolute inset-[34%] rounded-full" style={{ background: `hsl(${h} 70% 55%)` }} />
        <div className="absolute inset-[46%] rounded-full bg-black/80" />
      </div>
    </div>
  );
}

function NowPlaying({ track, pulse }: { track?: Track; pulse: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(0);
  useEffect(() => {
    if (ref.current && inner.current) setOverflow(Math.max(0, inner.current.scrollWidth - ref.current.clientWidth));
  }, [track]);
  const recent = Date.now() - pulse < 1500;
  return (
    <div className="min-w-0">
      <div ref={ref} className="overflow-hidden">
        <motion.div
          key={`${track?.id}-${pulse}`}
          ref={inner}
          initial={recent ? { color: "var(--team-text)" } : false}
          animate={{ color: "var(--text)", x: overflow ? [0, 0, -overflow - 16, -overflow - 16, 0] : 0 }}
          transition={{
            color: { duration: 1.2 },
            x: overflow ? { duration: 10 + overflow / 20, times: [0, 0.15, 0.6, 0.75, 1], repeat: Infinity, ease: "linear" } : undefined,
          }}
          className="text-[13px] font-semibold whitespace-nowrap"
        >
          {track?.title ?? "No track selected"}
        </motion.div>
      </div>
      <div className="truncate text-[11px] text-muted">{track?.artist || track?.album || " "}</div>
    </div>
  );
}

function Equalizer({ active }: { active: boolean }) {
  return (
    <div className="flex h-4 items-end gap-[3px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full bg-team-text"
          animate={active ? { height: ["30%", "100%", "45%", "85%", "30%"] } : { height: "25%" }}
          transition={active ? { repeat: Infinity, duration: 0.9 + i * 0.17, ease: "easeInOut" } : { duration: 0.3 }}
          style={{ opacity: active ? 0.9 : 0.35 }}
        />
      ))}
    </div>
  );
}

function Playlist() {
  const { tracks, index, state } = usePlayer();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return tracks
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => !n || `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(n));
  }, [tracks, q]);
  const activeRef = useRef<HTMLButtonElement>(null);
  // Braces matter: newer Chrome's scrollIntoView returns a Promise, which React
  // would take for a clean-up function and crash calling when the list closes.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center" });
  }, []);
  const total = tracks.reduce((s, t) => s + t.duration, 0);

  return (
    <motion.div
      initial={{ y: 30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 30, opacity: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className="absolute right-4 bottom-[80px] flex h-[420px] w-[460px] flex-col overflow-hidden rounded-2xl border border-line bg-[#0b0e14]/95 shadow-2xl backdrop-blur-xl max-sm:right-2 max-sm:bottom-[72px] max-sm:left-2 max-sm:h-[60vh] max-sm:w-auto short:bottom-[62px] short:h-[calc(100dvh-80px)]"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <div className="display text-lg font-bold uppercase">Playlist</div>
          <div className="text-[11px] text-muted">
            {tracks.length} tracks · {Math.round(total / 60)} min
          </div>
        </div>
        <div className="flex h-9 items-center gap-2 rounded-xl border border-line bg-black/30 px-2.5">
          <Search className="size-3.5 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-36 bg-transparent text-xs outline-none placeholder:text-faint" />
        </div>
      </div>
      <div className="scroll flex-1 p-1.5">
        {list.map(({ t, i }) => {
          const on = i === index;
          return (
            <button
              key={t.id}
              ref={on ? activeRef : undefined}
              onClick={() => playIndex(i)}
              className={cx("group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.05]", on && "bg-team/15")}
            >
              <span className="w-6 text-center text-[11px] text-faint tabular">
                {on && state === "playing" ? <Equalizer active /> : i + 1}
              </span>
              <Cover track={t} size={34} />
              <div className="min-w-0 flex-1">
                <div className={cx("truncate text-[13px] font-medium", on && "text-team-text")}>{t.title}</div>
                <div className="truncate text-[11px] text-muted">{t.artist}</div>
              </div>
              <span className="text-[11px] text-faint tabular">{fmtTime(t.duration)}</span>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
