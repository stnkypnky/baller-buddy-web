import { useMemo, useState } from "react";
import { cx, Segmented } from "./ui";

/** Half-court shot chart in nba.com shot coordinates (tenths of a foot,
 *  basket at 0,0). Rendered basket-at-bottom. */

const TOP = 422.5;
const Y = (y: number) => TOP - y;

export type Zone = "Restricted Area" | "Paint" | "Mid-Range" | "Corner 3" | "Above Break 3";
export const ZONES: Zone[] = ["Restricted Area", "Paint", "Mid-Range", "Corner 3", "Above Break 3"];

export function zoneOf(x: number, y: number): Zone {
  const d = Math.hypot(x, y);
  if (d <= 40) return "Restricted Area";
  if (Math.abs(x) >= 220 && y <= 92.5) return "Corner 3";
  if (d >= 237.5) return "Above Break 3";
  if (Math.abs(x) <= 80 && y <= 142.5) return "Paint";
  return "Mid-Range";
}

function Court({ color }: { color: string }) {
  const s = { stroke: color, strokeWidth: 1.6, fill: "none" };
  return (
    <g {...s}>
      <rect x={-250} y={0} width={500} height={TOP + 47.5} rx={0} strokeOpacity={0.6} />
      <rect x={-80} y={Y(142.5)} width={160} height={190} />
      <rect x={-60} y={Y(142.5)} width={120} height={190} strokeOpacity={0.5} />
      <path d={`M -60 ${Y(142.5)} A 60 60 0 0 1 60 ${Y(142.5)}`} />
      <path d={`M -60 ${Y(142.5)} A 60 60 0 0 0 60 ${Y(142.5)}`} strokeDasharray="6 6" strokeOpacity={0.5} />
      <path d={`M -40 ${Y(0)} A 40 40 0 0 1 40 ${Y(0)}`} />
      <line x1={-30} x2={30} y1={Y(-7.5)} y2={Y(-7.5)} strokeWidth={2.4} />
      <circle cx={0} cy={Y(0)} r={7.5} />
      <line x1={-220} x2={-220} y1={Y(-47.5)} y2={Y(92.5)} />
      <line x1={220} x2={220} y1={Y(-47.5)} y2={Y(92.5)} />
      <path d={`M -220 ${Y(92.5)} A 237.5 237.5 0 0 1 220 ${Y(92.5)}`} />
      <path d={`M -60 ${Y(TOP)} A 60 60 0 0 0 60 ${Y(TOP)}`} />
    </g>
  );
}

// Efficiency color ramp: cold slate -> neutral -> hot accent.
function lerp(a: number[], b: number[], t: number) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}
function hex(c: string) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rampColor(fg: number, hot: string) {
  const cold = [86, 110, 150];
  const mid = [150, 150, 160];
  const h = hex(hot);
  const t = Math.max(0, Math.min(1, (fg - 0.3) / 0.35));
  const c = t < 0.5 ? lerp(cold, mid, t * 2) : lerp(mid, h, (t - 0.5) * 2);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const R = 15; // hex radius in shot units

function hexBins(xs: number[], ys: number[], made: number[]) {
  const w = Math.sqrt(3) * R;
  const h = 1.5 * R;
  const bins = new Map<string, { cx: number; cy: number; n: number; m: number }>();
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = ys[i];
    if (y > TOP) continue;
    const row = Math.round(y / h);
    let best: { cx: number; cy: number; key: string } | null = null;
    let bestD = Infinity;
    for (const r of [row - 1, row, row + 1]) {
      const off = r % 2 ? w / 2 : 0;
      const col = Math.round((x - off) / w);
      const cx = col * w + off;
      const cy = r * h;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { cx, cy, key: `${r}:${col}` };
      }
    }
    const b = bins.get(best!.key) ?? { cx: best!.cx, cy: best!.cy, n: 0, m: 0 };
    b.n++;
    b.m += made[i];
    bins.set(best!.key, b);
  }
  return [...bins.values()];
}

