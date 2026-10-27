/** App settings in IndexedDB (port of backend/settings.py): non-secret
 *  preferences only; API keys live in keys.ts. */

import { idbGet, idbSet } from "./idb";

export const DEFAULTS = {
  ai: {
    provider: "lmstudio",
    model: "",
    models: {} as Record<string, string>, // provider -> last chosen model
    fallbacks: [] as string[], // ["provider:model", ...] tried in order on failure
    custom_base_url: "",
    lmstudio_url: "http://localhost:1234/v1",
    ollama_url: "http://localhost:11434/v1",
    no_tools: [] as string[], // "provider:model" pairs that rejected tool calls
    web_default: false,
  },
  alerts: {
    enabled: true,
    followed: [] as number[], // NBA team ids; empty = the selected team
    tipoff: true,
    close: true,
    final: true,
    upset: true,
    quiet_start: "", // "23:00" (local) — empty = no quiet hours
    quiet_end: "",
  },
  ui: { team_id: null as number | null },
};

export type Settings = typeof DEFAULTS;
export type Section = keyof Settings;

const KEY = "app";
let mem: Settings | null = null;
let chain: Promise<unknown> = Promise.resolve();

const clone = <T>(x: T): T => structuredClone(x);

function merge(base: any, over: any): any {
  const out = clone(base);
  for (const [k, v] of Object.entries(over ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
      out[k] = merge(out[k], v);
    } else out[k] = v;
  }
  return out;
}

export async function load(): Promise<Settings> {
  if (mem) return clone(mem);
  let stored: unknown;
  try {
    stored = await idbGet("settings", KEY);
  } catch {
    stored = undefined;
  }
  mem = merge(DEFAULTS, stored);
  return clone(mem!);
}

/** Deep-merge `patch` into one section and persist. Unknown keys are dropped. */
export function update<S extends Section>(section: S, patch: Partial<Settings[S]>): Promise<Settings[S]> {
  const run = async () => {
    const data = await load();
    const allowed = Object.keys(DEFAULTS[section]);
    const clean = Object.fromEntries(Object.entries(patch ?? {}).filter(([k]) => allowed.includes(k)));
    data[section] = merge(data[section], clean);
    mem = data;
    try {
      await idbSet("settings", KEY, data);
    } catch {
      /* private mode: keep it in memory */
    }
    return clone(data[section]);
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

export async function get<S extends Section>(section: S): Promise<Settings[S]> {
  return (await load())[section];
}
