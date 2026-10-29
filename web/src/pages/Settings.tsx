import * as Switch from "@radix-ui/react-switch";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CheckCircle2,
  Cloud,
  ExternalLink,
  FolderOpen,
  KeyRound,
  ListOrdered,
  Monitor,
  Music,
  Plus,
  Star,
  Trash,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { openKeyPage, useModels, useProviders } from "../components/AiParts";
import { Button, Chip, cx, Item, Panel, SectionTitle, Skeleton, Spinner, Stagger, TeamLogo } from "../components/ui";
import { exportReports, useReports, type ModelInfo, type ProviderInfo } from "../lib/ai";
import * as music from "../backend/music";
import { api, del, post, put } from "../lib/api";
import { reloadLibrary, stop as stopMusic } from "../lib/player";
import { useSelection } from "../lib/queries";
import { useApp } from "../lib/store";


export default function SettingsPage() {
  return (
    <Stagger className="mx-auto max-w-6xl space-y-6">
      <Item>
        <div className="eyebrow text-team-text">Preferences</div>
        <h1 className="display text-4xl font-bold uppercase">Settings</h1>
      </Item>
      <Item>
        <AiProviders />
      </Item>
      <Item>
        <Fallbacks />
      </Item>
      <Item className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <AlertSettings />
        <MusicSettings />
      </Item>
      <Item>
        <DeveloperSettings />
      </Item>
    </Stagger>
  );
}

/* ── AI providers ─────────────────────────────────────────────────────────── */

