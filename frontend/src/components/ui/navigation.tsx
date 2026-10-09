"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Tabs<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cn("inline-flex max-w-full gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
            o.value === value ? "bg-white text-primary shadow-sm" : "text-slate-600 hover:text-slate-900",
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 text-xs">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (p: number) => void }) {
  if (pageCount <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-end gap-2 text-sm">
      <button className="rounded-md border p-1.5 disabled:opacity-40" onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="Page précédente">
        <ChevronLeft className="size-4" />
      </button>
      <span className="text-muted-foreground">
        Page {page} / {pageCount}
      </span>
      <button className="rounded-md border p-1.5 disabled:opacity-40" onClick={() => onChange(page + 1)} disabled={page >= pageCount} aria-label="Page suivante">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