function hexPath(cx: number, cy: number, r: number) {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(Y(cy) - r * Math.sin(a)).toFixed(1)}`;
  });
  return `M${pts.join("L")}Z`;
}

export function ShotChart({
  shots,
  accent,
}: {
  shots: { x: number[]; y: number[]; made: number[] };
  accent: string;
}) {
  const [mode, setMode] = useState<"dots" | "hex">("hex");
  const total = shots.x.length;
  const makes = shots.made.reduce((a, b) => a + b, 0);

  const zones = useMemo(() => {
    const z = new Map<Zone, { n: number; m: number }>(ZONES.map((k) => [k, { n: 0, m: 0 }]));
    shots.x.forEach((x, i) => {
      const e = z.get(zoneOf(x, shots.y[i]))!;
      e.n++;
      e.m += shots.made[i];
    });
    return z;
  }, [shots]);

  const bins = useMemo(() => hexBins(shots.x, shots.y, shots.made), [shots]);
  const maxN = Math.max(1, ...bins.map((b) => b.n));

  if (total < 10)
    return (
      <div className="grid h-full min-h-72 place-items-center text-sm text-muted">Not enough shot data for this season</div>
    );

  return (
    <div className="grid grid-cols-[1fr_200px] gap-5">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm">
            <span className="display text-2xl font-bold tabular">{makes}</span>
            <span className="text-muted">/{total} FG</span>
            <span className="ml-2 font-semibold text-fg/90 tabular">{((makes / total) * 100).toFixed(1)}%</span>
          </div>
          <Segmented
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: "hex", label: "Heat" },
              { value: "dots", label: "Shots" },
            ]}
          />
        </div>
        <svg viewBox={`-252 -2 504 ${TOP + 52}`} className="w-full overflow-visible">
          <defs>
            <radialGradient id="court-glow" cx="50%" cy="100%" r="80%">
              <stop offset="0%" stopColor={accent} stopOpacity="0.10" />
              <stop offset="100%" stopColor={accent} stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect x={-250} y={0} width={500} height={TOP + 47.5} fill="url(#court-glow)" />
          <Court color="rgba(255,255,255,0.22)" />
          {mode === "dots" &&
            shots.x.map((x, i) =>
              shots.y[i] > TOP ? null : shots.made[i] ? (
                <circle
                  key={i}
                  cx={x}
                  cy={Y(shots.y[i])}
                  r={4.2}
                  fill={accent}
                  fillOpacity={0.8}
                  style={{ animation: `shot-in .5s ease both`, animationDelay: `${(i % 120) * 4}ms` }}
                />
              ) : (
                <g
                  key={i}
                  stroke="rgba(255,255,255,0.35)"
                  strokeWidth={1.4}
                  style={{ animation: `shot-in .5s ease both`, animationDelay: `${(i % 120) * 4}ms` }}
                >
                  <line x1={x - 3} y1={Y(shots.y[i]) - 3} x2={x + 3} y2={Y(shots.y[i]) + 3} />
                  <line x1={x - 3} y1={Y(shots.y[i]) + 3} x2={x + 3} y2={Y(shots.y[i]) - 3} />
                </g>
              ),
            )}
          {mode === "hex" &&
            bins.map((b, i) => (
              <path
                key={i}
                d={hexPath(b.cx, b.cy, R * (0.35 + 0.65 * Math.sqrt(b.n / maxN)))}
                fill={rampColor(b.m / b.n, accent)}
                fillOpacity={0.9}
                style={{ animation: `shot-in .6s ease both`, animationDelay: `${(i % 80) * 6}ms` }}
              >
                <title>{`${b.m}/${b.n} (${((b.m / b.n) * 100).toFixed(0)}%)`}</title>
              </path>
            ))}
        </svg>
        {mode === "hex" && (
          <div className="mt-2 flex items-center justify-center gap-2 text-[11px] text-muted">
            <span>Cold</span>
            <div className="h-1.5 w-32 rounded-full" style={{ background: `linear-gradient(90deg, rgb(86,110,150), rgb(150,150,160), ${accent})` }} />
            <span>Hot</span>
            <span className="ml-3">Size = volume</span>
          </div>
        )}
      </div>
      <div className="space-y-2.5 self-center">
        {ZONES.map((z) => {
          const e = zones.get(z)!;
          const fg = e.n ? e.m / e.n : 0;
          const share = e.n / total;
          return (
            <div key={z} className="rounded-xl border border-line bg-black/20 p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] font-medium text-muted">{z}</span>
                <span className="text-[10px] text-faint tabular">{(share * 100).toFixed(0)}% of FGA</span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className={cx("display text-2xl font-bold tabular")} style={{ color: e.n ? rampColor(fg, accent) : undefined }}>
                  {e.n ? `${(fg * 100).toFixed(1)}%` : "—"}
                </span>
                <span className="text-[11px] text-muted tabular">
                  {e.m}/{e.n}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
