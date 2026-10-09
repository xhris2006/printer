"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Groupe de cartes à choix unique (accessibles au clavier, rôle radiogroup). */
export function ChoiceGroup<T extends string>({
  value,
  onChange,
  options,
  className,
  columns = 2,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; description?: React.ReactNode; icon?: React.ReactNode; disabled?: boolean; disabledReason?: string }[];
  className?: string;
  columns?: 2 | 3 | 4;
  ariaLabel: string;
}) {
  const cols = { 2: "grid-cols-2", 3: "grid-cols-2 sm:grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" }[columns];
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("grid gap-2", cols, className)}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={o.disabled}
            title={o.disabled ? o.disabledReason : undefined}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex min-h-11 items-start gap-2 rounded-lg border bg-white px-3 py-2.5 text-left text-sm transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-45",
              selected ? "border-primary bg-accent/70 ring-1 ring-primary" : "border-input hover:border-primary/50",
            )}
          >
            <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", selected ? "border-primary" : "border-slate-300")}>
              {selected && <span className="size-2 rounded-full bg-primary" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-medium">
                {o.icon}
                {o.label}
              </span>
              {o.description && <span className="mt-0.5 block text-xs text-muted-foreground">{o.description}</span>}
              {o.disabled && o.disabledReason && <span className="mt-0.5 block text-xs text-amber-700">{o.disabledReason}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30", checked ? "bg-primary" : "bg-slate-300")}
    >
      <span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}
