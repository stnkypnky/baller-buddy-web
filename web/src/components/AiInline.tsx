import { Sparkles, Square, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAiOneShot, type ChatRequest } from "../lib/ai";
import { announce } from "../lib/announcer";
import { useSelection } from "../lib/queries";
import { AssistantBody, ModelPicker } from "./AiParts";
import { Button, Panel, SectionTitle } from "./ui";

/** A card that streams a one-shot AI take (matchup, news brief, game recap). */
export function AiInline({
  title,
  cta,
  mode,
  focus,
  context,
  eventId,
  disabled,
  resetKey,
  speakable,
  hint = "Get an instant AI read using the numbers on this page.",
}: {
  title: string;
  cta: string;
  mode: NonNullable<ChatRequest["mode"]>;
  focus?: ChatRequest["focus"];
  context?: string;
  eventId?: string;
  disabled?: boolean;
  resetKey?: string;
  speakable?: boolean;
  hint?: string;
}) {
  const sel = useSelection();
  const { turn, run, stop } = useAiOneShot(resetKey);
  const [speaking, setSpeaking] = useState(false);
  const busy = !!turn?.streaming;

  const stopSpeech = useRef<(() => void) | null>(null);
  const hush = () => {
    stopSpeech.current?.();
    stopSpeech.current = null;
    setSpeaking(false);
  };

  useEffect(() => () => stopSpeech.current?.(), []);
  useEffect(hush, [resetKey]);

  function speak() {
    if (!turn?.content) return;
    if (speaking) return hush();
    stopSpeech.current = announce(turn.content, () => {
      stopSpeech.current = null;
      setSpeaking(false);
    });
    setSpeaking(true);
  }

  return (
    <Panel className="relative overflow-hidden p-5">
      <div className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-team/20 blur-3xl" />
      <SectionTitle
        className="flex-wrap"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <ModelPicker />
            {speakable && turn?.content && !busy && (
              <Button variant="outline" size="sm" onClick={speak}>
                {speaking ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                {speaking ? "Stop" : "Read it to me"}
              </Button>
            )}
            {busy ? (
              <Button variant="outline" size="sm" onClick={stop}>
                <Square className="size-3.5" /> Stop
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={disabled}
                onClick={() => {
                  hush();
                  run({ mode, focus, context, event_id: eventId, team_id: sel.team?.id, season: sel.season });
                }}
              >
                <Sparkles className="size-4" /> {turn ? "Regenerate" : cta}
              </Button>
            )}
          </div>
        }
      >
        <span className="flex items-center gap-2 whitespace-nowrap">
          <Sparkles className="size-4 text-team-text" /> {title}
        </span>
      </SectionTitle>
      {turn ? (
        <div className="relative">
          {turn.meta && (
            <div className="mb-2 text-[11px] text-faint">
              {turn.meta.provider_name} · {turn.meta.model}
            </div>
          )}
          <AssistantBody turn={turn} />
        </div>
      ) : (
        <div className="relative text-sm text-muted">{hint}</div>
      )}
    </Panel>
  );
}
