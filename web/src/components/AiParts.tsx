import * as Popover from "@radix-ui/react-popover";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Box,
  Brain,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Cpu,
  Database,
  Globe,
  HeartPulse,
  History,
  ListOrdered,
  Medal,
  Newspaper,
  Radio,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Square,
  Swords,
  Target,
  Trophy,
  TriangleAlert,
  User,
  Users,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { useNavigate } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { TOOL_LABELS, type AiSettings, type ModelInfo, type ProviderInfo, type ToolChip, type Turn } from "../lib/ai";
import { api, openExternal, put } from "../lib/api";
import { useApp } from "../lib/store";
import { BallMark } from "./shell";
import { cx, Spinner } from "./ui";

const TOOL_ICONS: Record<string, ReactNode> = {
  get_standings: <Trophy />,
  get_team_report: <ClipboardList />,
  get_team_games: <CalendarDays />,
  get_roster: <Users />,
  get_player: <User />,
  get_game_details: <Box />,
  get_scoreboard: <Radio />,
  get_upcoming_games: <CalendarDays />,
  compare_teams: <Swords />,
  get_league_leaders: <BarChart3 />,
  get_player_leaders: <Medal />,
  get_news: <Newspaper />,
  get_injuries: <HeartPulse />,
  get_game_previews: <Target />,
  get_team_history: <History />,
  get_season_games: <ListOrdered />,
  web_search: <Globe />,
};