function AiProviders() {
  const { data, isLoading } = useProviders();
  const local = useQuery({ queryKey: ["ai-local"], queryFn: () => api<Record<string, boolean>>("/ai/local"), refetchInterval: 10_000 });
  if (isLoading || !data) return <Skeleton className="h-96 rounded-[18px]" />;
  const locals = data.providers.filter((p) => p.local);
  const cloud = data.providers.filter((p) => !p.local);
  return (
    <div className="space-y-5">
      <SectionTitle right={<span className="text-xs text-muted">Keys stay on this device, encrypted — never on a server</span>}>
        <span className="flex items-center gap-2">
          <KeyRound className="size-4 text-team-text" /> AI providers
        </span>
      </SectionTitle>
      <div>
        <div className="eyebrow mb-2 flex items-center gap-1.5">
          <Monitor className="size-3.5" /> On your computer
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {locals.map((p) => (
            <ProviderCard key={p.id} p={p} active={data.settings.provider === p.id} running={local.data?.[p.id]} />
          ))}
        </div>
      </div>
      <div>
        <div className="eyebrow mb-2 flex items-center gap-1.5">
          <Cloud className="size-3.5" /> Cloud APIs
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {cloud.map((p) => (
            <ProviderCard key={p.id} p={p} active={data.settings.provider === p.id} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProviderCard({ p, active, running }: { p: ProviderInfo; active: boolean; running?: boolean }) {
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [url, setUrl] = useState(p.id === "custom" || p.local ? p.base_url : "");
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const models = useModels(p.id, p.available);
  const [model, setModel] = useState(p.model);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ai-providers"] });
    qc.invalidateQueries({ queryKey: ["ai-models", p.id] });
  };

  async function saveKey() {
    setBusy("save");
    try {
      if ((p.id === "custom" || p.local) && url !== p.base_url) await put("/ai/settings", { [p.local ? `${p.id}_url` : "custom_base_url"]: url });
      if (key) {
        const r = await put<{ test: { ok: boolean; error?: string; models: ModelInfo[] } }>(`/ai/keys/${p.id}`, { key });
        setResult(r.test.ok ? { ok: true, msg: `Connected · ${r.test.models.length} models` } : { ok: false, msg: r.test.error ?? "Failed" });
        if (r.test.ok) toast.success(`${p.name} connected`);
      } else {
        await test();
      }
      setKey("");
      refresh();
    } catch (e) {
      setResult({ ok: false, msg: String((e as Error).message) });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    try {
      const r = await post<{ ok: boolean; error?: string; models: ModelInfo[]; latency_ms?: number }>(`/ai/test/${p.id}`);
      setResult(r.ok ? { ok: true, msg: `Connected · ${r.models.length} models · ${r.latency_ms}ms` } : { ok: false, msg: r.error ?? "Failed" });
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    await del(`/ai/keys/${p.id}`);
    setResult(null);
    refresh();
    setBusy(null);
    toast(`${p.name} key removed`);
  }

  async function makeDefault() {
    await put("/ai/settings", { provider: p.id, model });
    refresh();
    toast.success(`${p.name}${model ? ` · ${model}` : ""} is now your default`);
  }

  const status: { tone: "ok" | "off" | "warn"; label: string } = p.local
    ? running
      ? { tone: "ok", label: "Running" }
      : { tone: "off", label: "Not running" }
    : p.available
      ? { tone: "ok", label: p.last4 ? `Key ••••${p.last4}` : "Configured" }
      : { tone: "off", label: "Not set up" };

  const modelOptions = [...p.suggested.map((s) => ({ id: s, name: s })), ...(models.data?.models ?? []).filter((m) => !p.suggested.includes(m.id))];

  return (
    <motion.div layout className={cx("panel relative flex flex-col p-5", active && "ring-1 ring-team-text/40")}>
      {active && (
        <span className="absolute top-4 right-4 inline-flex items-center gap-1 rounded-full bg-team px-2 py-0.5 text-[10px] font-bold text-team-on">
          <Star className="size-3" /> DEFAULT
        </span>
      )}
      <div className="flex items-start gap-3 pr-20">
        <div className={cx("mt-1 size-2.5 shrink-0 rounded-full", status.tone === "ok" ? "bg-win shadow-[0_0_10px_var(--win)]" : "bg-white/20")} />
        <div>
          <div className="text-[15px] font-semibold">{p.name}</div>
          <div className="mt-0.5 text-xs text-muted">{p.blurb}</div>
        </div>
      </div>
      <div className="mt-2 ml-5 text-[11px] text-faint">{status.label}</div>

      <div className="mt-4 space-y-2">
        {(p.id === "custom" || p.local) && (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && p.local && saveKey()}
            onBlur={() => p.local && url !== p.base_url && saveKey()}
            title={p.local ? "Server address. This device's own (localhost) works from any page; another computer needs an https:// address. Turn on CORS in the server." : undefined}
            placeholder={p.local ? p.base_url : "https://my-server:8000/v1"}
            className="h-10 w-full rounded-xl border border-line bg-black/30 px-3 text-[13px] outline-none focus:border-team-text/40"
          />
        )}
        {(p.needs_key || p.id === "custom") && (
          <div className="flex gap-2">
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveKey()}
              placeholder={p.configured ? "Replace key…" : p.id === "custom" ? "API key (optional)" : "Paste API key"}
              className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-black/30 px-3 text-[13px] outline-none focus:border-team-text/40"
              autoComplete="off"
              spellCheck={false}
            />
            <Button size="md" onClick={saveKey} loading={busy === "save"} disabled={!key && !(p.id === "custom" && url !== p.base_url)}>
              Save
            </Button>
          </div>
        )}
        {p.available && (
          <div className="flex gap-2">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-[#0d1017] px-3 text-[13px] outline-none"
            >
              {p.id === "lmstudio" && <option value="">Whatever model is loaded</option>}
              {!model && p.id !== "lmstudio" && <option value="">Choose a model…</option>}
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <Button variant={active && model === p.model ? "subtle" : "outline"} onClick={makeDefault}>
              {active && model === p.model ? "Default" : "Use"}
            </Button>
          </div>
        )}
      </div>

      {result && (
        <div className={cx("mt-3 flex items-center gap-2 text-xs", result.ok ? "text-win" : "text-loss")}>
          {result.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
          {result.msg}
        </div>
      )}

      <div className="mt-auto flex items-center gap-1 pt-4">
        {p.key_url && (
          <Button variant="ghost" size="sm" onClick={() => openKeyPage(p.key_url)}>
            <ExternalLink className="size-3.5" /> {p.local ? "Website" : "Get a key"}
          </Button>
        )}
        <div className="flex-1" />
        {(p.available || p.local) && (
          <Button variant="ghost" size="sm" onClick={test} loading={busy === "test"}>
            Test
          </Button>
        )}
        {p.configured && (
          <Button variant="ghost" size="sm" onClick={remove} loading={busy === "remove"}>
            <Trash className="size-3.5" /> Remove
          </Button>
        )}
      </div>
    </motion.div>
  );
}

function Fallbacks() {
  const { data } = useProviders();
  const qc = useQueryClient();
  const [pid, setPid] = useState("");
  const [model, setModel] = useState("");
  const models = useModels(pid || undefined, !!pid);
  const reports = useReports((s) => s.reports);
  const clearReports = useReports((s) => s.clear);
  if (!data) return null;
  const chain = data.settings.fallbacks;
  const avail = data.providers.filter((p) => p.available);
  const name = (id: string) => data.providers.find((p) => p.id === id)?.name ?? id;

  async function save(next: string[]) {
    await put("/ai/settings", { fallbacks: next });
    qc.invalidateQueries({ queryKey: ["ai-providers"] });
  }

  return (
    <Panel className="p-5">
      <SectionTitle right={<span className="text-xs text-muted">Tried in order if your default fails or is rate-limited</span>}>
        <span className="flex items-center gap-2">
          <ListOrdered className="size-4 text-team-text" /> Fallback chain
        </span>
      </SectionTitle>
      <div className="flex flex-wrap items-center gap-2">
        <Chip active>
          1 · {name(data.settings.provider)}
          {data.settings.model ? ` · ${data.settings.model}` : ""}
        </Chip>
        {chain.map((c, i) => {
          const [p, m] = c.split(":");
          return (
            <Chip key={c}>
              {i + 2} · {name(p)}
              {m ? ` · ${m}` : ""}
              <button onClick={() => save(chain.filter((x) => x !== c))} className="ml-1 text-faint hover:text-loss" aria-label="Remove">
                <X className="size-3" />
              </button>
            </Chip>
          );
        })}
      </div>
      <div className="mt-4 flex gap-2">
        <select value={pid} onChange={(e) => (setPid(e.target.value), setModel(""))} className="h-10 rounded-xl border border-line bg-[#0d1017] px-3 text-[13px]">
          <option value="">Add a provider…</option>
          {avail.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {pid && (
          <select value={model} onChange={(e) => setModel(e.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-[#0d1017] px-3 text-[13px]">
            <option value="">{pid === "lmstudio" ? "Loaded model" : "Default model"}</option>
            {(models.data?.models ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <Button
          variant="outline"
          disabled={!pid}
          onClick={() => {
            const spec = `${pid}:${model}`;
            if (!chain.includes(spec)) save([...chain, spec]);
            setPid("");
            setModel("");
          }}
        >
          <Plus className="size-4" /> Add
        </Button>
      </div>
      <div className="mt-3 border-t border-line pt-2">
        <Toggle
          checked={data.settings.factcheck !== false}
          onChange={(v) => put("/ai/settings", { factcheck: v }).then(() => qc.invalidateQueries({ queryKey: ["ai-providers"] }))}
          label="Fact-check answers"
          hint="Checks the players, scores, records and stats in every answer against the data it was built from, and has the model fix anything unsupported. Anything still unconfirmed is taken out."
        />
      </div>
      <label className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-fg">Model size</span>
          <span className="block text-[11px] text-muted">Small models get the data up front, only the tools a question needs and tighter rules. Auto goes by the model's name.</span>
        </span>
        <select
          value={data.settings.model_size ?? "auto"}
          onChange={(e) => put("/ai/settings", { model_size: e.target.value }).then(() => qc.invalidateQueries({ queryKey: ["ai-providers"] }))}
          className="h-10 shrink-0 rounded-xl border border-line bg-[#0d1017] px-3 text-[13px]"
        >
          <option value="auto">Auto</option>
          <option value="small">Small</option>
          <option value="large">Large</option>
        </select>
      </label>
      {reports.length > 0 && (
        <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-line bg-black/20 px-3 py-2 text-xs text-muted">
          <span>
            {reports.length} answer{reports.length === 1 ? "" : "s"} reported as wrong
          </span>
          <span className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={exportReports}>
              Export
            </Button>
            <Button variant="ghost" size="sm" onClick={clearReports}>
              Clear
            </Button>
          </span>
        </div>
      )}
      {!!data.settings.no_tools.length && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-line bg-black/20 px-3 py-2 text-xs text-muted">
          <span>Snapshot mode (no tools) for: {data.settings.no_tools.join(", ")}</span>
          <Button variant="ghost" size="sm" onClick={() => put("/ai/settings", { reset_no_tools: true }).then(() => qc.invalidateQueries({ queryKey: ["ai-providers"] }))}>
            Reset
          </Button>
        </div>
      )}
    </Panel>
  );
}

/* ── Alerts ───────────────────────────────────────────────────────────────── */

interface AlertPrefs {
  enabled: boolean;
  followed: number[];
  tipoff: boolean;
  close: boolean;
  final: boolean;
  upset: boolean;
  quiet_start: string;
  quiet_end: string;
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2">
      <div>
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="text-[11px] text-muted">{hint}</div>}
      </div>
      <Switch.Root checked={checked} onCheckedChange={onChange} className="relative h-6 w-11 shrink-0 rounded-full bg-white/10 transition-colors data-[state=checked]:bg-team">
        <Switch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
      </Switch.Root>
    </label>
  );
}

function DeveloperSettings() {
  const showReasoning = useApp((s) => s.showReasoning);
  const setShowReasoning = useApp((s) => s.setShowReasoning);
  return (
    <Panel className="p-5">
      <SectionTitle>
        <span className="flex items-center gap-2">
          <Wrench className="size-4 text-team-text" /> Developer
        </span>
      </SectionTitle>
      <Toggle
        checked={showReasoning}
        onChange={setShowReasoning}
        label="Show AI reasoning"
        hint="Show the model's thinking and step-by-step status above each answer"
      />
      <div className="mt-3 text-[11px] text-faint tabular">Version {__BUILD__}</div>
    </Panel>
  );
}

function AlertSettings() {
  const sel = useSelection();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["alert-settings"], queryFn: () => api<AlertPrefs>("/alerts/settings") });
  const [adding, setAdding] = useState(false);
  if (!data) return <Skeleton className="h-80 rounded-[18px]" />;
  const set = async (patch: Partial<AlertPrefs>) => {
    qc.setQueryData(["alert-settings"], { ...data, ...patch });
    await put("/alerts/settings", patch);
  };
  const followed = data.followed.length ? data.followed : sel.team ? [sel.team.id] : [];

  return (
    <Panel className="p-5">
      <SectionTitle
        right={
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await post("/alerts/simulate?kind=close");
              // With background alerts on, also check a real push gets through.
              const push = await post<{ ok: boolean }>("/alerts/push/test?kind=close").catch(() => ({ ok: false }));
              toast(push.ok ? "Test alert sent (and a push notification)" : "Test alert sent");
            }}
          >
            Send test
          </Button>
        }
      >
        <span className="flex items-center gap-2">
          <Bell className="size-4 text-team-text" /> Live game alerts
        </span>
      </SectionTitle>
      <Toggle checked={data.enabled} onChange={(v) => set({ enabled: v })} label="Alerts" hint="In-app alerts while Baller Buddy is open" />
      <PushToggle disabled={!data.enabled} />
      <div className={cx("transition-opacity", !data.enabled && "pointer-events-none opacity-40")}>
        <div className="mt-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Following</div>
        <div className="flex flex-wrap gap-2">
          {followed.map((id) => {
            const t = sel.byId.get(id);
            return (
              <Chip key={id}>
                <TeamLogo espnAbbr={t?.espn_abbr} size={16} />
                {t?.nickname}
                {data.followed.length > 0 && (
                  <button onClick={() => set({ followed: data.followed.filter((x) => x !== id) })} className="ml-0.5 text-faint hover:text-loss">
                    <X className="size-3" />
                  </button>
                )}
              </Chip>
            );
          })}
          {adding ? (
            <select
              autoFocus
              onBlur={() => setAdding(false)}
              onChange={(e) => {
                const id = Number(e.target.value);
                if (id) set({ followed: [...new Set([...followed, id])] });
                setAdding(false);
              }}
              className="h-7 rounded-full border border-line bg-[#0d1017] px-2 text-xs"
            >
              <option value="">Pick a team…</option>
              {sel.teams
                .filter((t) => !followed.includes(t.id))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          ) : (
            <Chip onClick={() => setAdding(true)}>
              <Plus className="size-3" /> Add team
            </Chip>
          )}
        </div>
        <div className="mt-3 divide-y divide-line">
          <Toggle checked={data.tipoff} onChange={(v) => set({ tipoff: v })} label="Tip-off" hint="When a followed team's game starts" />
          <Toggle checked={data.close} onChange={(v) => set({ close: v })} label="Close game" hint="4th quarter or OT, under 5:00, within 5 points" />
          <Toggle checked={data.final} onChange={(v) => set({ final: v })} label="Final score" />
          <Toggle checked={data.upset} onChange={(v) => set({ upset: v })} label="Upset watch (any game)" hint="A much worse team leading late in the 4th" />
        </div>
        <div className="mt-3 flex items-center gap-3 text-[13px]">
          <span className="text-muted">Quiet hours</span>
          <input type="time" value={data.quiet_start} onChange={(e) => set({ quiet_start: e.target.value })} className="h-8 rounded-lg border border-line bg-black/30 px-2 text-xs" />
          <span className="text-faint">to</span>
          <input type="time" value={data.quiet_end} onChange={(e) => set({ quiet_end: e.target.value })} className="h-8 rounded-lg border border-line bg-black/30 px-2 text-xs" />
        </div>
      </div>
    </Panel>
  );
}

/* ── Music ────────────────────────────────────────────────────────────────── */

function MusicSettings() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["music-settings"],
    queryFn: () => api<{ autoplay_on_launch: boolean; folders: string[] }>("/music/settings"),
  });
  const lib = useQuery({ queryKey: ["music-library"], queryFn: () => api<{ tracks: unknown[]; folders: string[] }>("/music/library") });
  const [busy, setBusy] = useState(false);
  const showMusic = useApp((s) => s.showMusic);
  const setShowMusic = useApp((s) => s.setShowMusic);
  if (!data) return <Skeleton className="h-80 rounded-[18px]" />;

  async function refreshLibrary(msg?: string) {
    qc.setQueryData(["music-settings"], await api("/music/settings"));
    await qc.invalidateQueries({ queryKey: ["music-library"] });
    await reloadLibrary();
    if (msg) toast(msg);
  }

  async function setFolders(folders: string[]) {
    await put<{ folders: string[] }>("/music/settings", { folders });
    await refreshLibrary();
  }

  async function addFolder() {
    const picked = await music.pickFolder();
    if (!picked) return;
    setBusy(true);
    try {
      await post("/music/rescan");
      await refreshLibrary(`Added “${picked}”`);
    } finally {
      setBusy(false);
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const n = await music.importFiles(files);
      await post("/music/rescan");
      await refreshLibrary(n ? `Added ${n} song${n > 1 ? "s" : ""}` : "No audio files in that pick");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="p-5">
      <SectionTitle>
        <span className="flex items-center gap-2">
          <Music className="size-4 text-team-text" /> Music
        </span>
      </SectionTitle>
      <Toggle
        checked={showMusic}
        onChange={(v) => {
          // hidden, there'd be no way to pause it
          if (!v) stopMusic();
          setShowMusic(v);
        }}
        label="Show music player"
        hint="The player bar along the bottom of the app. Off hides it on this device and stops the music."
      />
      <Toggle
        checked={data.autoplay_on_launch}
        onChange={async (v) => {
          qc.setQueryData(["music-settings"], { ...data, autoplay_on_launch: v });
          await put("/music/settings", { autoplay_on_launch: v });
        }}
        label="Autoplay on launch"
        hint="Start the music when the app opens (your browser may wait for a first tap)"
      />
      <div className="mt-3 mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Library on this device</span>
        <span className="text-xs text-muted">{lib.data ? `${lib.data.tracks.length} tracks` : "…"}</span>
      </div>
      <div className="space-y-1.5">
        {data.folders.map((f) => (
          <div key={f} className="flex items-center gap-2 rounded-xl border border-line bg-black/20 px-3 py-2 text-xs">
            <FolderOpen className="size-3.5 shrink-0 text-team-text" />
            <span className="flex-1 truncate text-fg/85" title={f}>
              {f}
            </span>
            <button onClick={() => setFolders(data.folders.filter((x) => x !== f))} className="text-faint hover:text-loss" aria-label="Remove folder">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {music.canPickFolder() && (
          <Button variant="outline" size="sm" onClick={addFolder} disabled={busy}>
            <Plus className="size-3.5" /> Add folder
          </Button>
        )}
        <label className={cx("inline-flex cursor-pointer", busy && "pointer-events-none opacity-50")}>
          <input type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
          <span className="inline-flex h-8 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-xs font-semibold text-fg transition-[background,border] hover:border-team-text/40 hover:bg-surface-2">
            <Plus className="size-3.5" /> Add songs
          </span>
        </label>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            setBusy(true);
            try {
              await post("/music/rescan");
              await refreshLibrary("Library rescanned");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy || lib.isFetching ? <Spinner /> : null} Rescan
        </Button>
      </div>
    </Panel>
  );
}

/** Background alerts: Web Push from the server, so they arrive with the app
 *  closed. Turning them on asks once for the passcode set on the Worker. */
function PushToggle({ disabled }: { disabled: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["push-status"],
    queryFn: () => api<{ supported: boolean; subscribed: boolean; permission: string; passcodeSaved?: boolean }>("/alerts/push"),
  });
  const [asking, setAsking] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  if (!data.supported) {
    return <div className="py-2 text-xs text-faint">This browser can't receive alerts while the app is closed. Installing the app (Add to Home Screen) may enable it.</div>;
  }

  async function turn(on: boolean, passcode?: string) {
    setBusy(true);
    try {
      qc.setQueryData(["push-status"], await post("/alerts/push", { enabled: on, passcode }));
      setAsking(false);
      setCode("");
      if (on) toast.success("Alerts will arrive even when the app is closed");
    } catch (e) {
      const msg = (e as Error).message;
      if ((e as { status?: number }).status === 401) {
        setAsking(true);
        if (passcode) toast.error(msg);
      } else toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cx(disabled && "pointer-events-none opacity-40")}>
      <Toggle
        checked={data.subscribed}
        onChange={(v) => (v && !data.passcodeSaved ? setAsking(true) : turn(v))}
        label="Notify me when the app is closed"
        hint={data.permission === "denied" ? "Notifications are blocked for this site in your browser settings" : "Push notifications on this device"}
      />
      {asking && !data.subscribed && (
        <div className="mb-2 flex gap-2">
          <input
            type="password"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && code.trim() && turn(true, code)}
            placeholder="Alerts passcode"
            className="h-9 min-w-0 flex-1 rounded-xl border border-line bg-black/30 px-3 text-[13px] outline-none focus:border-team-text/40"
            autoComplete="off"
          />
          <Button size="sm" onClick={() => turn(true, code)} disabled={!code.trim() || busy}>
            {busy ? <Spinner /> : null} Turn on
          </Button>
          <Button variant="ghost" size="sm" onClick={() => (setAsking(false), setCode(""))}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
