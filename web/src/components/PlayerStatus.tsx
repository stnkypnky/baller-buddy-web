import type { AbsenceNote, Player, PlayerAbsence } from "../lib/types";
import { InjuryBadge, Tip } from "./ui";

export const MISSED = "Missed season";

export function returnDate(d: string) {
  return d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}

/** "2020-21: 61 games (NOP)" lines for the seasons around a missed one. */
export function AbsenceContext({ a, acquired }: { a: PlayerAbsence; acquired?: string }) {
  const line = (s: PlayerAbsence["prev"]) =>
    s && (
      <div key={s.season}>
        <span className="text-muted">{s.season}:</span> {s.gp ? `${s.gp} game${s.gp === 1 ? "" : "s"}${s.team ? ` (${s.team})` : ""}` : "didn't play"}
      </div>
    );
  return (
    <div className="space-y-0.5 text-fg/80">
      {line(a.prev)}
      {line(a.next)}
      {acquired && (
        <div>
          <span className="text-muted">Acquired:</span> {acquired}
        </div>
      )}
    </div>
  );
}

/** Roster status pill — today's injury, or a season sat out — with the details on hover. */
export function PlayerStatus({
  p,
  season,
  note,
  noteLoading,
  className,
}: {
  p: Player;
  season: string;
  note?: AbsenceNote;
  noteLoading?: boolean;
  className?: string;
}) {
  if (p.injury) {
    const inj = p.injury;
    const ret = returnDate(inj.return_date);
    return (
      <Tip
        label={
          <div className="space-y-1">
            <div className="font-semibold">
              {inj.injury || "Undisclosed"}
              {ret && <span className="font-normal text-muted"> · est. return {ret}</span>}
            </div>
            {inj.comment && <div className="text-fg/75">{inj.comment}</div>}
          </div>
        }
      >
        <span className="inline-flex">
          <InjuryBadge status={inj.status} className={className} />
        </span>
      </Tip>
    );
  }
  if (!p.absence) return null;
  return (
    <Tip
      label={
        <div className="space-y-1.5">
          <div className="font-semibold">Didn't play a game in {season}</div>
          {note ? (
            <div className="text-fg/75">
              “{note.text}” <span className="text-muted">— {note.source}, via web search</span>
            </div>
          ) : (
            noteLoading && <div className="text-muted">Looking up why…</div>
          )}
          <AbsenceContext a={p.absence} acquired={p.acquired} />
        </div>
      }
    >
      <span className="inline-flex">
        <InjuryBadge status={MISSED} className={className} />
      </span>
    </Tip>
  );
}
