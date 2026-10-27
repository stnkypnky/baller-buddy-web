import type { TeamColors } from "./types";

/** Team theming: derives readable accent shades from a team's primary color
 *  and writes them to animatable CSS custom properties on :root. */

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = ([r, g, b]: RGB) =>
  "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

function luminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: RGB, b: RGB): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const BG: RGB = [7, 9, 13];
const WHITE: RGB = [255, 255, 255];

/** Lighten `color` toward white until it reads on the app background. */
export function readableOnDark(hex: string, min = 4.5): string {
  const c = hexToRgb(hex);
  for (let t = 0; t <= 1; t += 0.05) {
    const m = mix(c, WHITE, t);
    if (contrast(m, BG) >= min) return toHex(m);
  }
  return "#ffffff";
}

/** Black or white — whichever reads better on top of `hex`. */
export function onColor(hex: string): string {
  const c = hexToRgb(hex);
  return contrast(c, [10, 10, 10]) >= contrast(c, WHITE) ? "#0a0a0a" : "#ffffff";
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

export function teamVars(colors: TeamColors) {
  return {
    "--team": colors.primary,
    "--team-text": readableOnDark(colors.primary),
    "--team-on": onColor(colors.primary),
    "--team-glow": rgba(colors.primary, 0.32),
    "--team-deep": colors.banner,
  };
}

export function applyTeamTheme(colors: TeamColors) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(teamVars(colors))) root.style.setProperty(k, v);
}
