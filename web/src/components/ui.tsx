import * as Dialog from "@radix-ui/react-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import clsx from "clsx";
import { AlertTriangle, LoaderCircle, X } from "lucide-react";
import { animate, AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { headshotUrl, logoUrl } from "../lib/api";

export const cx = clsx;

/* â”€â”€ Surfaces â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export function Panel({
  className,
  children,
  hover,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return (
    <div className={cx("panel", hover && "panel-hover", className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx("mb-3 flex items-center justify-between gap-3", className)}>
      <h3 className="display text-[19px] font-bold uppercase tracking-wide text-fg">{children}</h3>
      {right}
    </div>
  );
}

/** Staggered entrance for page sections. */
export const stagger = {
  container: { hidden: {}, show: { transition: { staggerChildren: 0.05 } } },
  item: {
    hidden: { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 260, damping: 26 } },
  },
};

export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={stagger.container} initial="hidden" animate="show" className={className}>
      {children}
    </motion.div>
  );
}

export function Item({ children, className, ...rest }: { children: ReactNode; className?: string } & React.ComponentProps<typeof motion.div>) {
  return (
    <motion.div variants={stagger.item} className={className} {...rest}>
      {children}
    </motion.div>
  );
}

/* â”€â”€ Controls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx("inline-flex rounded-xl border border-line bg-black/25 p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cx(
              "relative rounded-lg font-medium transition-colors",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-[13px]",
              active ? "text-team-on" : "text-muted hover:text-fg",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-lg bg-team shadow-[0_6px_20px_-6px_var(--team-glow)]"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative z-10 whitespace-nowrap">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Button({
  children,
  variant = "solid",
  size = "md",
  className,
  loading,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "solid" | "ghost" | "outline" | "subtle";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-[background,color,border,box-shadow,opacity] disabled:opacity-50",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-10 px-4 text-[13px]",
        size === "lg" && "h-12 px-6 text-sm",
        variant === "solid" &&
          "bg-team text-team-on shadow-[0_8px_24px_-10px_var(--team-glow)] hover:brightness-110",
        variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-fg",
        variant === "outline" && "border border-line bg-surface text-fg hover:border-team-text/40 hover:bg-surface-2",
        variant === "subtle" && "bg-surface-2 text-fg hover:bg-white/10",
        className,
      )}
      {...(rest as any)}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" />}
      {children}
    </motion.button>
  );
}

export function IconButton({
  children,
  label,
  className,
  active,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <Tip label={label}>
      <motion.button
        whileTap={{ scale: 0.9 }}
        aria-label={label}
        className={cx(
          "grid size-9 place-items-center rounded-xl transition-colors",
          active ? "bg-team/15 text-team-text" : "text-muted hover:bg-surface-2 hover:text-fg",
          className,
        )}
        {...(rest as any)}
      >
        {children}
      </motion.button>
    </Tip>
  );
}

export function Chip({
  children,
  active,
  onClick,
  className,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const Comp = onClick ? motion.button : motion.span;
  return (
    <Comp
      whileTap={onClick ? { scale: 0.95 } : undefined}
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-transparent bg-team text-team-on"
          : "border-line bg-surface text-muted hover:border-team-text/30 hover:text-fg",
        className,
      )}
    >
      {children}
    </Comp>
  );
}

export function Tip({ label, children, side = "top" }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tooltip.Root delayDuration={350}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          className="z-[100] max-w-xs rounded-lg border border-line bg-[#12151c]/95 px-2.5 py-1.5 text-xs text-fg shadow-xl backdrop-blur"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/* â”€â”€ Data display â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export function AnimatedNumber({
  value,
  format = (v) => v.toFixed(1),
  className,
}: {
  value: number | null | undefined;
  format?: (v: number) => string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  useEffect(() => {
    if (value == null || !ref.current) return;
    const el = ref.current;
    if (reduce) {
      el.textContent = format(value);
      prev.current = value;
      return;
    }
    const controls = animate(prev.current, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => (el.textContent = format(v)),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, format, reduce]);
  return (
    <span ref={ref} className={cx("tabular", className)}>
      {value == null ? "—" : format(0)}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} />;
}

export function TeamLogo({
  espnAbbr,
  size = 40,
  className,
  glow,
}: {
  espnAbbr?: string;
  size?: number;
  className?: string;
  glow?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (!espnAbbr || failed) {
    return (
      <div
        style={{ width: size, height: size }}
        className={cx("grid place-items-center rounded-full bg-surface-2 text-[10px] font-bold uppercase text-muted", className)}
      >
        {espnAbbr?.slice(0, 3)}
      </div>
    );
  }
  return (
    <img
      src={logoUrl(espnAbbr)}
      width={size}
      height={size}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
      className={cx("object-contain", glow && "drop-shadow-[0_8px_24px_var(--team-glow)]", className)}
      style={{ width: size, height: size }}
    />
  );
}

export function Headshot({
  pid,
  name,
  className,
  size = "small",
}: {
  pid: number;
  name: string;
  className?: string;
  size?: "small" | "large";
}) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  if (failed)
    return (
      <div className={cx("grid place-items-center bg-gradient-to-b from-team/30 to-transparent display text-3xl font-bold text-team-text", className)}>
        {initials}
      </div>
    );
  return (
    <img
      src={headshotUrl(pid, size)}
      alt={name}
      draggable={false}
      onError={() => setFailed(true)}
      className={cx("object-cover object-top", className)}
    />
  );
}

export function Empty({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      {icon && <div className="mb-1 text-faint">{icon}</div>}
      <div className="text-sm font-medium text-fg/80">{title}</div>
      {hint && <div className="max-w-sm text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <AlertTriangle className="size-7 text-warn" />
      <div className="text-sm text-fg/90">Couldn't load this data</div>
      <div className="max-w-md text-xs text-muted">{error instanceof Error ? error.message : String(error)}</div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

const INJURY_TONE: Record<string, string> = {
  Out: "bg-loss/15 text-loss",
  "Day-To-Day": "bg-warn/15 text-warn",
  Questionable: "bg-warn/15 text-warn",
  Doubtful: "bg-loss/10 text-loss",
  Probable: "bg-win/15 text-win",
  "Missed season": "bg-loss/15 text-loss",
};

/** ESPN injury status pill ("Out", "Day-To-Day"…). */
export function InjuryBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", INJURY_TONE[status] ?? "bg-white/10 text-fg/80", className)}>
      {status}
    </span>
  );
}

