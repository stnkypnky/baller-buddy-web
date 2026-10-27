export const pct1 = (v: number | undefined | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
export const frac1 = (v: number | undefined | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
export const num1 = (v: number | undefined | null) => (v == null ? "—" : v.toFixed(1));
export const signed1 = (v: number | undefined | null) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`;

const QUARTERS = ["", "¼", "½", "¾"];

/** 80 -> 6'8" ; 83.75 -> 6'11¾" (combine numbers come in quarter inches). */
export function feetInches(inches: number): string {
  const q = Math.round(inches * 4);
  return `${Math.floor(q / 48)}'${Math.floor((q % 48) / 4)}${QUARTERS[q % 4]}"`;
}

/** 8.75 -> 8¾ in */
export function inches(v: number): string {
  const q = Math.round(v * 4);
  return `${Math.floor(q / 4)}${QUARTERS[q % 4]} in`;
}

/** Whole years since a YYYY-MM-DD birthdate. */
export function ageFrom(birth: string): number {
  const b = new Date(`${birth}T12:00:00`);
  const now = new Date();
  const had = now.getMonth() > b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() >= b.getDate());
  return now.getFullYear() - b.getFullYear() - (had ? 0 : 1);
}

/** Apply a Python-style format spec from the backend ("{:.1%}", "{:+.1f}"). */
export function pyFormat(spec: string, v: number | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const m = spec.match(/\{:(\+)?\.(\d)([f%])\}/);
  if (!m) return String(v);
  const [, plus, digits, kind] = m;
  const val = kind === "%" ? v * 100 : v;
  const s = val.toFixed(Number(digits));
  return `${plus && val > 0 ? "+" : ""}${s}${kind === "%" ? "%" : ""}`;
}

export function tipLocal(iso: string, opts: Intl.DateTimeFormatOptions = {}) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      ...opts,
    });
  } catch {
    return iso;
  }
}

export function timeLocal(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, tomorrow)) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

/** 'YYYY-MM-DD' (league game log) -> 'Sat, Apr 19'. */
export function shortDate(s: string, withYear = false) {
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

export function countdown(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Tip-off";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 48) return `in ${Math.floor(h / 24)} days`;
  if (h >= 1) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

export const yyyymmdd = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
