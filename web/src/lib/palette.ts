import { useMemo } from "react";
import { useSelection } from "./queries";
import { readableOnDark } from "./theme";
import type { Team } from "./types";

/** Concrete hex colors for charts (SVG attributes can't rely on CSS vars). */
export function teamPalette(team?: Team) {
  const primary = team?.colors.primary ?? "#007a33";
  return {
    primary,
    accent: readableOnDark(primary),
    accentSoft: readableOnDark(primary, 3),
    grid: "rgba(255,255,255,0.06)",
    axis: "#596174",
    muted: "#8c95a8",
    secondary: "#7dd3fc",
    tertiary: "#fbbf24",
    win: "#3ddc84",
    loss: "#f0506e",
  };
}

export function usePalette() {
  const { team } = useSelection();
  return useMemo(() => teamPalette(team), [team]);
}

export const chartTooltipStyle = {
  contentStyle: {
    background: "rgba(13,16,23,0.96)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    fontSize: 12,
    boxShadow: "0 12px 30px rgba(0,0,0,.5)",
  },
  labelStyle: { color: "#8c95a8", marginBottom: 4 },
  itemStyle: { color: "#e9ecf2", padding: 0 },
  cursor: { fill: "rgba(255,255,255,0.04)", stroke: "rgba(255,255,255,0.1)" },
};