export function WL({ wl }: { wl: string }) {
  const win = wl === "W";
  return (
    <span
      className={cx(
        "inline-grid size-6 place-items-center rounded-md text-[11px] font-bold",
        win ? "bg-win/15 text-win" : "bg-loss/15 text-loss",
      )}
    >
      {wl || "–"}
    </span>
  );
}

/* â”€â”€ Drawer (right-side sheet) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export function Drawer({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  width = 720,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed inset-y-2 right-2 z-50 flex max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl border border-line bg-[#0b0e14]/95 shadow-2xl backdrop-blur-xl"
                style={{ width }}
                initial={{ x: width + 40, opacity: 0.6 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: width + 40, opacity: 0.6 }}
                transition={{ type: "spring", stiffness: 300, damping: 34 }}
              >
                <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
                  <div className="min-w-0">
                    <Dialog.Title className="display truncate text-2xl font-bold uppercase tracking-wide">
                      {title}
                    </Dialog.Title>
                    {subtitle && <div className="mt-0.5 text-xs text-muted">{subtitle}</div>}
                  </div>
                  <Dialog.Close asChild>
                    <button className="grid size-9 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg">
                      <X className="size-4" />
                    </button>
                  </Dialog.Close>
                </div>
                <div className="scroll min-h-0 flex-1 px-6 py-5">{children}</div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cx("size-4 animate-spin text-muted", className)} />;
}
