/** Shot-zone efficiency from nba.com shot coordinates (tenths of a foot, basket
 *  at 0,0). Mirrors components/ShotChart.tsx zoneOf(). */

import type { Shots } from "../nba/data";
import { round } from "../nba/stats";

const ZONES = ["Restricted Area", "Paint", "Mid-Range", "Corner 3", "Above Break 3"];

export function zoneOf(x: number, y: number) {
  const d = Math.hypot(x, y);
  if (d <= 40) return "Restricted Area";
  if (Math.abs(x) >= 220 && y <= 92.5) return "Corner 3";
  if (d >= 237.5) return "Above Break 3";
  if (Math.abs(x) <= 80 && y <= 142.5) return "Paint";
  return "Mid-Range";
}

export function zoneSummary(shots: Shots) {
  const total = shots.x.length;
  if (!total) return {};
  const agg: Record<string, [number, number]> = Object.fromEntries(ZONES.map((z) => [z, [0, 0]]));
  shots.x.forEach((x, i) => {
    const a = agg[zoneOf(x, shots.y[i])];
    a[0] += shots.made[i] ?? 0;
    a[1] += 1;
  });
  return Object.fromEntries(
    Object.entries(agg).map(([z, [m, n]]) => [
      z,
      { fgm: m, fga: n, fg_pct: n ? round(m / n, 3) : null, share_of_fga: round(n / total, 3) },
    ]),
  );
}
