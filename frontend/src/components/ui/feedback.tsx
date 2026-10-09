import * as React from "react";
import { AlertCircle, CheckCircle2, Info, Loader2, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-md bg-slate-200/70", className)} {...props} />;
}

export function Spinner({ className, label = "Chargement…" }: { className?: string; label?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground", className)} role="status">
      <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
      {label}
    </div>
  );
}

const ALERT_STYLES = {
  info: { icon: Info, cls: "border-sky-200 bg-sky-50 text-sky-900" },
  success: { icon: CheckCircle2, cls: "border-green-200 bg-green-50 text-green-900" },
  warning: { icon: TriangleAlert, cls: "border-amber-200 bg-amber-50 text-amber-900" },
  error: { icon: AlertCircle, cls: "border-red-200 bg-red-50 text-red-900" },
} as const;

export function Alert({ variant = "info", title, children, className, action }: { variant?: keyof typeof ALERT_STYLES; title?: string; children?: React.ReactNode; className?: string; action?: React.ReactNode }) {
  const { icon: Icon, cls } = ALERT_STYLES[variant];
  return (
    <div className={cn("flex gap-3 rounded-lg border p-3.5 text-sm", cls, className)} role={variant === "error" ? "alert" : "status"}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="leading-relaxed opacity-90">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }: { icon: LucideIcon; title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center", className)}>
      <div className="flex size-12 items-center justify-center rounded-full bg-accent text-primary">
        <Icon className="size-6" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="font-semibold">{title}</p>
        {description && <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert variant="error" title="Impossible de charger les données" action={onRetry ? <button onClick={onRetry} className="text-sm font-semibold underline">Réessayer</button> : undefined}>
      {message}
    </Alert>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-slate-200", className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function PageHeader({ title, description, actions, className }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {description && <div className="text-sm text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ icon: Icon, label, value, tone = "blue", hint }: { icon: LucideIcon; label: string; value: React.ReactNode; tone?: "blue" | "green" | "amber" | "violet" | "red"; hint?: string }) {
  const tones = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-green-50 text-green-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
    red: "bg-red-50 text-red-700",
  };
  return (
    <div className="rounded-xl border bg-white p-4 shadow-[var(--shadow-soft)]">
      <div className={cn("mb-3 flex size-9 items-center justify-center rounded-lg", tones[tone])}>
        <Icon className="size-[18px]" aria-hidden />
      </div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
