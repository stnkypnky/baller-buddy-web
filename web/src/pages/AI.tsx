import * as Switch from "@radix-ui/react-switch";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Eraser, Globe, Square } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AssistantBody, ModelPicker, useProviders, useUsage } from "../components/AiParts";
import { BallMark } from "../components/shell";
import { cx, IconButton, TeamLogo, Tip } from "../components/ui";
import { sendChat, usedLabel, stopChat, useChatStore } from "../lib/ai";
import { useIsPhone } from "../lib/phone";
import { useSelection } from "../lib/queries";

export default function AIPage() {
  const sel = useSelection();
  const { turns, streaming, clear } = useChatStore();
  const providers = useProviders();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [web, setWeb] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const team = sel.team;
  const phone = useIsPhone();

  // Grow with what's actually in the box (wrapped lines and the placeholder
  // included), up to about six lines, then scroll.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(160, Math.max(44, el.scrollHeight))}px`;
  }, [text, phone]);

  useEffect(() => {
    if (providers.data) setWeb(providers.data.settings.web_default);
  }, [providers.data?.settings.web_default]);

  // Spend for the active provider (Claude, OpenAI); refreshed after each answer.
  const usage = useUsage();
  const credit = usedLabel(usage.data, providers.data?.settings.provider);
  useEffect(() => {
    if (!streaming) qc.invalidateQueries({ queryKey: ["ai-usage"] });
  }, [streaming, qc]);

  // Keep the newest tokens in view while streaming.
  useEffect(() => {
    const el = scroller.current?.closest(".scroll") as HTMLElement | null;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: streaming ? "auto" : "smooth" });
  }, [turns, streaming]);

  const suggestions = useMemo(() => {
    const n = team?.nickname ?? "team";
    return [
      { q: `How are the ${n} doing so far this season?`, tag: "Snapshot" },
      { q: `Who is the ${n}' most efficient scorer, and where does he get his shots?`, tag: "Players" },
      { q: `What happened in the ${n}' last game?`, tag: "Recap" },
      { q: `Compare the ${n} to the best team in the ${team?.conference ?? "league"}.`, tag: "Matchup" },
      { q: `Any injury or trade news around the ${n}?`, tag: "News", web: true },
      { q: "Which teams lead the league in net rating and pace?", tag: "League" },
    ];
  }, [team]);

  function submit(q = text, forceWeb = false) {
    if (!q.trim() || streaming) return;
    sendChat(q, { team_id: team?.id, season: sel.season, page: "AI Analyst", web: web || forceWeb });
    setText("");
    requestAnimationFrame(() => input.current?.focus());
  }

  const noProvider = providers.data && !providers.data.providers.some((p) => p.available);

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col">
      <div className="mb-4 flex items-center justify-between gap-3 pt-1 max-sm:flex-wrap">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl border border-line bg-black/30">
            <BallMark className="size-6" />
          </div>
          <div>
            <h1 className="display text-3xl leading-none font-bold uppercase">AI Analyst</h1>
            <div className="mt-1 text-xs text-muted">
              Pulls live stats with tools · {sel.season}
              {credit && <span className="text-win"> · {credit}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ModelPicker />
          <IconButton label="Clear conversation" onClick={clear} disabled={streaming || !turns.length}>
            <Eraser className="size-4" />
          </IconButton>
        </div>
      </div>

      <div ref={scroller} className="flex-1 space-y-6 pb-6">
        {!turns.length && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="pt-8 text-center">
            <div className="mx-auto mb-5 w-fit">
              <TeamLogo espnAbbr={team?.espn_abbr} size={84} glow />
            </div>
            <h2 className="display text-4xl font-bold uppercase max-sm:text-3xl">
              Ask anything about the <span className="text-team-text">{team?.nickname}</span>
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-muted">
              Your analyst can look up standings, rosters, player profiles, box scores, schedules, news and the web — then explain what it all means.
            </p>
            {noProvider && (
              <div className="mx-auto mt-5 max-w-lg rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-xs text-warn">
                No AI is set up yet. Start LM Studio, or add an API key in Settings → AI Providers.
              </div>
            )}
            <div className="mt-8 grid grid-cols-2 gap-3 text-left max-sm:grid-cols-1">
              {suggestions.map((s, i) => (
                <motion.button
                  key={s.q}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 * i }}
                  whileHover={{ y: -3 }}
                  onClick={() => submit(s.q, !!s.web)}
                  className="panel panel-hover p-4 text-left"
                >
                  <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-team-text">
                    {s.web && <Globe className="size-3" />}
                    {s.tag}
                  </div>
                  <div className="text-[13px] text-fg/90">{s.q}</div>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {turns.map((t) =>
            t.role === "user" ? (
              <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-md bg-team/25 px-4 py-2.5 text-[14px] whitespace-pre-wrap text-fg ring-1 ring-team-text/20 select-text">
                  {t.content}
                </div>
              </motion.div>
            ) : (
              <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
                <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-line bg-black/30">
                  <BallMark className={cx("size-4", t.streaming && "animate-spin [animation-duration:2.4s]")} />
                </div>
                <div className="min-w-0 flex-1">
                  {t.meta && (
                    <div className="mb-1.5 text-[11px] text-faint">
                      {t.meta.provider_name} · {t.meta.model}
                      {!t.meta.tools && " · snapshot mode"}
                    </div>
                  )}
                  <AssistantBody turn={t} />
                </div>
              </motion.div>
            ),
          )}
        </AnimatePresence>
      </div>

      <div className="sticky bottom-0 pt-4 pb-1">
        <div className="panel flex items-end gap-2 !bg-[#0b0e14]/85 p-2 shadow-[0_-10px_40px_-10px_rgba(0,0,0,.7)] focus-within:border-team-text/40">
          <textarea
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={phone ? "Ask anything NBA…" : `Ask about the ${team?.nickname ?? "team"}, any player, or the league…`}
            className="max-h-40 min-h-[44px] min-w-0 flex-1 resize-none bg-transparent px-3 py-2.5 text-[14px] outline-none placeholder:text-faint"
          />
          {phone ? (
            <button
              onClick={() => setWeb(!web)}
              aria-pressed={web}
              aria-label="Also search the web"
              className={cx("grid size-11 shrink-0 place-items-center rounded-xl transition-colors", web ? "bg-team/20 text-team-text" : "text-muted")}
            >
              <Globe className="size-5" />
            </button>
          ) : (
            <Tip label="Also search the web for this question">
              <label className={cx("flex h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-xs", web ? "text-team-text" : "text-muted")}>
                <Globe className="size-4" />
                <Switch.Root checked={web} onCheckedChange={setWeb} className="relative h-5 w-9 rounded-full bg-white/10 transition-colors data-[state=checked]:bg-team">
                  <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
                </Switch.Root>
              </label>
            </Tip>
          )}
          {streaming ? (
            <button onClick={stopChat} className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/10 text-fg hover:bg-white/15" aria-label="Stop">
              <Square className="size-4" />
            </button>
          ) : (
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => submit()}
              disabled={!text.trim()}
              className="grid size-11 shrink-0 place-items-center rounded-xl bg-team text-team-on shadow-[0_8px_24px_-10px_var(--team-glow)] disabled:opacity-40"
              aria-label="Send"
            >
              <ArrowUp className="size-5" />
            </motion.button>
          )}
        </div>
        {!phone && <div className="mt-1.5 text-center text-[10px] text-faint">Enter to send · Shift+Enter for a new line</div>}
      </div>
    </div>
  );
}