export function ToolChips({ tools, lookedUp }: { tools?: ToolChip[]; lookedUp?: string[] }) {
  if (!tools?.length && !lookedUp?.length) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {/* What the app looked up before the model answered */}
      {lookedUp?.map((l) => (
        <span
          key={`g-${l}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-fg/80 [&>svg]:size-3.5"
          title="Current data the app looked up for this question"
        >
          <Database className="text-team-text" />
          {l}
        </span>
      ))}
      <AnimatePresence initial={false}>
        {(tools ?? []).map((t) => (
          <motion.span
            key={t.id}
            layout
            initial={{ opacity: 0, scale: 0.8, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium [&>svg]:size-3.5",
              !t.done && "border-team-text/30 bg-team/10 text-team-text",
              t.done && t.ok && "border-line bg-white/[0.04] text-fg/80",
              t.done && !t.ok && "border-loss/30 bg-loss/10 text-loss",
            )}
            title={JSON.stringify(t.args)}
          >
            {t.done ? TOOL_ICONS[t.name] ?? <Cpu /> : <Spinner className="size-3.5 text-team-text" />}
            {t.done ? t.summary || TOOL_LABELS[t.name] : `${TOOL_LABELS[t.name] ?? t.name}…`}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function Thinking({ text, active }: { text?: string; active: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text && !active) return null;
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3 py-1 text-[11px] text-muted hover:text-fg"
      >
        <Brain className={cx("size-3.5", active && "animate-pulse text-team-text")} />
        {active ? "Thinking…" : "Reasoning"}
        {text && <span className="tabular text-faint">{Math.round(text.length / 4)} tokens</span>}
        <ChevronDown className={cx("size-3 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence>
        {open && text && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="scroll mt-2 max-h-60 rounded-xl border border-line bg-black/25 p-3 text-xs leading-relaxed whitespace-pre-wrap text-muted select-text">
              {text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) openExternal(href);
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {text.replace(/<br\s*\/?>/gi, " · ")}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Body of an assistant turn: tools, answer, error, and a footer that says
 * plainly whether the model is still working or done. The model's reasoning
 * (and the step-by-step status log) only show with the developer option on.
 */
export function AssistantBody({ turn }: { turn: Turn }) {
  const showReasoning = useApp((s) => s.showReasoning);
  return (
    <div>
      {showReasoning && !!turn.status?.length && (
        <div className="mb-2 space-y-0.5">
          {turn.status.map((s, i) => (
            <div key={i} className="text-[11px] text-muted">
              {s}
            </div>
          ))}
        </div>
      )}
      <ToolChips tools={turn.tools} lookedUp={turn.grounding} />
      {showReasoning && <Thinking text={turn.reasoning} active={!!turn.streaming && !turn.content && !!turn.reasoning} />}
      {turn.content && <Markdown text={turn.content} />}
      {turn.error && (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-loss/25 bg-loss/10 px-3 py-2 text-xs text-loss">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>{turn.error}</span>
        </div>
      )}
      {turn.streaming ? <WorkingIndicator turn={turn} /> : <DoneLine turn={turn} />}
    </div>
  );
}

/** What the model is doing right now, under a spinning ball, so it's obvious it isn't finished. */
function WorkingIndicator({ turn }: { turn: Turn }) {
  const pending = [...(turn.tools ?? [])].reverse().find((t) => !t.done);
  const lastStatus = turn.status?.[turn.status.length - 1];
  const phase =
    (turn.last === "status" || turn.last === "revision") && lastStatus
      ? lastStatus
      : turn.last === "grounding" && turn.grounding?.length
        ? `Looked up ${turn.grounding.slice(0, 3).join(", ")}…`
      : pending
        ? `Pulling ${(TOOL_LABELS[pending.name] ?? "data").toLowerCase()}…`
        : turn.last === "token"
          ? "Writing…"
          : turn.last === "reasoning"
            ? "Thinking it through…"
            : turn.last === "tool_result"
              ? "Reading the numbers…"
              : turn.meta
                ? `${turn.meta.provider_name.split(" (")[0]} is on it…`
                : "Starting…";
  return (
    <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-team/15 py-1 pr-3 pl-1.5">
      <BallMark className="size-[18px] animate-spin [animation-duration:1.1s]" />
      <motion.span
        key={phase}
        className="text-xs font-semibold text-fg"
        initial={{ opacity: 0, y: 3 }}
        animate={{ opacity: [1, 0.5, 1], y: 0 }}
        transition={{ opacity: { repeat: Infinity, duration: 1.4 }, y: { duration: 0.2 } }}
      >
        {phase}
      </motion.span>
    </div>
  );
}

/** A quiet "done" marker once the answer is complete (or stopped). */
function DoneLine({ turn }: { turn: Turn }) {
  if (!turn.startedAt || !turn.finishedAt) return null;
  if (turn.error && !turn.content) return null;
  const secs = Math.max(1, Math.round((turn.finishedAt - turn.startedAt) / 1000));
  const who = turn.meta ? ` · ${turn.meta.provider_name.split(" (")[0]}` : "";
  return (
    <div className="mt-3 flex items-center gap-1.5 text-[11px] text-faint">
      {turn.stopped ? <Square className="size-3 text-muted" /> : <CheckCircle2 className="size-3.5 text-win" />}
      {turn.stopped ? "Stopped" : `Done in ${secs}s`}
      {who}
      <FactCheckBadge turn={turn} />
    </div>
  );
}

/** How the fact-check went: every player the answer named, checked against current data. */
function FactCheckBadge({ turn }: { turn: Turn }) {
  const f = turn.factcheck;
  if (!f || turn.stopped) return null;
  if (f.unresolved) {
    return (
      <span className="ml-1 inline-flex items-center gap-1 text-warn" title={`Couldn't confirm: ${f.names.join(", ")}`}>
        <ShieldAlert className="size-3.5" /> Couldn't confirm {f.names.length} detail{f.names.length === 1 ? "" : "s"}
      </span>
    );
  }
  return (
    <span
      className="ml-1 inline-flex items-center gap-1 text-win/90"
      title={f.fixed ? `Corrected: ${f.names.join(", ")}` : f.checked ? `${f.checked} players and numbers checked against current data` : "Nothing to check"}
    >
      <ShieldCheck className="size-3.5" /> Fact-checked{f.fixed ? ` · fixed ${f.fixed}` : ""}
    </span>
  );
}

/* ── Provider / model picker ──────────────────────────────────────────────── */

export function useProviders() {
  return useQuery({
    queryKey: ["ai-providers"],
    queryFn: () => api<{ providers: ProviderInfo[]; settings: AiSettings }>("/ai/providers"),
    staleTime: 30_000,
  });
}

export function useModels(pid?: string, enabled = true) {
  return useQuery({
    queryKey: ["ai-models", pid],
    queryFn: () => api<{ models: ModelInfo[]; error?: string }>(`/ai/models/${pid}`),
    enabled: !!pid && enabled,
    staleTime: 600_000,
  });
}

export function ModelPicker() {
  const { data } = useProviders();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pid, setPid] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const active = data?.settings.provider;
  const browsing = pid ?? active;
  const models = useModels(browsing ?? undefined, open);
  const provider = data?.providers.find((p) => p.id === active);
  const curModel = data?.settings.model || provider?.model || (active === "lmstudio" ? "loaded model" : "");

  const list = useMemo(() => {
    const base = models.data?.models ?? [];
    const sugg = data?.providers.find((p) => p.id === browsing)?.suggested ?? [];
    const merged = [...sugg.filter((s) => !base.some((m) => m.id === s)).map((s) => ({ id: s, name: s })), ...base];
    const needle = q.trim().toLowerCase();
    return needle ? merged.filter((m) => m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle)) : merged;
  }, [models.data, q, browsing, data]);

  async function choose(provider: string, model: string) {
    await put("/ai/settings", { provider, model });
    await qc.invalidateQueries({ queryKey: ["ai-providers"] });
    setOpen(false);
    setPid(null);
    setQ("");
  }

  const providers = [...(data?.providers ?? [])].sort((a, b) => Number(b.available) - Number(a.available));

  return (
    <Popover.Root open={open} onOpenChange={(o) => (setOpen(o), o || setPid(null))}>
      <Popover.Trigger asChild>
        <button className="group flex h-10 items-center gap-2.5 rounded-full border border-line bg-surface pr-3 pl-1.5 transition-colors hover:border-team-text/30">
          <span className={cx("grid size-7 place-items-center rounded-full text-[10px] font-bold", provider?.available ? "bg-team text-team-on" : "bg-white/10 text-muted")}>
            {provider?.name.slice(0, 2).toUpperCase() ?? "AI"}
          </span>
          <span className="max-w-[260px] truncate text-left text-xs">
            <span className="font-semibold text-fg">{provider?.name ?? "Choose a model"}</span>
            {curModel && <span className="text-muted"> · {curModel}</span>}
          </span>
          <ChevronDown className="size-3.5 text-muted transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="z-[60] flex h-[420px] w-[600px] overflow-hidden rounded-2xl border border-line bg-[#0d1017]/95 shadow-2xl backdrop-blur-xl data-[state=open]:animate-[pop_.16s_ease-out] max-sm:h-[min(460px,70vh)] max-sm:w-[calc(100vw-1rem)] max-sm:flex-col"
        >
          {/* Phones: providers become a row of chips above the models. */}
          <div className="scroll w-[220px] shrink-0 border-r border-line p-2 max-sm:flex max-sm:w-full max-sm:gap-1 max-sm:overflow-x-auto max-sm:border-r-0 max-sm:border-b">
            {providers.map((p) => (
              <button
                key={p.id}
                onClick={() => (setPid(p.id), setQ(""))}
                className={cx(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-white/[0.06] max-sm:w-auto max-sm:shrink-0 max-sm:whitespace-nowrap",
                  browsing === p.id && "bg-white/[0.07]",
                  !p.available && "opacity-55",
                )}
              >
                <span className={cx("size-2 shrink-0 rounded-full", p.available ? "bg-win" : "bg-white/20")} />
                <span className="flex-1 truncate">{p.name}</span>
                {p.id === active && <Check className="size-3.5 text-team-text" />}
              </button>
            ))}
            <button
              onClick={() => (setOpen(false), navigate("/settings"))}
              className="mt-2 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-muted hover:bg-white/[0.06] hover:text-fg max-sm:mt-0 max-sm:w-auto max-sm:shrink-0 max-sm:whitespace-nowrap"
            >
              <Settings2 className="size-3.5" /> Manage providers & keys
            </button>
          </div>
          <div className="flex min-w-0 flex-1 flex-col p-2">
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-black/30 px-2.5">
              <Search className="size-3.5 text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search models…"
                className="h-9 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
              />
            </div>
            <div className="scroll min-h-0 flex-1">
              {!data?.providers.find((p) => p.id === browsing)?.available ? (
                <div className="p-6 text-center text-xs text-muted">
                  Not set up yet.{" "}
                  <button className="text-team-text underline" onClick={() => (setOpen(false), navigate("/settings"))}>
                    Add a key
                  </button>
                </div>
              ) : models.isLoading ? (
                <div className="grid place-items-center p-8">
                  <Spinner />
                </div>
              ) : (
                <>
                  {browsing === "lmstudio" && (
                    <ModelRow id="" label="Whatever model is loaded" active={active === "lmstudio" && !data?.settings.model} onClick={() => choose("lmstudio", "")} />
                  )}
                  {list.map((m) => (
                    <ModelRow
                      key={m.id}
                      id={m.id}
                      label={m.name !== m.id ? m.name : undefined}
                      active={active === browsing && curModel === m.id}
                      onClick={() => choose(browsing!, m.id)}
                    />
                  ))}
                  {!list.length && <div className="p-6 text-center text-xs text-muted">{models.data?.error ?? "No models found"}</div>}
                </>
              )}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ModelRow({ id, label, active, onClick }: { id: string; label?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cx("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06]", active && "bg-team/15")}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{label ?? id}</div>
        {label && id && <div className="truncate text-[11px] text-faint">{id}</div>}
      </div>
      {active && <Check className="size-3.5 shrink-0 text-team-text" />}
    </button>
  );
}

export function openKeyPage(url: string) {
  if (url) openExternal(url);
}
